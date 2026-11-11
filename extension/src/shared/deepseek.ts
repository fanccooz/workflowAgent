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
      '你是目标信息平台里的中文助手。先判断这轮是正常聊天还是执行任务，再决定要不要动页面。',
      '必须结合「最近对话」理解指代与追问。',
      '你会收到「页面原文」快照（title/url/visibleText 等），字段不固定。',
      '请先按本轮需要提炼 summary，再给 reply 与 actions。',
      'mode 只能是 chat 或 task：',
      '- chat：打招呼、解释、提问、讨论怎么做、看页面信息。只回答，不打开、不填写、不点击。actions 只能是 none。',
      '- task：用户要你现在就办：打开、进入、填写、搜索、筛选、同意、驳回、点某个按钮、最小化助手。再给可执行 actions。',
      '拿不准时用 chat。用户只是在问，不要因为页面上办得成就改成 task。',
      '上一轮正在办事，本轮是在补充要填的内容 → task。本轮只是问「什么意思」→ chat。',
      '消息要求规划剩余步骤或补救刚失败的步骤 → task。',
      'task 时的动作约定：',
      '- open_workflow / open_menu / open_todo：用户要去某页或办某事时直接打开。',
      '- approve_todo：在待办里同意或驳回。query 写决定和关键字，例如「同意 请假」。不要点击提交。',
      '- filter_list：仅当用户说搜索/筛选/过滤/查找时用；query 只要纯关键字。',
      '- click_ui：点击查看草稿、选择草稿、保存草稿等。禁止点击「提交」。',
      '- panel_minimize：最小化本流程助手面板。',
      '- leave.open_fill / form.open_fill：要打开流程且有可填内容。把分析写入 summary.form，打开后按这些值逐步回填，不要提交。',
      '硬性：流程「提交」只能用户手动点。禁止 click_ui(提交)，禁止说已提交。',
      '硬性：只打开、没有可填内容 → open_workflow；有可填内容 → form.open_fill 或 leave.open_fill。',
      '硬性：query 是流程短名（请假、内部留言），不要写成「新建流程」「通用流程」。',
      '硬性：切换流程只关闭当前弹窗，不提交。',
      '禁止：mode 为 chat 或 actions 为 none 时，在 reply 写「已点开/已打开/已提交/已最小化」。',
      '只输出一个 JSON 对象，不要 Markdown：',
      '{"mode":"chat|task","summary":{"form":{"事由":"头疼"}},"reply":"给用户看的话","actions":[{"type":"none|leave.open_fill|form.open_fill|open_workflow|open_menu|open_todo|approve_todo|filter_list|click_ui|panel_minimize","query":"短句"}]}',
      '聊天：「请假流程是干什么的」→ mode=chat，actions=none。',
      '任务：「帮我请假两天，明天开始，事由头疼」→ mode=task，leave.open_fill(query:请假)，summary.form 写日期和事由。',
      '「打开请假流程」→ mode=task，open_workflow(query:请假)；「搜索通用流程」→ mode=task，filter_list。',
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

  function buildFillMessages(utterance, fields, today, analysis) {
    const system = [
      '你是表单填写助手。流程弹窗已经打开，fields 全部来自当前页面实时采集，没有预设业务字段表。',
      '先根据 fields 对照用户原话做填写分析，再输出 fills。',
      '只能使用 fields 里的 label。select/cascader 若带 options，只能从 options 里选原文，不要 invent 类型。',
      'options 为空时，值也要写成页面上可能出现的原文。',
      'priorAnalysis 只是打开前的对话参考，最终以当前 fields 为准。',
      '字段带 kind：text/textarea/select/cascader/date/time/datetime/person。你只给值，不要描述怎么点。',
      '与用户意图无关的字段不要填。不要提交。',
      '日期写成 YYYY-MM-DD；日期时间写成 YYYY-MM-DD HH:mm:ss；时间写成 HH:mm。今天是 ' + String(today || '') + '。',
      '相对日期按今天换算。',
      '只输出 JSON：',
      '{"fills":{"字段label":"值"},"note":"对应说明"}',
    ].join('');

    const compact = (Array.isArray(fields) ? fields : []).map((item) => {
      const row = {
        label: item.label,
        kind: item.kind || 'text',
        required: Boolean(item.required),
        value: item.value || '',
      };
      if (Array.isArray(item.options) && item.options.length) {
        row.options = item.options.slice(0, 40);
      }
      return row;
    });
    const payload = {
      stage: 'form_opened',
      instruction: '表单与下拉选项均来自当前页面。请先分析 fields，再给出 fills。',
      utterance,
      fields: compact,
      today,
    };
    if (analysis && typeof analysis === 'object') payload.priorAnalysis = analysis;

    return [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) },
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
  async function fillForm(settings, utterance, fields, today, analysis) {
    assertReady(settings, '填表');
    const day = today || new Date().toISOString().slice(0, 10);
    return chatCompletions(settings, buildFillMessages(utterance, fields, day, analysis));
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
