(function () {
  if (globalThis.__waromAgentLoaded) return;
  globalThis.__waromAgentLoaded = true;

  const LIST_HASH = '#/workflow/workflow-base/agent';

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitFor(predicate, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        let value = null;
        try {
          value = predicate();
        } catch (error) {
          value = null;
        }
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error('等待页面超时'));
        }
      }, 200);
    });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('.el-dialog')].filter((dialog) => {
      const wrap = dialog.closest('.el-dialog__wrapper');
      return wrap && getComputedStyle(wrap).display !== 'none';
    });
  }

  function tableLoadFailed() {
    const text = (document.body && document.body.innerText) || '';
    return text.includes('加载异常');
  }

  function headerFields() {
    const map = {};
    [...document.querySelectorAll('.ag-header-cell')].forEach((header) => {
      const text = (header.querySelector('.ag-header-cell-text') || header).textContent.trim();
      const colId = header.getAttribute('col-id') || '';
      if (text === '名称' || text === '代码' || text === '主视图') map[text] = colId;
    });
    return map;
  }

  function cellText(row, colId, fallbackIndex) {
    if (colId) {
      const cell = row.querySelector(`.ag-cell[col-id="${colId}"]`);
      if (cell) return cell.innerText.trim();
    }
    const cells = [...row.querySelectorAll('.ag-cell')];
    return cells[fallbackIndex] ? cells[fallbackIndex].innerText.trim() : '';
  }

  function readRowsFromTable() {
    const fields = headerFields();
    const centerRows = [...document.querySelectorAll('.ag-center-cols-container .ag-row')];
    const rightRows = [...document.querySelectorAll('.ag-pinned-right-cols-container .ag-row')];
    return centerRows.map((row, index) => {
      const operator = rightRows[index] ? rightRows[index].innerText : '';
      const disabled = /启用/.test(operator) && !/禁用/.test(operator);
      return {
        name: cellText(row, fields['名称'], 0),
        code: cellText(row, fields['代码'], 1),
        theme: cellText(row, fields['主视图'], 2),
        DisableStatus: disabled ? 1 : 0,
        rowIndex: row.getAttribute('row-index'),
      };
    }).filter((row) => row.name && row.code && row.name !== '加载异常');
  }

  function clickNewWorkflow(row) {
    const index = row.rowIndex;
    if (index == null) return false;
    const rightRow = document.querySelector(`.ag-pinned-right-cols-container .ag-row[row-index="${index}"]`);
    if (!rightRow) return false;
    const button = [...rightRow.querySelectorAll('button, a, span, div')]
      .find((el) => el.innerText && el.innerText.replace(/\s/g, '') === '新建流程');
    if (!button) return false;
    button.click();
    return true;
  }

  // 先把路由切离 code，再设回 code，否则第二次相同 code 不会触发打开。
  async function openByCodeHash(code) {
    location.hash = `${LIST_HASH}?_reopen=${Date.now()}`;
    await delay(120);
    location.hash = LIST_HASH;
    await delay(120);
    location.hash = WaromMatch.openHash(code);
  }

  function clickRefreshListButton() {
    const buttons = [...document.querySelectorAll('button, a, span, div')];
    const target = buttons.find((el) => {
      const text = (el.innerText || '').replace(/\s+/g, '');
      return text === '刷新列表' || text === '刷新';
    });
    if (!target) return false;
    target.click();
    return true;
  }

  async function loadRowsFromTable() {
    const baseHash = location.hash.split('?')[0];
    if (baseHash !== LIST_HASH) {
      location.hash = LIST_HASH;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await waitFor(() => readRowsFromTable().length || tableLoadFailed(), 8000);
      } catch (error) {
        // 继续尝试刷新
      }
      let rows = readRowsFromTable();
      if (rows.length) return rows;

      if (tableLoadFailed() || !rows.length) {
        const ok = clickRefreshListButton();
        if (!ok && attempt >= 1) {
          throw new Error('流程定义列表加载异常，且找不到「刷新列表」。请刷新网页后再试。');
        }
        await delay(600);
      }
    }
    if (tableLoadFailed() && !readRowsFromTable().length) {
      throw new Error('流程定义列表仍显示「加载异常」。请手动点「刷新列表」或刷新网页后再用助手。');
    }
    const rows = readRowsFromTable();
    if (!rows.length) {
      throw new Error('没有读到流程。请确认当前页是「流程定义」，并且列表已经出来。');
    }
    return rows;
  }

  function pageErrorText() {
    return [...document.querySelectorAll('.el-message')]
      .map((item) => item.innerText.trim())
      .find((text) => text.includes('未找到可发起的流程定义') || text.includes('打开流程失败')) || '';
  }

  async function closeWorkflowDialogs() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const dialog = visibleDialogs().find((item) => /基础信息|提交|取消/.test(item.innerText));
      if (!dialog) return;
      const cancel = [...dialog.querySelectorAll('button')].find((button) => button.innerText.replace(/\s/g, '') === '取消');
      const closeButton = dialog.querySelector('.el-dialog__headerbtn');
      const button = cancel || closeButton;
      if (!button) return;
      button.click();
      await delay(250);
      const box = document.querySelector('.el-message-box__wrapper');
      if (box && getComputedStyle(box).display !== 'none') {
        const confirm = [...box.querySelectorAll('button')].find((button) => /确定|确认/.test(button.innerText));
        if (confirm) confirm.click();
        await delay(250);
      }
    }
  }

  function currentCode() {
    const query = location.hash.split('?')[1] || '';
    return new URLSearchParams(query).get('code') || '';
  }

  // 去掉地址里的 ?code=，避免刷新后再次自动打开发起弹窗。
  function clearEmbedCodeFromHash() {
    const hash = location.hash || '';
    if (!hash.startsWith(LIST_HASH)) return false;
    if (!/[?&]code=/.test(hash)) return false;
    const cleanUrl = `${location.pathname}${location.search}${LIST_HASH}`;
    history.replaceState(history.state, document.title || '', cleanUrl);
    // 个别环境下 replaceState 未改掉 hash，再强制一次。
    if (/[?&]code=/.test(location.hash || '')) {
      location.hash = LIST_HASH;
    }
    return true;
  }

  function isWorkflowLaunchDialog(dialog) {
    const text = dialog.innerText || '';
    return /基础信息/.test(text) && (/提\s*交/.test(text) || /取\s*消/.test(text));
  }

  async function suppressAutoOpenFromUrl() {
    // early-clean 可能已清 URL；这里再补关弹窗，并短时重试。
    for (let attempt = 0; attempt < 25; attempt += 1) {
      clearEmbedCodeFromHash();
      const opened = visibleDialogs().some(isWorkflowLaunchDialog);
      if (opened || currentCode()) {
        await closeWorkflowDialogs();
        clearEmbedCodeFromHash();
        if (!visibleDialogs().some(isWorkflowLaunchDialog) && !currentCode()) return;
      } else if (attempt >= 8) {
        // 等了一会儿都没有自动弹窗，结束。
        return;
      }
      await delay(200);
    }
    clearEmbedCodeFromHash();
    await closeWorkflowDialogs();
  }

  function describe(result) {
    if (result.status === 'login') return '请先在这个页面登录华荣照明信息平台。';
    if (result.status === 'ask') return '请说明要打开哪条流程，例如：打开请假流程。';
    if (result.status === 'choose') {
      const lines = result.matches.map((row) => `${row.name}（${row.code}）`);
      return `匹配到多条，请说得更具体：\n${lines.join('\n')}`;
    }
    if (result.status === 'disabled') {
      const names = result.disabledMatches.map((row) => row.name).join('、');
      return `这些流程已禁用，不能发起：${names}`;
    }
    if (result.status === 'none') {
      return `当前列表里没有匹配的流程。现有名称：${result.names.join('、')}`;
    }
    if (result.status === 'open') return `已打开「${result.matches[0].name}」。`;
    return result.message || '没有完成打开。';
  }

  function collectMenus() {
    const seen = new Set();
    const items = [];
    const nodes = [
      ...document.querySelectorAll('.el-menu-item, .el-submenu__title, [role="menuitem"], .sidebar a, .el-tabs__item'),
    ];
    for (const node of nodes) {
      const title = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length > 40) continue;
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({
        type: 'menu',
        id: `menu:${title}`,
        title,
        subtitle: node.getAttribute('href') || '',
        openable: true,
      });
      if (items.length >= 80) break;
    }
    return items;
  }

  function collectTodos() {
    const items = [];
    const centerRows = [...document.querySelectorAll('.ag-center-cols-container .ag-row')];
    const onTodoPage = /待办/.test(document.title || '')
      || /todo|pending|my-task|myTask|agency/i.test(location.hash || '');
    if (!onTodoPage) {
      items.push({
        type: 'todo',
        id: 'todo:entry',
        title: '我的待办',
        subtitle: '进入待办列表',
        openable: true,
      });
      return items;
    }
    centerRows.slice(0, 40).forEach((row, index) => {
      const text = row.innerText.replace(/\s+/g, ' ').trim();
      if (!text) return;
      items.push({
        type: 'todo',
        id: `todo:${index}:${text.slice(0, 24)}`,
        title: text.slice(0, 40),
        subtitle: text.slice(40, 80),
        openable: true,
        rowIndex: row.getAttribute('row-index'),
      });
    });
    return items;
  }

  async function collectWorkflowCandidates() {
    const rows = await loadRowsFromTable();
    return rows
      .filter((row) => Number(row.DisableStatus) !== 1)
      .map((row) => ({
        type: 'workflow',
        id: `workflow:${row.code}`,
        title: row.name,
        subtitle: `${row.code}${row.theme ? ` · ${row.theme}` : ''}`,
        openable: true,
        code: row.code,
        name: row.name,
        theme: row.theme,
        rowIndex: row.rowIndex,
        DisableStatus: row.DisableStatus,
      }));
  }

  async function collectCandidates(scope) {
    const list = [];
    if (scope === 'workflow' || scope === 'all') {
      list.push(...await collectWorkflowCandidates());
    }
    if (scope === 'menu' || scope === 'all') {
      list.push(...collectMenus());
    }
    if (scope === 'todo' || scope === 'all') {
      list.push(...collectTodos());
    }
    return list;
  }

  async function openWorkflowRow(match) {
    const alreadyOpen = visibleDialogs().some((dialog) => dialog.innerText.includes(match.name)
      && isWorkflowLaunchDialog(dialog));
    if (alreadyOpen) {
      clearEmbedCodeFromHash();
      return { status: 'open', message: `「${match.name}」的发起弹窗已经打开。` };
    }

    await closeWorkflowDialogs();
    await delay(150);

    let openedByClick = clickNewWorkflow(match);
    if (!openedByClick) {
      await openByCodeHash(match.code);
    }

    try {
      await waitFor(() => pageErrorText()
        || visibleDialogs().some((dialog) => dialog.innerText.includes(match.name) && isWorkflowLaunchDialog(dialog)));
    } catch (error) {
      if (openedByClick) {
        await openByCodeHash(match.code);
        try {
          await waitFor(() => pageErrorText()
            || visibleDialogs().some((dialog) => dialog.innerText.includes(match.name) && isWorkflowLaunchDialog(dialog)));
        } catch (retryError) {
          clearEmbedCodeFromHash();
          return { status: 'error', message: '已尝试打开，但没有看到发起弹窗。' };
        }
      } else {
        clearEmbedCodeFromHash();
        return { status: 'error', message: '已尝试打开，但没有看到发起弹窗。' };
      }
    }

    const errorText = pageErrorText();
    clearEmbedCodeFromHash();
    if (errorText) {
      return {
        status: 'error',
        message: `${errorText}\n对应流程：${match.name}（代码 ${match.code}，主视图 ${match.theme || '无'}）`,
      };
    }
    return { status: 'open', message: `已打开「${match.name}」。` };
  }

  async function openWorkflowByUtterance(utterance) {
    if (location.hash.startsWith('#/login') || document.querySelector('input[placeholder="请输入密码"]')) {
      return { status: 'login', message: describe({ status: 'login' }) };
    }
    const rows = await loadRowsFromTable();
    const result = WaromMatch.matchWorkflows(utterance, rows);
    if (result.status !== 'open') {
      return { status: result.status, message: describe(result), names: result.names, matches: result.matches };
    }
    return openWorkflowRow(result.matches[0]);
  }

  function clickMenuByTitle(title) {
    const nodes = [
      ...document.querySelectorAll('.el-menu-item, .el-submenu__title, [role="menuitem"], .sidebar a, .el-tabs__item'),
    ];
    const target = nodes.find((node) => (node.innerText || '').replace(/\s+/g, ' ').trim() === title);
    if (!target) return false;
    target.click();
    return true;
  }

  async function openCandidate(item) {
    if (!item) return { status: 'error', message: '没有可打开的项。' };
    if (item.type === 'workflow') {
      return openWorkflowRow({
        name: item.name || item.title,
        code: item.code || String(item.id).replace(/^workflow:/, ''),
        theme: item.theme || '',
        rowIndex: item.rowIndex,
        DisableStatus: item.DisableStatus || 0,
      });
    }
    if (item.type === 'menu') {
      const ok = clickMenuByTitle(item.title);
      return ok
        ? { status: 'open', message: `已打开菜单「${item.title}」。` }
        : { status: 'error', message: `没有点到菜单「${item.title}」。` };
    }
    if (item.type === 'todo') {
      if (item.id === 'todo:entry') {
        const ok = clickMenuByTitle('我的待办') || clickMenuByTitle('待办');
        return ok
          ? { status: 'open', message: '已尝试进入「我的待办」。' }
          : { status: 'error', message: '没有找到「我的待办」菜单。' };
      }
      if (item.rowIndex != null) {
        const row = document.querySelector(`.ag-center-cols-container .ag-row[row-index="${item.rowIndex}"]`);
        if (row) {
          row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          return { status: 'open', message: `已打开待办「${item.title}」。` };
        }
      }
      return { status: 'error', message: `没有打开待办「${item.title}」。` };
    }
    return { status: 'error', message: '未知类型。' };
  }

  function formatChooseMessage(decision) {
    const groups = WaromIntent.groupCandidates(decision.candidates || []);
    const blocks = [];
    if (groups.workflow.length) {
      blocks.push(['【流程】', ...groups.workflow.map((item) => `- ${item.title}`)].join('\n'));
    }
    if (groups.menu.length) {
      blocks.push(['【菜单】', ...groups.menu.map((item) => `- ${item.title}`)].join('\n'));
    }
    if (groups.todo.length) {
      blocks.push(['【待办】', ...groups.todo.map((item) => `- ${item.title}`)].join('\n'));
    }
    if (!blocks.length) return '没有可选项。';
    return `请选择一项（流程 / 菜单 / 待办已分开）：\n${blocks.join('\n\n')}`;
  }

  async function askDeepSeek(utterance, scope, candidates) {
    const response = await chrome.runtime.sendMessage({
      type: 'warom-ai-decide',
      utterance,
      scope,
      candidates,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '模型调用失败');
    }
    const parsed = WaromIntent.parseModelJson(response.content);
    return WaromIntent.sanitizeDecision(parsed, candidates, scope);
  }

  function matchMenusLocally(utterance) {
    const menus = collectMenus();
    const text = String(utterance || '').replace(/\s+/g, '');
    const hits = menus.filter((item) => {
      const title = String(item.title || '').replace(/\s+/g, '');
      return title && (text.includes(title) || title.includes(text.replace(/菜单|进入|模块|页面|导航|打开/g, '')));
    });
    return hits;
  }

  let activeLeaveTask = null;

  async function aiOpenWorkflow(utterance) {
    let settings;
    try {
      const settingResponse = await chrome.runtime.sendMessage({ type: 'warom-get-settings' });
      settings = settingResponse && settingResponse.settings;
    } catch (error) {
      settings = null;
    }
    if (!(settings && settings.enabled && settings.hasKey)) {
      return null;
    }
    const candidates = await collectWorkflowCandidates();
    if (!candidates.length) return null;
    try {
      const decision = await askDeepSeek(utterance || '打开请假', 'workflow', candidates);
      if (decision.decision === 'open') {
        const hit = WaromIntent.findById(candidates, decision.id);
        if (!hit) return null;
        const opened = await openCandidate(hit);
        return { ...opened, matches: hit ? [hit] : [] };
      }
      if (decision.decision === 'choose') {
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: decision.candidates || [] }),
          choices: (decision.candidates || []).map((item) => WaromIntent.findById(candidates, item.id) || item),
        };
      }
      return {
        status: 'none',
        message: decision.reason || 'DeepSeek 没有选到合适的请假流程。',
        matches: [],
      };
    } catch (error) {
      return {
        status: 'none',
        message: `DeepSeek 未成功：${error.message || '调用失败'}`,
        matches: [],
      };
    }
  }

  async function aiPlanFill(utterance, fields) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const response = await chrome.runtime.sendMessage({
      type: 'warom-ai-fill-form',
      utterance,
      fields,
      today: `${yyyy}-${mm}-${dd}`,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '填表推理失败');
    }
    const parsed = WaromIntent.parseModelJson(response.content);
    const labels = (fields || []).map((item) => item.label);
    return WaromIntent.sanitizeFillMap(parsed, labels);
  }

  async function aiReflect(payload) {
    const response = await chrome.runtime.sendMessage({
      type: 'warom-ai-reflect',
      payload: payload || {},
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '反思失败');
    }
    const parsed = WaromIntent.parseModelJson(response.content);
    return WaromIntent.sanitizeReflect(parsed);
  }

  async function runLeaveAgent(utterance) {
    const task = WaromAgent.createTask(utterance, { goal: 'leave.open_fill' });
    const helpers = {
      openWorkflowByUtterance,
      aiOpenWorkflow,
      aiPlanFill,
      aiReflect,
      confirmToken: null,
    };
    const { task: finished, log } = await WaromTools.runAgentLoop(task, helpers);
    activeLeaveTask = finished.status === 'await_confirm' ? finished : null;
    const steps = log.map((item) => {
      if (item.type === 'tool') return `${item.ok ? '✓' : '✗'} ${item.name}${item.message ? `：${item.message}` : ''}`;
      if (item.type === 'reflect') return `💭 ${item.message || '反思'}`;
      return item.message || item.status;
    }).join('\n');
    return {
      status: finished.status,
      message: [finished.lastMessage || '', steps].filter(Boolean).join('\n\n'),
      choices: finished.choices || [],
      leaveTask: finished.status === 'await_confirm' ? finished : null,
      requiredReady: Boolean(finished.requiredReady),
      missing: finished.missing || [],
      missingTitles: finished.missingTitles || [],
      filled: finished.filled || {},
    };
  }

  async function confirmLeaveSubmit() {
    if (!activeLeaveTask || activeLeaveTask.status !== 'await_confirm') {
      return { status: 'error', message: '当前没有待确认的请假草稿。' };
    }
    const token = `confirm-${Date.now()}`;
    const accepted = WaromAgent.acceptConfirm(activeLeaveTask, token);
    if (!accepted.ok) return { status: 'error', message: accepted.message };
    // 提交前再读页面（用户可能已手补缺项）
    const check = WaromTools.checkRequired();
    if (check.filled) activeLeaveTask.filled = check.filled;
    if (!check.ready) {
      activeLeaveTask.status = 'await_confirm';
      activeLeaveTask.confirmToken = null;
      activeLeaveTask.awaitingSubmit = false;
      return {
        status: 'missing',
        message: `还有必填未填：${(check.missingTitles || check.missing).join('、')}。请在弹窗补全后再确认。`,
        missing: check.missing,
        missingTitles: check.missingTitles || [],
      };
    }
    const result = await WaromTools.submitWorkflow(token, token);
    activeLeaveTask = null;
    return {
      status: result.ok ? 'done' : 'error',
      message: result.message,
    };
  }

  async function loadAiSettings() {
    try {
      const settingResponse = await chrome.runtime.sendMessage({ type: 'warom-get-settings' });
      return settingResponse && settingResponse.settings;
    } catch (error) {
      return null;
    }
  }

  async function askDeepSeekChat(utterance, history) {
    const response = await chrome.runtime.sendMessage({
      type: 'warom-ai-chat',
      utterance,
      history: Array.isArray(history) ? history : [],
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '对话失败');
    }
    const parsed = WaromIntent.parseModelJson(response.content);
    return WaromIntent.sanitizeChatAction(parsed);
  }

  async function executeChatAction(action, utterance) {
    const type = action && action.type ? action.type : 'none';
    const query = (action && action.query) || utterance;

    if (type === 'none') {
      return { status: 'chat', message: '', choices: [] };
    }
    if (type === 'leave.open_fill') {
      return runLeaveAgent(utterance);
    }
    if (type === 'open_workflow') {
      let opened = await openWorkflowByUtterance(query);
      if (opened.status === 'none') {
        const aiOpened = await aiOpenWorkflow(utterance);
        if (aiOpened) opened = aiOpened;
      }
      return { ...opened, choices: opened.choices || opened.matches || [] };
    }
    if (type === 'open_menu') {
      const hits = matchMenusLocally(query);
      if (hits.length === 1) {
        const opened = await openCandidate(hits[0]);
        return { ...opened, choices: [] };
      }
      if (hits.length > 1) {
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: hits }),
          choices: hits,
        };
      }
      return { status: 'none', message: '没有匹配到菜单。', choices: [] };
    }
    if (type === 'open_todo') {
      const opened = await openCandidate({
        type: 'todo',
        id: 'todo:entry',
        title: '我的待办',
      });
      return { ...opened, choices: [] };
    }
    return { status: 'chat', message: '', choices: [] };
  }

  function formatChatResult(reply, exec) {
    const lines = [`助手：${reply || ''}`];
    if (exec && exec.status && exec.status !== 'chat' && exec.message) {
      lines.push('', `执行：${exec.message}`);
    }
    return lines.join('\n');
  }

  async function handleUtterance(utterance, options) {
    if (location.hash.startsWith('#/login') || document.querySelector('input[placeholder="请输入密码"]')) {
      return { status: 'login', message: describe({ status: 'login' }), choices: [] };
    }

    const settings = await loadAiSettings();
    const aiReady = Boolean(settings && settings.enabled && settings.hasKey);

    // 已配置 DeepSeek：先对话，再按模型给出的 action 做本地匹配/打开
    if (aiReady) {
      try {
        const chat = await askDeepSeekChat(utterance, options && options.history);
        const exec = await executeChatAction(chat.action, utterance);
        return {
          ...exec,
          status: exec.status === 'chat' ? 'chat' : exec.status,
          message: formatChatResult(chat.reply, exec),
          reply: chat.reply,
          action: chat.action,
          choices: exec.choices || [],
          requiredReady: exec.requiredReady,
          missing: exec.missing || [],
          missingTitles: exec.missingTitles || [],
          filled: exec.filled || {},
        };
      } catch (error) {
        // 对话失败则退回本地逻辑
        const fallbackNote = `（DeepSeek 对话失败：${error.message || '调用失败'}，已改用本地处理）`;
        if (typeof WaromLeaveSkill !== 'undefined' && WaromLeaveSkill.looksLikeLeaveTask(utterance)) {
          const local = await runLeaveAgent(utterance);
          return { ...local, message: `${local.message}\n${fallbackNote}` };
        }
      }
    }

    // 未配置 AI：请假填表走本地 Agent
    if (typeof WaromLeaveSkill !== 'undefined' && WaromLeaveSkill.looksLikeLeaveTask(utterance)) {
      return runLeaveAgent(utterance);
    }

    const scope = WaromIntent.detectScope(utterance, settings || {});

    // 明确打开流程：本地唯一命中则直接打开，不混菜单。
    if (scope === 'workflow') {
      const rows = await loadRowsFromTable();
      const local = WaromMatch.matchWorkflows(utterance, rows);
      if (local.status === 'open') {
        const opened = await openWorkflowRow(local.matches[0]);
        return { ...opened, choices: [] };
      }
      if (local.status === 'choose') {
        return {
          status: 'choose',
          message: `匹配到多条流程，请说得更具体：\n${local.matches.map((item) => `- ${item.name}（${item.code}）`).join('\n')}`,
          choices: local.matches.map((item) => ({
            type: 'workflow',
            id: `workflow:${item.code}`,
            title: item.name,
            subtitle: item.code,
            code: item.code,
            name: item.name,
            theme: item.theme,
            rowIndex: item.rowIndex,
          })),
        };
      }
      if (local.status === 'disabled') {
        return { status: 'disabled', message: describe(local), choices: [] };
      }
    }

    // 明确打开菜单：本地能唯一对上菜单名则直接点。
    if (scope === 'menu') {
      const hits = matchMenusLocally(utterance);
      if (hits.length === 1) {
        const opened = await openCandidate(hits[0]);
        return { ...opened, choices: [] };
      }
      if (hits.length > 1) {
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: hits }),
          choices: hits,
        };
      }
    }

    if (!aiReady) {
      if (scope === 'menu') {
        return {
          status: 'none',
          message: '没有匹配到菜单。可说「进入人事模块」，或在设置里增加菜单关键字，并配置 DeepSeek。',
          choices: [],
        };
      }
      const fallback = await openWorkflowByUtterance(utterance);
      return { ...fallback, choices: fallback.matches || [] };
    }

    const candidates = await collectCandidates(scope);
    if (!candidates.length) {
      return { status: 'none', message: '当前范围没有可搜索的内容。', choices: [] };
    }

    let decision;
    try {
      decision = await askDeepSeek(utterance, scope, candidates);
    } catch (error) {
      const fallback = await openWorkflowByUtterance(utterance);
      return {
        ...fallback,
        message: `${fallback.message}\n（DeepSeek 未成功：${error.message || '调用失败'}）`,
        choices: fallback.matches || [],
      };
    }

    if (decision.decision === 'open') {
      const hit = WaromIntent.findById(candidates, decision.id);
      const opened = await openCandidate(hit);
      return { ...opened, choices: [] };
    }
    if (decision.decision === 'choose') {
      const choices = (decision.candidates || []).map((item) => {
        const full = WaromIntent.findById(candidates, item.id) || item;
        return full;
      });
      return {
        status: 'choose',
        message: formatChooseMessage({ candidates: choices }),
        choices,
      };
    }
    return {
      status: 'none',
      message: decision.reason || '没有找到合适的流程、菜单或待办。',
      choices: [],
    };
  }

  function mountPanel() {
    if (document.querySelector('#warom-agent-host')) return;

    // 换 key，让旧的左侧位置失效，重新默认靠右。
    const POSITION_KEY = 'warom-agent-position-v2';
    const host = document.createElement('div');
    host.id = 'warom-agent-host';
    // 默认右侧中部；拖拽后改用 left/top。避开右下角提交按钮。
    host.style.cssText = 'all: initial; position: fixed; right: 20px; top: 35%; z-index: 2147483000;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
        .wrap { width: 340px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
        .panel {
          width: 100%;
          background: #fff;
          color: #1f2933;
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(15, 23, 42, 0.2);
          overflow: hidden;
        }
        .panel.hidden { display: none; }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 14px;
          background: #1f3f8f;
          color: #fff;
          cursor: move;
          user-select: none;
        }
        .head strong { font-size: 15px; pointer-events: none; }
        .head button {
          border: 0;
          background: transparent;
          color: #fff;
          font-size: 18px;
          cursor: pointer;
          line-height: 1;
        }
        .body { padding: 12px 14px 14px; }
        .hint { margin: 0 0 10px; color: #52606d; font-size: 13px; line-height: 1.5; }
        .log {
          min-height: 96px;
          max-height: 220px;
          overflow: auto;
          margin-bottom: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: #f5f7fb;
          color: #334e68;
          white-space: pre-wrap;
          font-size: 13px;
        }
        .choices {
          max-height: 180px;
          overflow: auto;
          margin-bottom: 10px;
        }
        .choice-group { margin-bottom: 8px; }
        .choice-group h4 {
          margin: 0 0 4px;
          font-size: 12px;
          color: #52606d;
        }
        .choice-item {
          display: block;
          width: 100%;
          text-align: left;
          margin: 0 0 4px;
          padding: 6px 8px;
          border: 1px solid #d9e2ec;
          border-radius: 8px;
          background: #fff;
          color: #243b53;
          font: 13px inherit;
          cursor: pointer;
        }
        .choice-item:hover { border-color: #2457d6; }
        textarea {
          width: 100%;
          min-height: 72px;
          padding: 8px 10px;
          border: 1px solid #cbd2d9;
          border-radius: 8px;
          resize: vertical;
          font: 14px/1.5 inherit;
        }
        .actions { display: flex; gap: 8px; margin-top: 10px; }
        .actions button {
          flex: 1;
          height: 36px;
          border: 0;
          border-radius: 8px;
          font: 14px inherit;
          cursor: pointer;
        }
        .actions .run { background: #2457d6; color: #fff; }
        .actions .settings { background: #e4e7eb; color: #243b53; }
        .actions .run:disabled { opacity: 0.6; cursor: default; }
        .fab {
          border: 0;
          border-radius: 999px;
          padding: 10px 16px;
          background: #2457d6;
          color: #fff;
          box-shadow: 0 8px 24px rgba(36, 87, 214, 0.28);
          cursor: grab;
          font: 14px inherit;
          user-select: none;
        }
        .fab:active { cursor: grabbing; }
      </style>
      <div class="wrap">
        <section class="panel" id="panel">
          <div class="head" id="drag-handle">
            <strong>流程助手 · 可拖动</strong>
            <button type="button" id="minimize" aria-label="收起">×</button>
          </div>
          <div class="body">
            <p class="hint">先与 DeepSeek 对话；需要办事时会自动匹配并打开。请先在设置里配置 Key。</p>
            <div class="log" id="log">准备好了。配置 DeepSeek 后即可对话，例如：帮我请假，明天到后天，事由开会</div>
            <div class="choices" id="choices"></div>
            <textarea id="input" placeholder="打开请假流程"></textarea>
            <div class="actions">
              <button type="button" class="settings" id="habit-suggest">习惯建议</button>
              <button type="button" class="settings" id="settings">设置</button>
              <button type="button" class="run" id="run">发送</button>
            </div>
            <div class="actions" id="confirm-row" style="display:none;margin-top:8px;">
              <button type="button" class="run" id="confirm-submit" disabled>确认提交</button>
            </div>
          </div>
        </section>
        <button type="button" class="fab" id="toggle">流程助手</button>
      </div>
    `;
    document.documentElement.appendChild(host);

    const panel = shadow.querySelector('#panel');
    const input = shadow.querySelector('#input');
    const log = shadow.querySelector('#log');
    const choicesNode = shadow.querySelector('#choices');
    const run = shadow.querySelector('#run');
    const settingsButton = shadow.querySelector('#settings');
    const toggle = shadow.querySelector('#toggle');
    const minimize = shadow.querySelector('#minimize');
    const dragHandle = shadow.querySelector('#drag-handle');
    const confirmRow = shadow.querySelector('#confirm-row');
    const confirmSubmit = shadow.querySelector('#confirm-submit');
    // 对话历史（只存纯文本，发给 DeepSeek）
    const chatHistory = [];
    let transcript = '准备好了。配置 DeepSeek 后即可对话。';

    function setConfirmUi(response) {
      const waiting = response && response.status === 'await_confirm';
      confirmRow.style.display = waiting ? 'flex' : 'none';
      if (!waiting) {
        confirmSubmit.disabled = true;
        return;
      }
      // 始终可点：点击时再读页面必填（用户可能已手补）
      confirmSubmit.disabled = false;
      const missing = response.missingTitles || response.missing || [];
      confirmSubmit.textContent = missing.length
        ? `确认提交（请先补：${missing.join('、')}）`
        : '确认提交';
    }

    function renderChoices(choices) {
      choicesNode.innerHTML = '';
      const groups = WaromIntent.groupCandidates(choices || []);
      const labels = { workflow: '流程', menu: '菜单', todo: '待办' };
      Object.keys(labels).forEach((type) => {
        const list = groups[type];
        if (!list.length) return;
        const group = document.createElement('div');
        group.className = 'choice-group';
        const title = document.createElement('h4');
        title.textContent = labels[type];
        group.appendChild(title);
        list.forEach((item) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'choice-item';
          button.textContent = item.subtitle ? `${item.title}（${item.subtitle}）` : item.title;
          button.addEventListener('click', async () => {
            run.disabled = true;
            log.textContent = '正在打开…';
            try {
              const response = await openCandidate(item);
              log.textContent = response.message;
              if (response.status === 'open') choicesNode.innerHTML = '';
            } catch (error) {
              log.textContent = error && error.message ? error.message : '执行失败。';
            } finally {
              run.disabled = false;
            }
          });
          group.appendChild(button);
        });
        choicesNode.appendChild(group);
      });
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function applyPosition(left, top) {
      const rect = host.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const nextLeft = clamp(left, 8, maxLeft);
      const nextTop = clamp(top, 8, maxTop);
      host.style.left = `${nextLeft}px`;
      host.style.top = `${nextTop}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      return { left: nextLeft, top: nextTop };
    }

    function restorePosition() {
      try {
        const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
        if (!saved || typeof saved.left !== 'number' || typeof saved.top !== 'number') return;
        applyPosition(saved.left, saved.top);
      } catch (error) {
        // 忽略坏掉的本地位置；没有记录时保持默认右侧
      }
    }

    function savePosition() {
      const rect = host.getBoundingClientRect();
      localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    }

    function enableDrag(element, options = {}) {
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;
      let moved = false;
      let dragging = false;

      element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (options.ignoreSelector && event.target.closest(options.ignoreSelector)) return;
        const rect = host.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        originLeft = rect.left;
        originTop = rect.top;
        moved = false;
        dragging = true;
        element.setPointerCapture(event.pointerId);
      });

      element.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        applyPosition(originLeft + dx, originTop + dy);
      });

      element.addEventListener('pointerup', (event) => {
        if (!dragging) return;
        dragging = false;
        try {
          element.releasePointerCapture(event.pointerId);
        } catch (error) {
          // 已经释放时忽略
        }
        if (moved) {
          savePosition();
          event.preventDefault();
          event.stopPropagation();
        }
        element._waromDragMoved = moved;
      });

      element.addEventListener('pointercancel', () => {
        dragging = false;
      });
    }

    async function maybeFillHabitSuggestion(options) {
      const opts = options || {};
      if (typeof WaromHabits === 'undefined') return;
      if (!opts.force && input.value.trim()) return;
      try {
        const result = await WaromHabits.fetchChatBoxSuggestion(Boolean(opts.refresh));
        if (result && result.suggestion) {
          if (opts.force || !input.value.trim()) {
            input.value = result.suggestion;
          }
          if (opts.announce) {
            log.textContent = `${log.textContent}\n\n（已填入习惯建议语${result.cached ? '·缓存' : ''}）`;
          }
          return;
        }
        if (opts.announce) {
          const reason = (result && (result.message || result.error))
            || (result && result.reason === 'no-user' ? '未识别工号，请到设置填写' : '暂无建议语（需后端 DeepSeek Key，且至少 3 条聊天）');
          log.textContent = `${log.textContent}\n\n（习惯建议未填入：${reason}）`;
        }
      } catch (error) {
        if (opts.announce) {
          log.textContent = `${log.textContent}\n\n（习惯建议失败：${error.message || '未知错误'}）`;
        }
      }
    }

    function setOpen(open) {
      const wasHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !open);
      if (open) {
        input.focus();
        // 从收起展开时拉取 DeepSeek 习惯建议语
        if (wasHidden) maybeFillHabitSuggestion({ announce: false });
      }
    }

    enableDrag(dragHandle, { ignoreSelector: '#minimize' });
    enableDrag(toggle);

    toggle.addEventListener('click', (event) => {
      if (toggle._waromDragMoved) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      setOpen(panel.classList.contains('hidden'));
    });
    minimize.addEventListener('click', () => setOpen(false));

    async function send() {
      const utterance = input.value.trim();
      if (!utterance) {
        log.textContent = '请先输入内容，例如：帮我请假，明天到后天。';
        return;
      }
      run.disabled = true;
      choicesNode.innerHTML = '';
      setConfirmUi(null);
      transcript = `${transcript}\n\n我：${utterance}\n助手：正在思考…`;
      log.textContent = transcript;
      log.scrollTop = log.scrollHeight;
      // 异步上报用户输入，供 Nest + DeepSeek 生成下次建议语
      if (typeof WaromHabits !== 'undefined') {
        WaromHabits.reportChat(utterance, 'user').catch(() => {});
      }
      try {
        const historyForApi = chatHistory.slice();
        const response = await handleUtterance(utterance, { history: historyForApi });
        const replyText = response.reply || response.message || '';
        chatHistory.push({ role: 'user', content: utterance });
        chatHistory.push({
          role: 'assistant',
          content: response.reply || String(response.message || '').slice(0, 500),
        });
        transcript = `${transcript.replace(/\n助手：正在思考…$/, '')}\n${response.message || replyText}`;
        log.textContent = transcript;
        log.scrollTop = log.scrollHeight;
        input.value = '';
        if (response.status === 'choose') renderChoices(response.choices || []);
        setConfirmUi(response);
        // 发送清空后尝试预填下一句习惯建议
        maybeFillHabitSuggestion({ refresh: true, announce: false });
      } catch (error) {
        transcript = `${transcript.replace(/\n助手：正在思考…$/, '')}\n助手：${error && error.message ? error.message : '执行失败。'}`;
        log.textContent = transcript;
        setConfirmUi(null);
      } finally {
        run.disabled = false;
      }
    }

    const habitSuggestButton = shadow.querySelector('#habit-suggest');
    if (habitSuggestButton) {
      habitSuggestButton.addEventListener('click', async () => {
        habitSuggestButton.disabled = true;
        log.textContent = `${log.textContent}\n\n正在向后端索取习惯建议语…`;
        try {
          await maybeFillHabitSuggestion({ force: true, refresh: true, announce: true });
        } finally {
          habitSuggestButton.disabled = false;
        }
      });
    }

    confirmSubmit.addEventListener('click', async () => {
      confirmSubmit.disabled = true;
      log.textContent = '正在提交…';
      try {
        const response = await confirmLeaveSubmit();
        log.textContent = response.message;
        if (response.status === 'done') setConfirmUi(null);
        else if (response.status === 'missing') {
          setConfirmUi({
            status: 'await_confirm',
            requiredReady: false,
            missing: response.missing || [],
            missingTitles: response.missingTitles || [],
          });
        } else {
          setConfirmUi(null);
        }
      } catch (error) {
        log.textContent = error && error.message ? error.message : '提交失败。';
        setConfirmUi(null);
      }
    });

    settingsButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'warom-open-options' }, (response) => {
        if (chrome.runtime.lastError || (response && response.ok === false)) {
          log.textContent = '打不开设置页。请到 chrome://extensions → 华荣流程助手 → 详细信息 → 扩展程序选项。';
        }
      });
    });
    run.addEventListener('click', send);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    restorePosition();
    // 默认只显示按钮，点击后再展开聊天窗口。
    setOpen(false);
    // 刷新后若地址还带上次的 code，关掉自动弹出的流程并清掉参数。
    suppressAutoOpenFromUrl().catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'warom-run') return false;
    handleUtterance(message.utterance || '')
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({
        status: 'error',
        message: error && error.message ? error.message : '执行失败。',
      }));
    return true;
  });

  mountPanel();
})();
