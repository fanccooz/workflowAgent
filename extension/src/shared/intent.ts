// @ts-nocheck

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

  const CHAT_ACTIONS = ['none', 'leave.open_fill', 'open_workflow', 'open_menu', 'open_todo', 'filter_list'];

  function cleanOneAction(raw) {
    const actionRaw = raw && typeof raw === 'object' ? raw : {};
    let type = String(actionRaw.type || 'none');
    if (!CHAT_ACTIONS.includes(type)) type = 'none';
    return {
      type,
      query: String(actionRaw.query || '').trim(),
    };
  }

  function saidTodo(text) {
    return /待办/.test(String(text || ''));
  }

  /** 明确要打开待办；问答「有多少条」不算打开 */
  function wantsOpenTodo(text) {
    const raw = String(text || '').replace(/\s+/g, '');
    if (!/待办/.test(raw)) return false;
    if (/[？?]|多少|几条|什么|吗|呢|是否|有没有|怎么|如何/.test(raw) && !/打开|进入/.test(raw)) {
      return false;
    }
    return /打开|进入|发起|新建|去我的待办|^我的待办$/.test(raw);
  }

  function saidOpenOrEnter(text) {
    // 打开/进入/发起/新建 = 跳页；「去某某」也算。单纯「搜索」不算打开。
    return /打开|进入|发起|新建|帮我开|(?:^|[，,。；;])去/.test(String(text || ''));
  }

  function saidSearchOnly(text) {
    const raw = String(text || '');
    return /筛选|过滤|搜索|查找/.test(raw) && !saidOpenOrEnter(raw) && !saidTodo(raw);
  }

  function extractSearchKeyword(text) {
    const raw = String(text || '').replace(/\s+/g, '');
    const patterns = [
      /备注(?:中|里)?(?:有|含|为|是|:|：)\s*([^，,。；;的数据]+)/,
      /筛选([^的数据页面列表]+)/,
      /过滤([^的数据页面列表]+)/,
      /搜索([^的数据页面列表]+)/,
      /按([^筛选过滤]+)筛选/,
      /查找([^的]+)/,
      /跟([^有关相关]+)/,
    ];
    for (const pattern of patterns) {
      const hit = raw.match(pattern);
      if (hit && hit[1]) {
        const keyword = hit[1]
          .replace(/^(页面|列表|数据|有关|相关|备注[为是:：]?|中有|里有)/, '')
          .replace(/的数据$/, '')
          .trim();
        if (keyword) return keyword;
      }
    }
    return '';
  }

  function stripUnauthorizedNavigation(text, actions) {
    let list = Array.isArray(actions) ? actions.slice() : [];
    if (!text) return list;
    // 纯搜索：只保留 filter_list，绝不跳页
    if (saidSearchOnly(text)) {
      return list.filter((item) => item.type === 'filter_list');
    }
    if (!wantsOpenTodo(text)) list = list.filter((item) => item.type !== 'open_todo');
    if (!saidOpenOrEnter(text)) {
      list = list.filter((item) => item.type !== 'open_menu' && item.type !== 'open_workflow');
    }
    return list;
  }

  /** 从用户原话补全「导航 + 筛选」等多步；搜索=当前页，打开=跳页 */
  function inferFilterFollowUp(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = stripUnauthorizedNavigation(text, actions);
    if (!/筛选|过滤|按.+查|查出|查找|搜索/.test(text)) return list;

    const keyword = extractSearchKeyword(text);
    if (!keyword && list.some((item) => item.type === 'filter_list')) return list;

    // 只搜索：强制当前页 filter_list
    if (saidSearchOnly(text)) {
      if (!keyword) return list.length ? list : [{ type: 'none', query: '' }];
      return [{ type: 'filter_list', query: keyword }];
    }

    if (list.some((item) => item.type === 'filter_list')) return list;
    if (!keyword) return list;

    const usable = list.filter((item) => item.type !== 'none');
    const hasNav = usable.some((item) => ['open_todo', 'open_menu', 'open_workflow'].includes(item.type));
    const wantsNav = wantsOpenTodo(text) || saidOpenOrEnter(text);
    if (!hasNav && wantsNav) {
      if (wantsOpenTodo(text)) usable.push({ type: 'open_todo', query: '我的待办' });
      else if (saidOpenOrEnter(text)) {
        const menuHit = text.match(/(?:打开|进入|去)([^，,。筛选过滤搜索查询页面列表]{2,16})(?:页面|列表|模块|菜单)?/);
        if (menuHit && menuHit[1] && !/待办/.test(menuHit[1])) {
          usable.push({ type: 'open_menu', query: menuHit[1] });
        }
      }
    }
    usable.push({ type: 'filter_list', query: keyword });
    return stripUnauthorizedNavigation(text, usable);
  }

  function sanitizeChatAction(raw, utterance) {
    const data = raw && typeof raw === 'object' ? raw : {};
    let actions = [];
    if (Array.isArray(data.actions) && data.actions.length) {
      actions = data.actions.map(cleanOneAction);
    } else if (data.action && typeof data.action === 'object') {
      actions = [cleanOneAction(data.action)];
    } else {
      actions = [{ type: 'none', query: '' }];
    }
    actions = inferFilterFollowUp(utterance || '', actions);
    if (!actions.length) actions = [{ type: 'none', query: '' }];
    const first = actions[0] || { type: 'none', query: '' };
    let reply = String(data.reply || data.message || '').trim();
    if (first.type === 'none' && !reply) {
      const ask = String(utterance || '');
      if (/[？?]|多少|几条|什么|吗|呢/.test(ask)) {
        reply = '我还没读到可用的页面数据，请再说一次，或先打开目标列表页。';
      } else if (saidSearchOnly(ask)) {
        reply = '好的，我在当前页面搜索。';
      } else {
        reply = '嗯，我在。你可以继续聊；要办事可以说「打开某某」，要搜可以说「搜索某某」。';
      }
    }
    if (first.type === 'filter_list' && !reply) {
      reply = `好的，在当前页搜索「${first.query || ''}」。`;
    }
    return {
      reply: reply || '好的。',
      action: first,
      actions,
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
    inferFilterFollowUp,
    sanitizeReflect,
    sanitizeFillMap,
    parseModelJson,
    wantsOpenTodo,
    saidOpenOrEnter,
    saidSearchOnly,};
