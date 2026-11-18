// @ts-nocheck
/** DeepSeek 原生 function calling 工具定义（与 executeChatAction 对齐） */

export const MAX_TOOL_ROUNDS = 6;

/** OpenAI/DeepSeek tools 列表 */
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'close_dialog',
      description: '关闭当前流程申请弹窗（取消→确认关闭），不提交。换页前若有挡路弹窗先调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_menu',
      description: '打开侧栏/菜单页面。query 用菜单短名或用户原话里的页面目标，优先可进页的叶子菜单（如请假记录），不要只点文件夹。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '菜单名称或用户原话中的目标，如「考勤」「请假记录」「首页」' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_workflow',
      description: '打开流程定义里的某条流程发起弹窗。query 用流程短名，如「请假」「内部留言」。只打开、无可填内容时用这个。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '流程短名' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_todo',
      description: '进入我的待办列表。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选，默认我的待办' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'filter_list',
      description: '仅在当前列表页搜索/筛选。query 只要纯关键字。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键字' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_ui',
      description: '点击页面按钮，如查看草稿、保存草稿。禁止点击提交。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '按钮文案' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_todo',
      description: '在待办里同意或驳回。query 如「同意 请假」「驳回 加班」。不要点提交。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '决定+关键字' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'panel_minimize',
      description: '最小化本流程助手面板（不是关业务弹窗）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leave_open_fill',
      description: '打开流程并按用户话回填（如请假），不要提交。有可填内容时用；只打开用 open_workflow。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '流程短名，默认请假相关' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'form_open_fill',
      description: '打开非请假流程并回填用户提到的字段，不要提交。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '流程短名' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

const TOOL_TO_ACTION = {
  close_dialog: 'close_dialog',
  open_menu: 'open_menu',
  open_workflow: 'open_workflow',
  open_todo: 'open_todo',
  filter_list: 'filter_list',
  click_ui: 'click_ui',
  approve_todo: 'approve_todo',
  panel_minimize: 'panel_minimize',
  leave_open_fill: 'leave.open_fill',
  form_open_fill: 'form.open_fill',
};

export function toolNameToActionType(name) {
  const key = String(name || '').trim();
  return TOOL_TO_ACTION[key] || null;
}

export function parseToolCallArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return { query: text };
  }
}

export function toolCallToAction(toolCall) {
  const fn = toolCall && toolCall.function ? toolCall.function : {};
  const type = toolNameToActionType(fn.name);
  if (!type) return null;
  const args = parseToolCallArguments(fn.arguments);
  const query = String(args.query || args.keyword || args.name || '').trim();
  return { type, query };
}

export function buildToolChatMessages(utterance, history, pageRaw) {
  const system = [
    '你是目标信息平台里的中文助手，通过 function tools 操作页面。',
    '纯聊天、解释、提问：直接用自然语言回复，不要调用工具。',
    '用户要办事：按需调用工具；可根据工具返回的页面结果再决定下一步。',
    '硬性：不要点击或声称已「提交」流程；提交只能用户手动点。',
    '换页前若页面 hasBlockingDialog=true，先 close_dialog。',
    '打开菜单优先叶子页面；文件夹不够。',
    '有可填内容用 leave_open_fill / form_open_fill；只打开用 open_workflow。',
    '工具失败时可根据返回信息换参数再试，或向用户说明。',
  ].join('');

  const messages = [{ role: 'system', content: system }];
  const prior = Array.isArray(history) ? history : [];
  for (const item of prior.slice(-40)) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const content = String(item.content || '').trim().slice(0, 800);
    if (!content) continue;
    messages.push({ role: item.role, content });
  }
  const page = pageRaw && typeof pageRaw === 'object' ? pageRaw : null;
  const compactPage = page
    ? {
      title: page.title || '',
      hash: page.hash || '',
      hasDialog: Boolean(page.hasDialog),
      hasBlockingDialog: Boolean(page.hasBlockingDialog),
      hasConfirmClose: Boolean(page.hasConfirmClose),
      dialogText: String(page.dialogText || '').slice(0, 500),
      visibleText: String(page.visibleText || '').slice(0, 2500),
    }
    : null;
  const parts = [`用户本轮说：${String(utterance || '').trim()}`];
  if (compactPage) parts.push(`当前页面：${JSON.stringify(compactPage)}`);
  messages.push({ role: 'user', content: parts.join('\n') });
  return messages;
}

export function summarizeToolResult(action, result, pageRaw) {
  const res = result || {};
  return JSON.stringify({
    tool: action && action.type,
    query: action && action.query,
    status: res.status || '',
    ok: !['error', 'none', 'disabled'].includes(String(res.status || '')),
    message: String(res.message || '').slice(0, 500),
    choices: Array.isArray(res.choices)
      ? res.choices.slice(0, 8).map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
      }))
      : undefined,
    page: pageRaw
      ? {
        title: pageRaw.title || '',
        hash: pageRaw.hash || '',
        hasBlockingDialog: Boolean(pageRaw.hasBlockingDialog),
        hasConfirmClose: Boolean(pageRaw.hasConfirmClose),
      }
      : undefined,
  });
}
