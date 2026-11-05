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
  async function chatCompletions(settings, messages) {
    const base = String(settings.baseUrl || API_DEFAULTS.baseUrl).replace(/\/$/, '');
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || API_DEFAULTS.model,
        temperature: 0,
        messages,
      }),
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

  function buildChatMessages(utterance, history) {
    const system = [
      '你是目标信息平台里的对话助手，用中文简短自然地回复。',
      '每一轮你既要对话，也要判断要不要让前端去操作系统页面。',
      '用户一句话里若有多个要求，必须拆成多个步骤，按执行顺序全部放入 actions，不要只返回第一步。',
      '只输出一个 JSON 对象，不要 Markdown，不要解释。格式：',
      '{"reply":"给用户看的话","actions":[{"type":"none|leave.open_fill|open_workflow|open_menu|open_todo|filter_list","query":"短句"}]}',
      '规则：闲聊、询问、信息不全 → actions 里一项 type=none，在 reply 里说明或追问。',
      '用户要请假或发起并填写表单（含日期/事由等）→ leave.open_fill，query 建议「打开请假」。',
      '用户只要打开某流程、不填表 → open_workflow，query 如「打开请假」或「打开出差」。',
      '用户要进菜单/页面 → open_menu；要待办列表 → open_todo。',
      '用户要在任意列表/查询页按关键字筛选、过滤、搜索 → filter_list，query 只写关键字；先导航再筛选。',
      '示例：「待办里筛通用流程」→ open_todo + filter_list；「打开流程定义搜索请假」→ open_menu + filter_list。',
      'query 要短；具体填哪些框由后续按页面字段再推理，不要把长段说明塞进 query。',
    ].join('');

    const messages = [{ role: 'system', content: system }];
    const prior = Array.isArray(history) ? history : [];
    for (const item of prior.slice(-12)) {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
      const content = String(item.content || '').trim();
      if (!content) continue;
      messages.push({ role: item.role, content });
    }
    messages.push({ role: 'user', content: String(utterance || '') });
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

  /** 对话 + 决定动作 */
  async function chat(settings, utterance, history) {
    assertReady(settings, '对话');
    return chatCompletions(settings, buildChatMessages(utterance, history));
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
