// @ts-nocheck
import { fillsFromSummary, inferWorkflowQuery } from './formfill';

  const DEFAULT_KEYWORDS = {
    workflow: ['流程', '打开', '发起', '新建', '填写'],
    menu: ['菜单', '进入', '模块', '页面', '导航'],
    todo: ['待办', '待我审批', '我的待办', '待审'],
  };

  function splitKeywords(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '')
      .split(/[,，、\n|/]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function mergeKeywords(custom) {
    const source = custom || {};
    return {
      workflow: unique(splitKeywords(source.workflowKeywords).concat(DEFAULT_KEYWORDS.workflow)),
      menu: unique(splitKeywords(source.menuKeywords).concat(DEFAULT_KEYWORDS.menu)),
      todo: unique(splitKeywords(source.todoKeywords).concat(DEFAULT_KEYWORDS.todo)),
    };
  }

  function unique(list) {
    const seen = new Set();
    const result = [];
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
    return result;
  }

  function includesAny(text, words) {
    return words.some((word) => word && text.includes(word));
  }

  function detectScope(utterance, customKeywords) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (!text) return 'all';
    const words = mergeKeywords(customKeywords);
    const hasMenuWord = includesAny(text, words.menu);
    const hasTodoWord = includesAny(text, words.todo);
    const hasWorkflowMarker = text.includes('流程')
      || includesAny(text, words.workflow.filter((word) => !['打开', '发起', '新建', '填写'].includes(word)));

    if (hasTodoWord) return 'todo';
    // 带菜单类词优先当菜单（避免「流程定义」等菜单名里的「流程」被误判）
    if (hasMenuWord) return 'menu';
    if (hasWorkflowMarker) return 'workflow';
    if (includesAny(text, ['打开', '发起', '新建', '填写'])) return 'workflow';
    if (includesAny(text, words.workflow)) return 'workflow';
    return 'all';
  }

  function filterByScope(candidates, scope) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!scope || scope === 'all') return list.slice();
    return list.filter((item) => item && item.type === scope);
  }

  function groupCandidates(candidates) {
    const groups = { workflow: [], menu: [], todo: [] };
    for (const item of Array.isArray(candidates) ? candidates : []) {
      if (!item || !groups[item.type]) continue;
      groups[item.type].push(item);
    }
    return groups;
  }

  function findById(candidates, id) {
    return (Array.isArray(candidates) ? candidates : []).find((item) => item && String(item.id) === String(id)) || null;
  }

  function sanitizeDecision(decision, candidates, scope) {
    const scoped = filterByScope(candidates, scope);
    const raw = decision && typeof decision === 'object' ? decision : {};
    let next = {
      decision: raw.decision === 'open' || raw.decision === 'choose' || raw.decision === 'none'
        ? raw.decision
        : 'none',
      type: raw.type || null,
      id: raw.id == null ? null : String(raw.id),
      title: raw.title || null,
      reason: raw.reason || '',
      candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    };

    if (next.decision === 'open') {
      const hit = findById(scoped, next.id);
      if (!hit) {
        next.decision = scoped.length ? 'choose' : 'none';
        next.candidates = scoped.slice(0, 8).map((item) => ({
          type: item.type,
          id: item.id,
          title: item.title,
        }));
      } else if (scope !== 'all' && hit.type !== scope) {
        next.decision = 'choose';
        next.candidates = scoped.slice(0, 8).map((item) => ({
          type: item.type,
          id: item.id,
          title: item.title,
        }));
      } else {
        next.type = hit.type;
        next.title = hit.title;
        next.id = String(hit.id);
      }
    }

    if (next.decision === 'choose') {
      const picked = (next.candidates || [])
        .map((item) => findById(scoped, item && item.id))
        .filter(Boolean);
      const list = picked.length ? picked : scoped.slice(0, 8);
      next.candidates = list.map((item) => ({
        type: item.type,
        id: item.id,
        title: item.title,
        subtitle: item.subtitle || '',
      }));
      if (!next.candidates.length) next.decision = 'none';
    }

    return next;
  }

  function parseModelJson(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('模型返回为空');
    const fenced = raw.match(/\{[\s\S]*\}/);
    const jsonText = fenced ? fenced[0] : raw;
    return JSON.parse(jsonText);
  }

  const CHAT_ACTIONS = [
    'none',
    'leave.open_fill',
    'form.open_fill',
    'open_workflow',
    'open_menu',
    'open_todo',
    'approve_todo',
    'filter_list',
    'click_ui',
    'close_dialog',
    'panel_minimize',
  ];

  const COMMON_PAGE_BUTTONS = [
    '查看草稿',
    '选择草稿',
    '保存草稿',
    '提交',
    '确定',
    '确认',
    '取消',
    '查询',
    '搜索',
    '重置',
    '新建',
    '关闭',
  ];

  function cleanOneAction(raw) {
    const actionRaw = raw && typeof raw === 'object' ? raw : {};
    let type = String(actionRaw.type || 'none');
    if (!CHAT_ACTIONS.includes(type)) type = 'none';
    return {
      type,
      query: String(actionRaw.query || '').trim(),
    };
  }

  function extractOpenTarget(text) {
    let raw = String(text || '').replace(/\s+/g, '');
    raw = raw.replace(/^(你好|您好)[，,！!]?/, '');
    raw = raw.replace(/^(我)?(想要|想|要)?/, '');
    raw = raw.replace(/^(请)?(帮我|帮忙)?/, '');
    raw = raw.replace(/^(打开|进入|发起|新建|去)/, '');
    return raw.trim();
  }

  /** 「请假流程」→「请假」；用于判断模型 query 是否跑偏 */
  function openTargetCore(text) {
    return extractOpenTarget(text)
      .replace(/(流程|申请)$/g, '')
      .replace(/^(流程|申请)/, '')
      .trim();
  }

  /**
   * 打开动作的 query 必须以用户原话目标为准。
   * 典型错误：用户说「打开请假流程」，模型却给 query=通用流程/新建流程。
   */
  function alignOpenQueries(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    const target = extractOpenTarget(text);
    const core = openTargetCore(text);
    if (!text || !core || core.length < 2) return actions;

    const saidMenu = /菜单|模块|页面|导航|流程定义/.test(text);
    const saidTodo = /待办/.test(text);

    return (Array.isArray(actions) ? actions : []).map((item) => {
      if (!item) return item;
      if (item.type !== 'open_workflow' && item.type !== 'open_menu') return item;

      // 「打开请假流程」不应被模型改成打开某个菜单入口
      if (
        item.type === 'open_menu'
        && !saidMenu
        && !saidTodo
        && /流程|申请/.test(text)
      ) {
        return { type: 'open_workflow', query: target || core };
      }

      if (item.type !== 'open_workflow') return item;

      const q = String(item.query || '').replace(/\s+/g, '');
      if (!q) return { ...item, query: target || core };

      const qCore = openTargetCore(q) || q.replace(/流程$/g, '');
      // query 已覆盖用户目标（请假 ⊆ 请假申请 / 请假流程 ⊆ 请假）
      if (
        q.includes(core)
        || core.includes(qCore)
        || (qCore && (qCore.includes(core) || core.includes(qCore)))
      ) {
        return item;
      }

      // 冲突：以用户原话为准（打开请假 → 不能执行成通用流程）
      return { ...item, query: target || core };
    });
  }

  /** 用户说「打开」时，禁止模型改成当前页搜索 */
  function enforceOpenVsSearch(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = Array.isArray(actions) ? actions.slice() : [];
    if (!text) return list;

    // 门户/工作台类页面走菜单，不是流程
    if (/打开首页|回到首页|去首页|进入首页|回首页|^首页$/.test(text)) {
      return [{ type: 'open_menu', query: '首页' }];
    }
    if (/打开主页|进入主页|去主页|^主页$/.test(text)) {
      return [{ type: 'open_menu', query: '主页' }];
    }
    if (/打开工作台|进入工作台|去工作台|^工作台$/.test(text)) {
      return [{ type: 'open_menu', query: '工作台' }];
    }

    const saidSearch = /搜索|筛选|过滤|查找/.test(text);
    const saidOpen = /打开|进入|发起|新建|帮我开|(?:^|[，,。；;])去/.test(text);
    const saidMenu = /菜单|模块|页面|导航|流程定义|首页|主页|工作台|门户|考勤|人事|财务|办公/.test(text);
    const saidTodo = /待办/.test(text);

    // 纯搜索：只留 filter_list
    if (saidSearch && !saidOpen) {
      const filters = list.filter((item) => item.type === 'filter_list');
      if (filters.length) return filters;
      const keyword = extractOpenTarget(text.replace(/^(搜索|筛选|过滤|查找)/, ''));
      return keyword ? [{ type: 'filter_list', query: keyword }] : list;
    }

    // 明确打开：不允许只剩 filter_list
    if (saidOpen) {
      const hasOpen = list.some((item) => (
        item.type === 'open_workflow'
        || item.type === 'open_menu'
        || item.type === 'open_todo'
        || item.type === 'leave.open_fill'
        || item.type === 'form.open_fill'
      ));
      if (!hasOpen) {
        const target = extractOpenTarget(text);
        if (saidTodo) {
          list = [{ type: 'open_todo', query: target || '我的待办' }];
        } else if (saidMenu) {
          // 「打开流程定义」等菜单名里虽有「流程」，仍走菜单
          list = [{ type: 'open_menu', query: target }];
        } else {
          list = [{ type: 'open_workflow', query: target || text }];
        }
      } else {
        // 打开意图下丢掉误加的纯筛选（除非同时还说了搜索）
        if (!saidSearch) {
          list = list.filter((item) => item.type !== 'filter_list');
        }
        list = alignOpenQueries(text, list);
      }
    }
    return list.length ? list : [{ type: 'none', query: '' }];
  }

  function extractClickTarget(text) {
    const raw = String(text || '').replace(/\s+/g, '');
    const patterns = [
      /帮我点(?:击|开|一下)?[「『"']?([^」』"']{1,20})/,
      /点击[「『"']?([^」』"']{1,20})/,
      /点一下[「『"']?([^」』"']{1,20})/,
      /点开[「『"']?([^」』"']{1,20})/,
    ];
    for (const pattern of patterns) {
      const hit = raw.match(pattern);
      if (hit && hit[1]) return hit[1].replace(/按钮|链接$/, '').trim();
    }
    return '';
  }

  function wantsPanelMinimize(text) {
    const raw = String(text || '').replace(/\s+/g, '');
    return /(最小化|收起|关掉|关闭)/.test(raw) && /(助手|面板|窗口|流程助手)/.test(raw);
  }

  /** 关掉流程申请弹窗（不是助手面板） */
  function wantsCloseDialog(text) {
    const raw = String(text || '').replace(/\s+/g, '');
    if (!raw || wantsPanelMinimize(raw)) return false;
    if (/关掉弹窗|关闭弹窗|关掉表单|关闭表单|关掉申请|关闭申请|关闭当前弹窗|关掉当前弹窗|关闭流程弹窗|关掉流程弹窗|关掉这个弹窗|关闭这个弹窗|不填了|取消申请/.test(raw)) {
      return true;
    }
    if (/^(关掉|关闭|取消)$/.test(raw)) return true;
    if (/^(帮我|请)?(关掉|关闭|取消)(当前)?(这个)?(流程|申请|弹窗|表单|窗口)?$/.test(raw)) return true;
    return false;
  }

  function isDialogCloseClick(query) {
    const q = String(query || '').replace(/\s+/g, '');
    return /^(取消|关闭)$/.test(q);
  }

  /** 把「点取消/关闭」和口语关窗统一成 close_dialog */
  function enforceCloseDialog(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = Array.isArray(actions) ? actions.slice() : [];
    list = list.map((item) => {
      if (item && item.type === 'click_ui' && isDialogCloseClick(item.query)) {
        return { type: 'close_dialog', query: '' };
      }
      return item;
    });

    if (!wantsCloseDialog(text)) return list;

    const alsoNavigate = /然后|再|之后|并|并且|接着|随后/.test(text)
      && /打开|进入|去|回到|返回/.test(text);
    const hasClose = list.some((item) => item && item.type === 'close_dialog');
    if (!alsoNavigate) {
      return [{ type: 'close_dialog', query: '' }];
    }
    if (!hasClose) {
      list = [{ type: 'close_dialog', query: '' }, ...list.filter((item) => item && item.type !== 'close_dialog')];
    }
    return list.length ? list : [{ type: 'close_dialog', query: '' }];
  }

  function isFormSubmitLabel(text) {
    const q = String(text || '').replace(/\s+/g, '');
    return /提交/.test(q) && !/不提交/.test(q);
  }

  function enforceClickIntent(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = Array.isArray(actions) ? actions.slice() : [];
    if (wantsPanelMinimize(text)) {
      return [{ type: 'panel_minimize', query: '' }];
    }
    // 表单「提交」只能手动点
    for (const btn of COMMON_PAGE_BUTTONS) {
      if (isFormSubmitLabel(btn)) continue;
      if (text.includes(btn) && /(帮我|请|点|一下|吧|保存)/.test(text)) {
        const has = list.some((item) => item.type === 'click_ui' && String(item.query || '').includes(btn));
        if (!has && (/(帮我点|点击|点开|点一下)/.test(text) || text === btn || text.endsWith(btn) || new RegExp(`(帮我|请)?${btn}`).test(text))) {
          if (/(帮我|请|点|保存)/.test(text)) {
            return [{ type: 'click_ui', query: btn }];
          }
        }
      }
    }
    if (isFormSubmitLabel(text) && !/查看草稿|保存草稿|选择草稿/.test(text)) return list;
    if (!/(帮我点|点击|点一下|点开|保存草稿)/.test(text)) return list;
    const hasClick = list.some((item) => item.type === 'click_ui' || item.type === 'panel_minimize');
    if (hasClick) return list;
    const target = extractClickTarget(text);
    if (target && !isFormSubmitLabel(target)) return [{ type: 'click_ui', query: target }];
    if (/保存草稿/.test(text)) return [{ type: 'click_ui', query: '保存草稿' }];
    return list;
  }

  /** 从 summary / reply 捞出模型已想好的点击，补进 actions（避免只说不做） */
  function hydrateClicksFromModel(reply, summary, actions) {
    let list = Array.isArray(actions) ? actions.slice() : [];
    const hasReal = list.some((item) => item.type && item.type !== 'none');
    if (hasReal) return list;

    const clicks = [];
    const push = (name) => {
      const q = String(name || '').replace(/\s+/g, '').trim();
      if (!q || q.length > 20 || isFormSubmitLabel(q)) return;
      if (clicks.includes(q)) return;
      clicks.push(q);
    };

    const fromSummary = summary && typeof summary === 'object'
      ? (summary.nextClicks || summary.clicks || summary.buttons)
      : null;
    if (Array.isArray(fromSummary)) {
      fromSummary.forEach((item) => push(item));
    }

    const text = String(reply || '');
    const quoted = text.matchAll(/(?:帮你|已经|已|先)?(?:点开|点击|点一下|点了|点)\s*[「『"']([^」』"']{1,20})[」』"']/g);
    for (const hit of quoted) {
      if (hit[1]) push(hit[1]);
    }
    // reply 里列举的常见按钮且带操作语气
    if (/(帮你点|已点|点开|点击|需要我帮你点)/.test(text)) {
      for (const btn of COMMON_PAGE_BUTTONS) {
        if (text.includes(btn)) push(btn);
      }
    }

    if (!clicks.length) return list;
    return clicks.map((query) => ({ type: 'click_ui', query }));
  }

  function modelPromisedFill(reply) {
    return /填写|填入|再填|写上|填上/.test(String(reply || ''));
  }

  /** 打开流程且模型已经分析出要填的内容时，打开后按分析回填 */
  function enforceModelFormFill(utterance, actions, summary, reply) {
    const judged = fillsFromSummary(summary);
    if (!Object.keys(judged).length && !modelPromisedFill(reply)) return actions;
    const blob = `${utterance || ''}\n${reply || ''}`;
    const fillType = /请假/.test(blob) ? 'leave.open_fill' : 'form.open_fill';
    const inferred = inferWorkflowQuery(blob);
    const list = Array.isArray(actions) ? actions.slice() : [];
    const hasFill = list.some((item) => item.type === 'form.open_fill' || item.type === 'leave.open_fill');
    if (!hasFill) {
      const current = list.find((item) => item.type === 'open_workflow');
      const q = String((current && current.query) || '').replace(/\s+/g, '');
      const generic = !q || /新建流程|新建|流程入口|通用流程/.test(q);
      return [{ type: fillType, query: generic ? (inferred || q || utterance) : q }];
    }
    return list.map((item) => {
      if (item.type === 'open_workflow' || item.type === 'form.open_fill' || item.type === 'leave.open_fill') {
        return { type: fillType, query: item.query || inferred || utterance };
      }
      return item;
    });
  }

  /** 待办里的同意/驳回走跨页面审批，不拆成普通点击。 */
  function enforceApproval(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (/怎么|如何|是什么/.test(text)) return actions;
    if (!/待办|待审|待我/.test(text)) return actions;
    if (!/同意|驳回|拒绝|不同意|通过/.test(text)) return actions;
    return [{ type: 'approve_todo', query: text }];
  }

  function readChatMode(raw) {
    const mode = String((raw && raw.mode) || '').trim().toLowerCase();
    if (mode === 'chat' || mode === 'talk') return 'chat';
    if (mode === 'task' || mode === 'execute') return 'task';
    return '';
  }

  /** 模型明确说这是聊天时，不再按关键字改成打开、填写或点击。 */
  function asChatOnly(reply, summary, utterance) {
    let text = String(reply || '').trim();
    if (isFormSubmitLabel(utterance)) {
      text = '流程提交需要你在表单里手动点击「提交」，我不会代为提交。';
    } else if (/已(帮你)?(点开|打开|点击|提交|写入|筛选|最小化)/.test(text)) {
      text = '这是在聊天，我没有操作页面。需要办理时直接说要做的事。';
    }
    return {
      mode: 'chat',
      reply: text || '好的。',
      action: { type: 'none', query: '' },
      actions: [{ type: 'none', query: '' }],
      summary,
    };
  }

  /** 校验动作类型；summary 由模型自设；打开/搜索冲突时按关键词纠正 */
  function sanitizeChatAction(raw, utterance) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const summary = data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)
      ? data.summary
      : null;
    let reply = String(data.reply || data.message || '').trim();
    if (readChatMode(data) === 'chat') {
      return asChatOnly(reply, summary, utterance || '');
    }
    let actions = [];
    if (Array.isArray(data.actions) && data.actions.length) {
      actions = data.actions.map(cleanOneAction);
    } else if (data.action && typeof data.action === 'object') {
      actions = [cleanOneAction(data.action)];
    } else {
      actions = [{ type: 'none', query: '' }];
    }

    actions = enforceOpenVsSearch(utterance || '', actions);
    actions = enforceClickIntent(utterance || '', actions);
    actions = hydrateClicksFromModel(reply, summary, actions);
    actions = enforceModelFormFill(utterance || '', actions, summary, reply);
    actions = enforceApproval(utterance || '', actions);
    actions = enforceCloseDialog(utterance || '', actions);
    const hadSubmit = actions.some((item) => item.type === 'click_ui' && isFormSubmitLabel(item.query));
    actions = actions.filter((item) => !(item.type === 'click_ui' && isFormSubmitLabel(item.query)));
    if (hadSubmit || (isFormSubmitLabel(utterance) && !actions.some((item) => item.type && item.type !== 'none'))) {
      reply = '流程提交需要你在表单里手动点击「提交」，我不会代为提交。';
    }
    if (!actions.length) actions = [{ type: 'none', query: '' }];
    const first = actions[0] || { type: 'none', query: '' };
    const actionable = actions.filter((item) => item.type && item.type !== 'none');
    // 纠正后若变成打开，避免还显示「帮你筛选」类回复
    if (first.type === 'open_workflow' && /筛|搜索|过滤/.test(reply) && /打开|发起|新建/.test(String(utterance || ''))) {
      const q = first.query || extractOpenTarget(utterance);
      reply = q ? `好的，正在打开「${q}」。` : '好的，正在打开流程。';
    }
    if (first.type === 'panel_minimize') {
      reply = '好的，已最小化流程助手。';
    }
    if (first.type === 'close_dialog') {
      reply = reply && !/提交/.test(reply)
        ? reply
        : '好的，我先关闭当前流程弹窗（不会提交）。';
    }
    // 没有可执行动作时，禁止假装「已点开/已打开/已最小化」
    if (!actionable.length && /已(帮你)?(点开|打开|点击|提交|写入|筛选|最小化)/.test(reply)) {
      reply = '我还没有真正操作页面。请直接说要点的按钮，例如「帮我点查看草稿」或「帮我点提交」。';
    }
    return {
      mode: actionable.length ? 'task' : 'chat',
      reply: reply || '好的。',
      action: first,
      actions,
      summary,
    };
  }

  const REFLECT_DECISIONS = ['retry', 'ask_user', 'stop'];
  const REFLECT_TOOLS = ['goto_workflow_list', 'open_workflow', 'ai_fill_form'];

  function sanitizeReflect(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    let decision = String(data.decision || 'stop');
    if (!REFLECT_DECISIONS.includes(decision)) decision = 'stop';
    let tool = data.tool == null || data.tool === '' ? null : String(data.tool);
    if (tool && !REFLECT_TOOLS.includes(tool)) tool = null;
    if (decision === 'retry' && !tool) {
      decision = 'ask_user';
    }
    const args = data.args && typeof data.args === 'object' ? data.args : {};
    const cleanArgs = {};
    if (args.query) cleanArgs.query = String(args.query).trim();
    if (args.utterance) cleanArgs.utterance = String(args.utterance).trim();
    if (args.preferLeave != null) cleanArgs.preferLeave = Boolean(args.preferLeave);
    return {
      decision,
      tool,
      args: cleanArgs,
      message: String(data.message || data.reason || '').trim(),
      reason: String(data.reason || '').trim(),
    };
  }

  function sanitizeFillMap(raw, fieldLabels) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const allowed = new Set(
      (Array.isArray(fieldLabels) ? fieldLabels : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    );
    const fills = {};
    const source = data.fills && typeof data.fills === 'object' ? data.fills : data;
    Object.keys(source).forEach((key) => {
      if (key === 'fills' || key === 'note') return;
      const label = String(key || '').trim();
      const value = source[key];
      if (value == null || String(value).trim() === '') return;
      if (allowed.size && !allowed.has(label)) {
        // 允许轻微差异：字段列表里有包含关系时仍接受
        const hit = [...allowed].find((item) => item === label || item.includes(label) || label.includes(item));
        if (!hit) return;
        fills[hit] = String(value).trim();
        return;
      }
      fills[label] = String(value).trim();
    });
    return {
      fills,
      note: String(data.note || '').trim(),
    };
  }
export {DEFAULT_KEYWORDS,
    CHAT_ACTIONS,
    REFLECT_DECISIONS,
    REFLECT_TOOLS,
    splitKeywords,
    mergeKeywords,
    detectScope,
    filterByScope,
    groupCandidates,
    findById,
    sanitizeDecision,
    sanitizeChatAction,
    enforceOpenVsSearch,
    sanitizeReflect,
    sanitizeFillMap,
    parseModelJson,};
