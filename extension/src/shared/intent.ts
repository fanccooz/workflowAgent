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

  const CHAT_ACTIONS = [
    'none',
    'leave.open_fill',
    'open_workflow',
    'open_menu',
    'open_todo',
    'filter_list',
    'click_ui',
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

  /** 用户说「打开」时，禁止模型改成当前页搜索 */
  function enforceOpenVsSearch(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = Array.isArray(actions) ? actions.slice() : [];
    if (!text) return list;

    const saidSearch = /搜索|筛选|过滤|查找/.test(text);
    const saidOpen = /打开|进入|发起|新建|帮我开|(?:^|[，,。；;])去/.test(text);
    const saidMenu = /菜单|模块|页面|导航|流程定义/.test(text);
    const saidTodo = /待办/.test(text);
    const saidWorkflow = /流程|申请|填表|填写/.test(text) || (!saidMenu && !saidTodo && saidOpen);

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

  function enforceClickIntent(utterance, actions) {
    const text = String(utterance || '').replace(/\s+/g, '');
    let list = Array.isArray(actions) ? actions.slice() : [];
    if (wantsPanelMinimize(text)) {
      return [{ type: 'panel_minimize', query: '' }];
    }
    // 「帮我提交 / 保存草稿 / 查看草稿」等直接点
    for (const btn of COMMON_PAGE_BUTTONS) {
      if (text.includes(btn) && /(帮我|请|点|一下|吧|提交吧|保存)/.test(text)) {
        const has = list.some((item) => item.type === 'click_ui' && String(item.query || '').includes(btn));
        if (!has && (/(帮我点|点击|点开|点一下)/.test(text) || text === btn || text.endsWith(btn) || new RegExp(`(帮我|请)?${btn}`).test(text))) {
          if (/(帮我|请|点|提交|保存)/.test(text)) {
            return [{ type: 'click_ui', query: btn }];
          }
        }
      }
    }
    if (!/(帮我点|点击|点一下|点开|帮我提交|提交吧|保存草稿)/.test(text)) return list;
    const hasClick = list.some((item) => item.type === 'click_ui' || item.type === 'panel_minimize');
    if (hasClick) return list;
    const target = extractClickTarget(text);
    if (target) return [{ type: 'click_ui', query: target }];
    if (/提交/.test(text)) return [{ type: 'click_ui', query: '提交' }];
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
      if (!q || q.length > 20) return;
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

  /** 校验动作类型；summary 由模型自设；打开/搜索冲突时按关键词纠正 */
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
    const summary = data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)
      ? data.summary
      : null;
    let reply = String(data.reply || data.message || '').trim();

    actions = enforceOpenVsSearch(utterance || '', actions);
    actions = enforceClickIntent(utterance || '', actions);
    actions = hydrateClicksFromModel(reply, summary, actions);
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
    // 没有可执行动作时，禁止假装「已点开/已打开/已最小化」
    if (!actionable.length && /已(帮你)?(点开|打开|点击|提交|写入|筛选|最小化)/.test(reply)) {
      reply = '我还没有真正操作页面。请直接说要点的按钮，例如「帮我点查看草稿」或「帮我点提交」。';
    }
    return {
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
