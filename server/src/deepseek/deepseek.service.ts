import { Injectable, Logger } from '@nestjs/common';

const STEP_TYPES = [
  'none',
  'leave.open_fill',
  'open_workflow',
  'open_menu',
  'open_todo',
  'filter_list',
] as const;

export type PlanStepType = (typeof STEP_TYPES)[number];

export interface PlanStep {
  type: PlanStepType;
  query: string;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  private assertApiKey(): { apiKey: string; base: string; model: string } {
    const apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置');
      throw new Error('服务器未配置 DEEPSEEK_API_KEY，请编辑 server/.env 后重启 Nest');
    }
    const base = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    return { apiKey, base, model };
  }

  private async chatCompletions(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.2,
  ): Promise<string> {
    const { apiKey, base, model } = this.assertApiKey();
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, temperature, messages }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `DeepSeek 请求失败（${response.status}）`);
    }
    return String(payload.choices?.[0]?.message?.content || '').trim();
  }

  private parseJsonObject(text: string): Record<string, unknown> {
    const raw = String(text || '').trim();
    const fenced = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(fenced ? fenced[0] : raw) as Record<string, unknown>;
  }

  private sanitizeSteps(raw: unknown): PlanStep[] {
    const list = Array.isArray(raw) ? raw : [];
    const steps: PlanStep[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { type?: string; query?: string };
      let type = String(row.type || 'none') as PlanStepType;
      if (!STEP_TYPES.includes(type)) type = 'none';
      if (type === 'none') continue;
      steps.push({ type, query: String(row.query || '').trim() });
    }
    return steps;
  }

  async generateChatBoxSuggestion(userMessages: string[]): Promise<string> {
    const system = [
      '你根据用户最近在流程助手里的输入，归纳一句「下一次最可能直接键入」的中文短句。',
      '要求：只输出这一句话本身，不要引号、不要 Markdown、不要解释。',
      '句子要可直接粘贴进输入框发送（例如：帮我请假，明天到后天，事由开会）。',
      '若记录太杂或无法归纳，只输出空字符串。',
    ].join('');

    const recent = userMessages.slice(0, 30).map((text, i) => `${i + 1}. ${text}`).join('\n');
    const content = await this.chatCompletions(
      [
        { role: 'system', content: system },
        { role: 'user', content: `最近用户输入：\n${recent}` },
      ],
      0.3,
    );
    return content.replace(/^["「]|["」]$/g, '');
  }

  /** 把用户原话拆成有序可执行步骤（只规划，不操作页面） */
  async planTaskSteps(utterance: string): Promise<{ reply: string; steps: PlanStep[] }> {
    const system = [
      '你是企业信息平台的任务规划器，把用户指令拆成可执行步骤。',
      '必须只输出一个 JSON 对象，不要 Markdown、不要解释。',
      '格式：{"reply":"一句话说明","steps":[{"type":"...","query":"..."}]}',
      'type 只能是：open_todo、open_menu、open_workflow、filter_list、leave.open_fill。',
      '硬性规则：',
      '1) 先导航到目标页，再筛选：filter_list 适用于任意列表/查询页，不只待办。',
      '2) 提到「待办」→ open_todo；提到进某菜单/模块/页面 → open_menu；打开某流程发起 → open_workflow。',
      '3) 提到「筛选/过滤/搜索/查询某关键字」→ 另加 filter_list，query 只放关键字。',
      '4) 多要求就多步，按执行顺序，禁止只输出第一步。',
      '5) 只有纯闲聊才 steps=[]。',
      '对照例子：',
      '输入：我的待办页面筛选通用流程的数据',
      '输出：{"reply":"先打开待办，再筛选","steps":[{"type":"open_todo","query":"我的待办"},{"type":"filter_list","query":"通用流程"}]}',
      '输入：打开流程定义，搜索请假',
      '输出：{"reply":"先打开流程定义再搜索","steps":[{"type":"open_menu","query":"流程定义"},{"type":"filter_list","query":"请假"}]}',
      '输入：打开请假流程',
      '输出：{"reply":"好的，打开请假","steps":[{"type":"open_workflow","query":"打开请假"}]}',
    ].join('\n');

    const content = await this.chatCompletions([
      { role: 'system', content: system },
      { role: 'user', content: `请规划下列指令：\n${String(utterance || '')}` },
    ]);
    const data = this.parseJsonObject(content);
    let steps = this.sanitizeSteps(data.steps);
    // 本地兜底：模型漏步时按原话补「导航 + 筛选」
    steps = this.ensureNavAndFilterSteps(utterance, steps);
    const reply = String(data.reply || data.message || '').trim() || (steps.length ? '好的，已拆成步骤。' : '好的。');
    return { reply, steps };
  }

  private ensureNavAndFilterSteps(utterance: string, steps: PlanStep[]): PlanStep[] {
    const text = String(utterance || '').replace(/\s+/g, '');
    const list = Array.isArray(steps) ? steps.slice() : [];
    const hasNav = list.some((s) => ['open_todo', 'open_menu', 'open_workflow'].includes(s.type));
    if (!hasNav) {
      if (/待办/.test(text)) list.unshift({ type: 'open_todo', query: '我的待办' });
      else {
        const menuHit = text.match(/(?:打开|进入|去)([^，,。筛选过滤搜索查询页面列表]{2,16})(?:页面|列表|模块|菜单)?/);
        if (menuHit && menuHit[1] && !/请假|出差|流程助手/.test(menuHit[1])) {
          list.unshift({ type: 'open_menu', query: menuHit[1] });
        }
      }
    }
    if (/筛选|过滤|搜索|查找/.test(text) && !list.some((s) => s.type === 'filter_list')) {
      let keyword = '';
      const patterns = [
        /筛选([^的数据页面列表]+)/,
        /过滤([^的数据页面列表]+)/,
        /搜索([^的数据页面列表]+)/,
        /查找([^的数据页面列表]+)/,
        /跟([^有关相关]+)/,
      ];
      for (const pattern of patterns) {
        const hit = text.match(pattern);
        if (hit && hit[1]) {
          keyword = hit[1].replace(/^(页面|列表|数据|有关|相关)/, '').trim();
          if (keyword) break;
        }
      }
      if (keyword) list.push({ type: 'filter_list', query: keyword });
    }
    return list;
  }

  /** 某步失败后，根据页面摘要决定重试/改参数/停下 */
  async actOnStepFailure(payload: {
    utterance: string;
    step: { type: string; query: string; seq: number };
    lastError: string;
    pageSummary?: Record<string, unknown>;
  }): Promise<{
    decision: 'retry' | 'ask_user' | 'skip' | 'stop';
    type?: PlanStepType;
    query?: string;
    message: string;
  }> {
    const system = [
      '你是流程助手的逐步执行顾问。某一步本地工具刚失败，请决定如何补救。',
      '只输出 JSON：',
      '{"decision":"retry|ask_user|skip|stop","type":"可改写的步骤类型或空","query":"可改写的短 query","message":"给用户看的一句话"}',
      '规则：retry 时尽量给出更短/更准的 query；页面不像列表页却要筛选 → ask_user；明显权限/未登录 → stop；本步可跳过不影响后续 → skip。',
      `合法 type：${STEP_TYPES.filter((t) => t !== 'none').join('|')}`,
    ].join('');

    const content = await this.chatCompletions([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload || {}) },
    ]);
    const data = this.parseJsonObject(content);
    let decision = String(data.decision || 'ask_user');
    if (!['retry', 'ask_user', 'skip', 'stop'].includes(decision)) decision = 'ask_user';
    let type = data.type != null && data.type !== '' ? String(data.type) : undefined;
    if (type && !STEP_TYPES.includes(type as PlanStepType)) type = undefined;
    return {
      decision: decision as 'retry' | 'ask_user' | 'skip' | 'stop',
      type: type as PlanStepType | undefined,
      query: data.query != null ? String(data.query).trim() : undefined,
      message: String(data.message || data.reason || '').trim() || '请手动继续。',
    };
  }
}
