// @ts-nocheck

  const API_DEFAULTS = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  };

  function assertReady(settings, featureLabel) {
    if (!settings || !settings.enabled) {
      throw new Error(`AI ${featureLabel}已关闭`);
    }
    if (!settings.apiKey) {
      throw new Error('未配置 DeepSeek API Key');
    }
  }

  /** 发起 DeepSeek Chat Completions 请求，返回助手文本内容 */
  async function chatCompletions(settings, messages, options) {
    const opts = options || {};
    const base = String(settings.baseUrl || API_DEFAULTS.baseUrl).replace(/\/$/, '');
    const body = {
      model: settings.model || API_DEFAULTS.model,
      temperature: opts.temperature == null ? 0 : opts.temperature,
      messages,
    };
    if (opts.jsonObject) {
      body.response_format = { type: 'json_object' };
    }
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error && payload.error.message
        ? payload.error.message
        : `模型请求失败（${response.status}）`;
      throw new Error(message);
    }
    const content = payload.choices
      && payload.choices[0]
      && payload.choices[0].message
      && payload.choices[0].message.content;
    if (!content) throw new Error('模型没有返回内容');
    return content;
  }

  function buildDecideMessages(utterance, scope, candidates) {
    const system = [
      '你是华荣照明信息平台助手。只能从给定候选中选择。',
      '候选有 type：workflow（流程）、menu（菜单）、todo（待办）。不要把不同类型混为一谈。',
      '若 scope 为 workflow：只能选 workflow；仅一条高置信时 decision=open。',
      '仅一条高置信可打开：decision=open，并填 type、id、title。',
      '同类型多条或不确定：decision=choose，candidates 最多 8 条且尽量同一 type。',
      '没有合适项：decision=none。',
      '只输出 JSON，不要 Markdown，不要解释。',
    ].join('');

    const compact = (Array.isArray(candidates) ? candidates : []).map((item) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      subtitle: item.subtitle || '',
    }));

    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: JSON.stringify({ utterance, scope, candidates: compact }),
      },
    ];
  }

  function normalizeHistory(history, limit = 40) {
    const prior = Array.isArray(history) ? history : [];
    const out = [];
    for (const item of prior.slice(-limit)) {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
      const content = String(item.content || '').trim().slice(0, 800);
      if (!content) continue;
      out.push({ role: item.role, content });
    }
    return out;
  }

  function buildChatMessages(utterance, history, pageRaw) {
    const system = [
      '你是目标信息平台里的中文助手。由你判断用户意图并决定动作，本地不会用关键字抢答。',
      '必须结合「最近对话」理解指代与追问。',
      '你会收到「页面原文」快照（title/url/visibleText 等），字段不固定。',
      '请你先按本轮对话需要，自行提炼 summary（字段名与内容都由你决定），再据此回答与办事。',
      '动作约定：',
      '- none：闲聊、或仅问答当前页信息（如有多少条）。',
      '- open_workflow / open_menu / open_todo：用户要去某页、办某事、看某模块，或当前页办不成需要换页时，直接打开，不要说「不能打开」。',
      '- filter_list：仅当用户说搜索/筛选/过滤/查找时用；query 只要纯关键字。',
      '- click_ui：点击当前页/弹窗可见按钮（查看草稿、选择草稿、保存草稿、提交等），query=按钮原文；可多步按顺序多个 actions。',
      '- panel_minimize：最小化本流程助手面板。',
      '- leave.open_fill：请假并填表。',
      '硬性：已经知道要点哪个按钮来完成用户目标时，必须输出 click_ui（并写入 summary.nextClicks），禁止只口头说「你可以点提交」而不给 actions。',
      '硬性：用户说「打开/发起/新建…流程」→ open_workflow；说搜索/筛选 → filter_list；说帮我点/提交/保存草稿 → click_ui。',
      '硬性：open_workflow 的 query 必须是用户要开的流程名短词（如「请假」），禁止写成「新建流程」「新建流程入口」「通用流程」等与用户原话不符的词；即使当前不在流程定义页，也直接 open_workflow(请假)，由本地跳转列表再打开。',
      '硬性：用户说最小化/收起流程助手 → panel_minimize。',
      '禁止：actions 为 none 时在 reply 写「已点开/已打开/已提交/已最小化」。',
      '只输出一个 JSON 对象，不要 Markdown：',
      '{"summary":{"nextClicks":["按钮名"]},"reply":"给用户看的话","actions":[{"type":"none|leave.open_fill|open_workflow|open_menu|open_todo|filter_list|click_ui|panel_minimize","query":"短句"}]}',
      '示例：「打开请假流程」→ open_workflow(query:请假)；「帮我点查看草稿」→ click_ui(查看草稿)。',
      '「最小化流程助手」→ panel_minimize；「搜索通用流程」→ filter_list。',
    ].join('');

    const messages = [{ role: 'system', content: system }];
    const prior = normalizeHistory(history, 40);
    for (const item of prior) {
      messages.push(item);
    }
    const page = pageRaw && typeof pageRaw === 'object' ? pageRaw : null;
    const parts = [`用户本轮说：${String(utterance || '').trim()}`];
    if (page) {
      parts.push(`页面原文：${JSON.stringify(page)}`);
      parts.push('请先自设 summary，再给出 reply 与 actions；reply 要有实质内容。');
    }
    if (prior.length) parts.push('请务必结合上面的最近对话作答。');
    messages.push({ role: 'user', content: parts.join('\n') });
    return messages;
  }

  function buildFillMessages(utterance, fields, today) {
    const system = [
      '你是表单填写助手。根据用户原话，为给定表单字段生成要填入的值。',
      '只能使用字段列表里出现的 label，不要发明新字段名。',
      '用户没提到的字段不要填（不要瞎编）。',
      '日期请写成 YYYY-MM-DD；今天是 ' + String(today || '') + '。',
      '相对日期（明天、后天、下周三等）请换算成具体日期。',
      '只输出 JSON，不要 Markdown：',
      '{"fills":{"字段label":"值"},"note":"可选说明"}',
    ].join('');

    const compact = (Array.isArray(fields) ? fields : []).map((item) => ({
      label: item.label,
      kind: item.kind || 'text',
      required: Boolean(item.required),
      value: item.value || '',
    }));

    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: JSON.stringify({ utterance, fields: compact, today }),
      },
    ];
  }

  /** 对话 + 决定动作（pageRaw 为页面原文快照；摘要由模型在返回的 summary 里自设） */
  async function chat(settings, utterance, history, pageRaw) {
    assertReady(settings, '对话');
    return chatCompletions(settings, buildChatMessages(utterance, history, pageRaw), {
      temperature: 0.4,
      jsonObject: true,
    });
  }

  /** 从候选里选流程/菜单/待办 */
  async function decide(settings, utterance, scope, candidates) {
    assertReady(settings, '搜索');
    return chatCompletions(settings, buildDecideMessages(utterance, scope, candidates));
  }

  /** 按页面字段拆解回填值 */
  async function fillForm(settings, utterance, fields, today) {
    assertReady(settings, '填表');
    const day = today || new Date().toISOString().slice(0, 10);
    return chatCompletions(settings, buildFillMessages(utterance, fields, day));
  }

  function buildReflectMessages(payload) {
    const system = [
      '你是华荣流程助手的失败反思模块。某一步工具刚失败，请决定如何补救。',
      '只输出 JSON，不要 Markdown：',
      '{"decision":"retry|ask_user|stop","tool":"goto_workflow_list|open_workflow|ai_fill_form|","args":{},"message":"给用户看的一句话","reason":"简短原因"}',
      '规则：',
      '- 列表加载异常 / 进不去流程定义 → decision=retry，tool=goto_workflow_list',
      '- 打不开流程、名称匹配失败 → decision=retry，tool=open_workflow，args.query 给更短的匹配词（如「请假」）',
      '- 填表失败可再试一次 ai_fill_form；若像是日期控件写不进 → ask_user，让用户手补',
      '- 未登录、权限、找不到关键按钮 → stop 或 ask_user',
      '- 不要发明列表外的 tool 名；不确定时 ask_user',
    ].join('');

    return [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload || {}) },
    ];
  }

  /** 工具失败后的反思：返回模型原文 JSON 字符串 */
  async function reflect(settings, payload) {
    assertReady(settings, '反思');
    return chatCompletions(settings, buildReflectMessages(payload));
  }

export {
API_DEFAULTS,
    chatCompletions,
    buildDecideMessages,
    buildChatMessages,
    buildFillMessages,
    buildReflectMessages,
    chat,
    decide,
    fillForm,
    reflect,
};

const DeepSeek = { API_DEFAULTS, chatCompletions, buildDecideMessages, buildChatMessages, buildFillMessages, buildReflectMessages, chat, decide, fillForm, reflect };
export default DeepSeek;
