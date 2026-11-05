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

  private normalizeHistory(
    history: Array<{ role?: string; content?: string }> | undefined,
    limit = 40,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const prior = Array.isArray(history) ? history : [];
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const item of prior.slice(-limit)) {
      if (!item) continue;
      const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
      if (!role) continue;
      const content = String(item.content || '').trim().slice(0, 800);
      if (!content) continue;
      out.push({ role, content });
    }
    return out;
  }

  /** 把用户原话拆成有序可执行步骤（只规划，不操作页面） */
  async planTaskSteps(
    utterance: string,
    options?: {
      history?: Array<{ role?: string; content?: string }>;
      pageSummary?: Record<string, unknown>;
    },
  ): Promise<{ reply: string; steps: PlanStep[] }> {
    const system = [
      '你是企业信息平台的任务规划器，把用户指令拆成可执行步骤。',
      '必须只输出一个 JSON 对象，不要 Markdown、不要解释。',
      '格式：{"reply":"一句话说明","steps":[{"type":"...","query":"..."}]}',
      'type 只能是：open_todo、open_menu、open_workflow、filter_list、leave.open_fill。',
      '硬性规则（违反即错）：',
      '1) 用户没说「打开/进入/去」时，禁止 open_menu、open_workflow，禁止跳到其他页面。',
      '2) 用户没说「待办」时，禁止 open_todo，禁止进入我的待办。',
      '3) 本句只是搜索/筛选/按备注查：已在当前列表页 → 只输出 filter_list；否则 steps=[] 并追问，绝不猜待办。',
      '4) filter_list 的 query 只放关键字；多要求就多步；纯闲聊 steps=[]。',
      '对照例子：',
      '上文已在加班页，输入：搜索备注中有吃的数据',
      '输出：{"reply":"在当前页筛选","steps":[{"type":"filter_list","query":"吃"}]}',
      '输入：搜索备注中有吃的数据（未说打开/进入/待办）',
      '输出：{"reply":"请先说明在哪个页面搜索，或说「打开某某页面」后再搜。","steps":[]}',
      '输入：打开我的待办，筛选通用流程',
      '输出：{"reply":"先打开待办再筛选","steps":[{"type":"open_todo","query":"我的待办"},{"type":"filter_list","query":"通用流程"}]}',
      '输入：打开请假流程',
      '输出：{"reply":"好的，打开请假","steps":[{"type":"open_workflow","query":"打开请假"}]}',
    ].join('\n');

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }];
    for (const item of this.normalizeHistory(options?.history, 40)) {
      messages.push(item);
    }
    const page = options?.pageSummary && Object.keys(options.pageSummary).length
      ? options.pageSummary
      : null;
    messages.push({
      role: 'user',
      content: JSON.stringify({
        utterance: String(utterance || ''),
        page,
        instruction:
          '没说打开/进入就不要跳页；没说待办就不要进待办；只搜索则当前页 filter_list 或追问。',
      }),
    });

    const content = await this.chatCompletions(messages);
    const data = this.parseJsonObject(content);
    let steps = this.sanitizeSteps(data.steps);
    const ensured = this.ensureNavAndFilterSteps(utterance, steps, {
      history: options?.history,
      pageSummary: options?.pageSummary,
    });
    steps = ensured.steps;
    let reply = String(data.reply || data.message || '').trim();
    if (ensured.askUser) {
      reply =
        reply && /[?？]/.test(reply)
          ? reply
          : ensured.askMessage || '要在哪个页面搜索？可以说当前页、待办、加班或其他菜单。';
    } else if (!reply) {
      reply = steps.length ? '好的，已拆成步骤。' : '好的。';
    }
    return { reply, steps };
  }

  private extractFilterKeyword(text: string): string {
    const raw = String(text || '').replace(/\s+/g, '');
    const patterns = [
      /备注(?:中|里)?(?:有|含|为|是|:|：)\s*([^，,。；;的数据]+)/,
      /筛选([^的数据页面列表]+)/,
      /过滤([^的数据页面列表]+)/,
      /搜索(?:备注(?:中|里)?(?:有|含|为|是|:|：)?)?([^的数据页面列表]+)/,
      /查找([^的数据页面列表]+)/,
      /跟([^有关相关]+)/,
    ];
    for (const pattern of patterns) {
      const hit = raw.match(pattern);
      if (hit && hit[1]) {
        const keyword = hit[1]
          .replace(/^(页面|列表|数据|有关|相关|备注[为是:：]?)/, '')
          .replace(/的数据$/, '')
          .trim();
        if (keyword) return keyword;
      }
    }
    return '';
  }

  private saidTodo(text: string): boolean {
    return /待办/.test(String(text || ''));
  }

  private saidOpenOrEnter(text: string): boolean {
    return /打开|进入|(?:^|[，,。；;])去/.test(String(text || ''));
  }

  /** 用户明确要求跳页时才允许导航类步骤 */
  private wantsExplicitNavigation(text: string): boolean {
    const raw = String(text || '').replace(/\s+/g, '');
    return this.saidTodo(raw) || this.saidOpenOrEnter(raw);
  }

  private looksLikeAlreadyOnListPage(
    pageSummary?: Record<string, unknown>,
    history?: Array<{ role?: string; content?: string }>,
  ): boolean {
    const page = pageSummary || {};
    const hash = String(page.hash || '');
    const title = String(page.title || '');
    const crumbs = Array.isArray(page.breadcrumbs) ? page.breadcrumbs.join('') : '';
    const active = Array.isArray(page.activeMenu) ? page.activeMenu.join('') : '';
    const labels = Array.isArray(page.formLabels) ? page.formLabels : [];
    if (hash && hash !== '#/' && !/#\/login/i.test(hash)) return true;
    if (active || crumbs) return true;
    if (labels.length >= 2) return true;
    if (/列表|查询|待办|加班|流程/.test(`${title}${crumbs}${active}`)) return true;
    const hist = (history || [])
      .slice(-6)
      .map((item) => String(item?.content || ''))
      .join('\n');
    return /已打开菜单|已进入|已打开流程|已尝试进入|打开菜单「/.test(hist);
  }

  /** 按用户原话硬裁剪导航步骤：没说的页面绝不跳 */
  private stripUnauthorizedNavigation(text: string, steps: PlanStep[]): PlanStep[] {
    let list = Array.isArray(steps) ? steps.slice() : [];
    const todo = this.saidTodo(text);
    const openEnter = this.saidOpenOrEnter(text);
    if (!todo) list = list.filter((step) => step.type !== 'open_todo');
    if (!openEnter) {
      list = list.filter((step) => step.type !== 'open_menu' && step.type !== 'open_workflow');
    }
    return list;
  }

  private ensureNavAndFilterSteps(
    utterance: string,
    steps: PlanStep[],
    ctx?: {
      history?: Array<{ role?: string; content?: string }>;
      pageSummary?: Record<string, unknown>;
    },
  ): { steps: PlanStep[]; askUser: boolean; askMessage?: string } {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = this.stripUnauthorizedNavigation(text, steps);
    const wantsFilter = /筛选|过滤|搜索|查找|备注/.test(text);
    const wantsNav = this.wantsExplicitNavigation(text);
    const alreadyOnPage = this.looksLikeAlreadyOnListPage(ctx?.pageSummary, ctx?.history);
    const keyword = this.extractFilterKeyword(text);
    const askMessage = keyword
      ? `当前要在本页搜索「${keyword}」吗？若要换页，请先说「打开/进入某某页面」；要进待办请明确说「待办」。`
      : '请先说明在哪个页面操作。若要换页请说「打开/进入某某」；要进待办请明确说「待办」。';

    // 未要求跳页 + 只是搜索/筛选
    if (wantsFilter && !wantsNav) {
      if (alreadyOnPage) {
        list = list.filter((step) => step.type === 'filter_list');
        if (!list.length && keyword) list = [{ type: 'filter_list', query: keyword }];
        else if (list.length && keyword) {
          list = list.map((step) => ({ ...step, query: step.query || keyword }));
        }
        return { steps: list, askUser: false };
      }
      return { steps: [], askUser: true, askMessage };
    }

    const hasNav = list.some((s) => ['open_todo', 'open_menu', 'open_workflow'].includes(s.type));
    if (!hasNav && wantsNav) {
      if (this.saidTodo(text)) list.unshift({ type: 'open_todo', query: '我的待办' });
      else if (this.saidOpenOrEnter(text)) {
        const menuHit = text.match(/(?:打开|进入|去)([^，,。筛选过滤搜索查询页面列表]{2,16})(?:页面|列表|模块|菜单)?/);
        if (menuHit && menuHit[1] && !/请假|出差|流程助手|待办/.test(menuHit[1])) {
          list.unshift({ type: 'open_menu', query: menuHit[1] });
        }
      }
    }
    if (wantsFilter && !list.some((s) => s.type === 'filter_list') && keyword) {
      list.push({ type: 'filter_list', query: keyword });
    }
    list = this.stripUnauthorizedNavigation(text, list);
    return { steps: list, askUser: false };
  }

  /** 某步失败后，根据页面摘要决定重试/改参数/停下 */
  async actOnStepFailure(payload: {
    utterance: string;
    step: { type: string; query: string; seq: number };
    lastError: string;
    pageSummary?: Record<string, unknown>;
    history?: Array<{ role?: string; content?: string }>;
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
      '可参考最近对话与页面摘要理解用户真实意图。',
      `合法 type：${STEP_TYPES.filter((t) => t !== 'none').join('|')}`,
    ].join('');

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }];
    for (const item of this.normalizeHistory(payload?.history, 20)) {
      messages.push(item);
    }
    messages.push({
      role: 'user',
      content: JSON.stringify({
        utterance: payload?.utterance,
        step: payload?.step,
        lastError: payload?.lastError,
        pageSummary: payload?.pageSummary || {},
      }),
    });
    const content = await this.chatCompletions(messages);
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
