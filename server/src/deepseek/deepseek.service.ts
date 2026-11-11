import { Injectable, Logger } from '@nestjs/common';

const STEP_TYPES = [
  'none',
  'leave.open_fill',
  'form.open_fill',
  'open_workflow',
  'open_menu',
  'open_todo',
  'approve_todo',
  'filter_list',
  'click_ui',
  'panel_minimize',
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
      const query = String(row.query || '').trim();
      if (type === 'click_ui' && /提交/.test(query) && !/不提交/.test(query)) continue;
      steps.push({ type, query });
    }
    return steps;
  }

  /** 入库前校验客户端或模型给出的步骤，丢掉提交点击。 */
  acceptSteps(raw: unknown): PlanStep[] {
    return this.sanitizeSteps(raw);
  }

  /** 某步失败后，重规划还没做完的步骤。 */
  async replanRemaining(payload: {
    utterance: string;
    failedStep?: { type?: string; query?: string; seq?: number };
    lastError?: string;
    pageSummary?: Record<string, unknown>;
    history?: Array<{ role?: string; content?: string }>;
    doneSteps?: Array<{ type?: string; query?: string }>;
  }): Promise<{ reply: string; steps: PlanStep[] }> {
    const system = [
      '你是企业信息平台的任务规划器。某一步刚刚失败，请只规划还没做完的步骤。',
      '不要重复已经成功的步骤。无法继续时 steps 为空数组。',
      '禁止规划点击「提交」。提交只能由用户手动完成。',
      '有可填内容用 leave.open_fill 或 form.open_fill。',
      '只输出 JSON：{"reply":"一句话","steps":[{"type":"...","query":"..."}]}',
      `合法 type：${STEP_TYPES.filter((item) => item !== 'none').join('、')}`,
    ].join('\n');
    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }];
    for (const item of this.normalizeHistory(payload?.history, 20)) {
      messages.push(item);
    }
    messages.push({
      role: 'user',
      content: JSON.stringify({
        utterance: payload?.utterance || '',
        failedStep: payload?.failedStep || null,
        lastError: payload?.lastError || '',
        doneSteps: payload?.doneSteps || [],
        page: payload?.pageSummary || {},
      }),
    });
    const content = await this.chatCompletions(messages);
    const data = this.parseJsonObject(content);
    return {
      reply: String(data.reply || data.message || '').trim() || '已重新规划剩余步骤。',
      steps: this.sanitizeSteps(data.steps),
    };
  }

  async generateChatBoxSuggestions(userMessages: string[], previous: string[] = []): Promise<string[]> {
    const system = [
      '你根据用户最近在流程助手里的输入，给出 3 条不同的「下一次可能直接键入」的中文短句。',
      '只输出 JSON：{"suggestions":["短句1","短句2","短句3"]}',
      '三条必须互不相同，分别对应最近聊天里不同的办事意图，不要三条都照抄同一句历史输入。',
      '若提供了 previous，三条都不要与 previous 里的句子完全相同。',
      '每条不超过 40 字，可直接粘贴进输入框。无法归纳则 {"suggestions":[]}',
    ].join('');

    const recent = userMessages.slice(0, 30).map((text, i) => `${i + 1}. ${text}`).join('\n');
    const content = await this.chatCompletions(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            recent,
            previous: previous.slice(0, 3),
          }),
        },
      ],
      0.7,
    );
    let data: Record<string, unknown> = {};
    try {
      data = this.parseJsonObject(content);
    } catch {
      return [];
    }
    const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const item of raw) {
      const text = String(item || '').replace(/^["「]|["」]$/g, '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      suggestions.push(text);
      if (suggestions.length >= 3) break;
    }
    return suggestions;
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
      '你是企业信息平台的任务规划器。先区分正常聊天和执行任务。',
      '必须只输出一个 JSON 对象，不要 Markdown、不要解释。',
      '格式：{"mode":"chat|task","reply":"一句话说明","steps":[{"type":"...","query":"..."}]}',
      'chat：提问、解释、讨论、看页面信息。steps 必须是空数组，不要打开页面。',
      'task：用户要你现在就去页面上办，再拆步骤。拿不准时用 chat。',
      '要求规划剩余步骤或补救失败步骤时用 task。',
      'type 只能是：open_todo、approve_todo、open_menu、open_workflow、filter_list、leave.open_fill、form.open_fill、click_ui、panel_minimize。',
      '待办里同意或驳回用 approve_todo，不要点击提交。',
      '有可填内容用 leave.open_fill 或 form.open_fill，不要只打开。禁止 click_ui 的 query 为「提交」。',
      '只有 mode=task 才给步骤。用户要去某页或办某事时直接给 open_*，不要说不能打开。提问不要因为当前页办不了就改成打开。',
      '【打开 vs 搜索】',
      '- 打开/进入/发起/新建/去某页 = open_workflow / open_menu / open_todo。',
      '- 仅在当前页搜索/筛选 = filter_list（query 只要纯关键字）。',
      '- 需要先换页再搜 = 先 open_* 再 filter_list。',
      '对照例子：',
      '打开请假流程 → open_workflow；进入人事 → open_menu；去我的待办 → open_todo。',
      '搜索备注中有吃的（已在列表页）→ 仅 filter_list(query=吃)。',
      '打开我的待办再筛选通用流程 → open_todo + filter_list。',
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
          'page 可能是页面原文或模型自设摘要，字段不固定，请自行理解。打开=跳页；搜索=当前页 filter_list。二者不要混。',
      }),
    });

    const content = await this.chatCompletions(messages);
    const data = this.parseJsonObject(content);
    const mode = String(data.mode || '').trim().toLowerCase();
    let reply = String(data.reply || data.message || '').trim();
    if (mode === 'chat') {
      return { reply: reply || '好的。', steps: [] };
    }
    let steps = this.sanitizeSteps(data.steps);
    const ensured = this.ensureNavAndFilterSteps(utterance, steps, {
      history: options?.history,
      pageSummary: options?.pageSummary,
    });
    steps = ensured.steps;
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
    return /打开|进入|发起|新建|帮我开|(?:^|[，,。；;])去/.test(String(text || ''));
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

  private saidSearchOnly(text: string): boolean {
    const raw = String(text || '');
    return /筛选|过滤|搜索|查找/.test(raw) && !this.saidOpenOrEnter(raw) && !this.saidTodo(raw);
  }

  /** 仅在「纯当前页搜索」时裁掉跳页；其余信任模型步骤 */
  private stripUnauthorizedNavigation(text: string, steps: PlanStep[]): PlanStep[] {
    const list = Array.isArray(steps) ? steps.slice() : [];
    if (this.saidSearchOnly(text)) {
      return list.filter((step) => step.type === 'filter_list');
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
    const keyword = this.extractFilterKeyword(text);

    // 纯搜索且未要求换页：当前页 filter_list
    if (this.saidSearchOnly(text) && !wantsNav) {
      list = list.filter((step) => step.type === 'filter_list');
      if (!list.length && keyword) list = [{ type: 'filter_list', query: keyword }];
      else if (list.length && keyword) {
        list = list.map((step) => ({ ...step, query: step.query || keyword }));
      }
      return { steps: list, askUser: false };
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
