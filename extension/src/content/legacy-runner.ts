// @ts-nocheck
import * as Match from '@/shared/match';
import * as Intent from '@/shared/intent';
import * as Leave from '@/shared/leave';
import * as Agent from '@/shared/agent';
import * as Tools from '@/shared/tools';
import * as Habits from '@/shared/habits';
import { MSG } from '@/shared/types';

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
    location.hash = Match.openHash(code);
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
    const result = Match.matchWorkflows(utterance, rows);
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
    const groups = Intent.groupCandidates(decision.candidates || []);
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
      type: MSG.aiDecide,
      utterance,
      scope,
      candidates,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '模型调用失败');
    }
    const parsed = Intent.parseModelJson(response.content);
    return Intent.sanitizeDecision(parsed, candidates, scope);
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
      const settingResponse = await chrome.runtime.sendMessage({ type: MSG.getSettings });
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
        const hit = Intent.findById(candidates, decision.id);
        if (!hit) return null;
        const opened = await openCandidate(hit);
        return { ...opened, matches: hit ? [hit] : [] };
      }
      if (decision.decision === 'choose') {
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: decision.candidates || [] }),
          choices: (decision.candidates || []).map((item) => Intent.findById(candidates, item.id) || item),
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
      type: MSG.aiFillForm,
      utterance,
      fields,
      today: `${yyyy}-${mm}-${dd}`,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '填表推理失败');
    }
    const parsed = Intent.parseModelJson(response.content);
    const labels = (fields || []).map((item) => item.label);
    return Intent.sanitizeFillMap(parsed, labels);
  }

  async function aiReflect(payload) {
    const response = await chrome.runtime.sendMessage({
      type: MSG.aiReflect,
      payload: payload || {},
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '反思失败');
    }
    const parsed = Intent.parseModelJson(response.content);
    return Intent.sanitizeReflect(parsed);
  }

  async function runLeaveAgent(utterance) {
    const task = Agent.createTask(utterance, { goal: 'leave.open_fill' });
    const helpers = {
      openWorkflowByUtterance,
      aiOpenWorkflow,
      aiPlanFill,
      aiReflect,
      confirmToken: null,
    };
    const { task: finished, log } = await Tools.runAgentLoop(task, helpers);
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
    const accepted = Agent.acceptConfirm(activeLeaveTask, token);
    if (!accepted.ok) return { status: 'error', message: accepted.message };
    // 提交前再读页面（用户可能已手补缺项）
    const check = Tools.checkRequired();
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
    const result = await Tools.submitWorkflow(token, token);
    activeLeaveTask = null;
    return {
      status: result.ok ? 'done' : 'error',
      message: result.message,
    };
  }

  async function loadAiSettings() {
    try {
      const settingResponse = await chrome.runtime.sendMessage({ type: MSG.getSettings });
      return settingResponse && settingResponse.settings;
    } catch (error) {
      return null;
    }
  }

  async function askDeepSeekChat(utterance, history, pageSummary) {
    const response = await chrome.runtime.sendMessage({
      type: MSG.aiChat,
      utterance,
      history: Array.isArray(history) ? history : [],
      pageSummary: pageSummary || null,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || '对话失败');
    }
    const raw = String(response.content || '').trim();
    try {
      const parsed = Intent.parseModelJson(raw);
      return Intent.sanitizeChatAction(parsed, utterance);
    } catch (error) {
      // 模型偶尔不按 JSON 回：仍当作普通闲聊回复，避免整段对话挂掉
      const plain = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return Intent.sanitizeChatAction(
        {
          reply: plain || '我在，你可以继续说。',
          actions: [{ type: 'none', query: '' }],
        },
        utterance,
      );
    }
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const text = String(value);
    try {
      el.focus();
    } catch (error) {
      // 忽略
    }
    const wasReadonly = el.readOnly;
    if (wasReadonly) el.readOnly = false;
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, text);
    else el.value = text;
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      }));
    } catch (error) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    if (wasReadonly) el.readOnly = true;
    return true;
  }

  function normalizeFilterLabel(text) {
    return String(text || '').replace(/\s+/g, '').replace(/[:：*＊]/g, '');
  }

  function isInSidebar(el) {
    return Boolean(el && el.closest('.el-aside, .sidebar, .el-menu, .layout-sider, .left-menu, #warom-agent-host, #wf-agent-host'));
  }

  function isVisibleEl(el) {
    if (!el || el.disabled) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function findVueInstance(el) {
    let node = el;
    for (let i = 0; i < 12 && node; i += 1) {
      if (node.__vue__) return node.__vue__;
      node = node.parentElement;
    }
    return null;
  }

  function readInputValue(el) {
    if (!el) return '';
    const wrap = el.closest('.el-select, .el-input, .el-textarea') || el;
    const shown = wrap.querySelector('.el-input__inner, input, textarea') || el;
    return String(shown.value || shown.getAttribute('value') || wrap.innerText || '').trim();
  }

  function valueLooksSet(actual, expected) {
    if (!actual || !expected) return false;
    const a = String(actual).replace(/\s+/g, '');
    const b = String(expected).replace(/\s+/g, '');
    return a === b || a.includes(b) || b.includes(a);
  }

  async function writeFilterInput(input, key) {
    setNativeValue(input, key);
    await delay(80);
    if (valueLooksSet(readInputValue(input), key)) return true;
    const vue = findVueInstance(input);
    if (vue) {
      try {
        if (typeof vue.handleInput === 'function') vue.handleInput(key);
        else if (typeof vue.$emit === 'function') {
          vue.$emit('input', key);
          vue.$emit('change', key);
        }
        if (vue.value !== undefined) vue.value = key;
      } catch (error) {
        // 忽略组件差异
      }
      await delay(80);
    }
    return valueLooksSet(readInputValue(input), key);
  }

  async function clickQueryNear(el) {
    const root = (el && (el.closest('.el-form, .search-bar, .query-form, .toolbar, .ag-header') || el.parentElement)) || document;
    const buttons = [...root.querySelectorAll('button, a.el-button, .el-button, [role="button"]')];
    const globalButtons = [...document.querySelectorAll('button.el-button, .el-form button, .toolbar button')];
    const pool = buttons.concat(globalButtons);
    const searchBtn = pool.find((btn) => {
      if (!isVisibleEl(btn) || isInSidebar(btn)) return false;
      const text = (btn.innerText || btn.getAttribute('aria-label') || '').replace(/\s+/g, '');
      return text === '查询' || text === '搜索' || text === '筛选' || text === '检索' || text === 'Search';
    });
    if (searchBtn) {
      searchBtn.click();
      await delay(600);
      return true;
    }
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await delay(400);
      return true;
    }
    return false;
  }

  const GENERIC_FILTER_LABELS = [
    '流程名称', '流程定义名称', '流程定义', '流程类型', '流程分类',
    '名称', '标题', '主题', '单据标题', '单号', '编号', '编码', '代码',
    '关键字', '关键词', '申请人', '发起人', '创建人', '部门', '类型', '状态', '分类',
  ];

  function fieldContextText(el) {
    const item = el.closest('.el-form-item, .el-col, .ag-header-cell, .filter-item, .search-item');
    const labelEl = item
      ? item.querySelector('.el-form-item__label, label, .ag-header-cell-text')
      : null;
    const label = normalizeFilterLabel(labelEl ? labelEl.textContent : '');
    const tip = `${el.placeholder || ''}${el.getAttribute('aria-label') || ''}${el.title || ''}`;
    return { item, label, tip: tip.replace(/\s+/g, ''), text: `${label}${tip.replace(/\s+/g, '')}` };
  }

  function scoreFilterControl(el, key, utterance) {
    const { label, tip, text } = fieldContextText(el);
    const utter = String(utterance || '').replace(/\s+/g, '');
    let score = 0;
    if (!text) score += 0;
    if (label && (label === key || label.includes(key) || key.includes(label))) score += 12;
    if (tip && (tip.includes(key) || key.includes(tip))) score += 8;
    for (const prefer of GENERIC_FILTER_LABELS) {
      if (label === prefer) score += 6;
      else if (label.includes(prefer) || prefer.includes(label)) score += 3;
      if (tip.includes(prefer)) score += 2;
    }
    if (/搜索|查询|筛选|请输入/.test(tip)) score += 2;
    // 用户原话里提到的字段名加分，例如「按标题搜索」
    if (label && utter.includes(label)) score += 10;
    if (el.closest('.ag-floating-filter, .ag-header-cell')) score += 1;
    return score;
  }

  function listMainFilterInputs() {
    return [...document.querySelectorAll('input.el-input__inner, input:not([type="hidden"]), textarea')]
      .filter((el) => (
        isVisibleEl(el)
        && !isInSidebar(el)
        && !el.readOnly
        && !el.closest('.el-select, .el-pagination, .el-date-editor, .el-dialog')
      ));
  }

  function listMainSelects() {
    return [...document.querySelectorAll('.el-select')]
      .filter((el) => isVisibleEl(el) && !isInSidebar(el) && !el.closest('.el-dialog, .el-pagination'));
  }

  /** 通用：任意列表页下拉中选包含关键字的选项 */
  async function applySelectFilter(keyword, utterance) {
    const key = String(keyword || '').trim();
    const selects = listMainSelects();
    if (!selects.length) return null;

    // 按字段相关性排序，再尝试能否选中关键字选项
    const ranked = selects
      .map((sel) => {
        const input = sel.querySelector('input') || sel;
        return { sel, score: scoreFilterControl(input, key, utterance) };
      })
      .sort((a, b) => b.score - a.score);

    for (const { sel } of ranked) {
      const trigger = sel.querySelector('.el-input__inner, input, .el-select__wrapper') || sel;
      trigger.click();
      await delay(300);
      const dropdowns = [...document.querySelectorAll('.el-select-dropdown, .el-popper')]
        .filter((panel) => isVisibleEl(panel));
      const dropdown = dropdowns[dropdowns.length - 1];
      if (!dropdown) {
        document.body.click();
        await delay(120);
        continue;
      }
      const options = [...dropdown.querySelectorAll('.el-select-dropdown__item, li, .el-option')];
      const hit = options.find((opt) => {
        const text = (opt.innerText || '').replace(/\s+/g, '');
        return text && (text === key || text.includes(key) || key.includes(text));
      });
      if (!hit) {
        document.body.click();
        await delay(120);
        continue;
      }
      hit.click();
      await delay(280);
      await clickQueryNear(sel);
      const shown = readInputValue(sel.querySelector('input') || sel);
      if (valueLooksSet(shown, key) || (hit.innerText || '').includes(key)) {
        return { ok: true, message: `已在下拉中选择「${key}」并查询。` };
      }
      return { ok: false, message: `点了下拉选项「${key}」，但页面未显示选中结果。` };
    }
    return null;
  }

  /** 通用：在当前页主内容区按相关度挑筛选输入框 */
  function findBestFilterInput(key, utterance) {
    const inputs = listMainFilterInputs();
    // AG Grid 浮动筛选也算
    const floating = [...document.querySelectorAll('.ag-header-cell input, .ag-floating-filter input')]
      .filter((el) => isVisibleEl(el) && !isInSidebar(el));
    const pool = inputs.concat(floating.filter((el) => !inputs.includes(el)));
    if (!pool.length) return null;

    let best = null;
    let bestScore = -1;
    for (const el of pool) {
      const score = scoreFilterControl(el, key, utterance);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (best && bestScore >= 2) return best;
    // 只有一个可见搜索类输入时使用
    const searchLike = pool.filter((el) => {
      const { tip, label } = fieldContextText(el);
      return /搜索|查询|筛选|请输入|名称|标题|主题|关键字/.test(`${label}${tip}`);
    });
    if (searchLike.length === 1) return searchLike[0];
    if (pool.length === 1) return pool[0];
    return bestScore > 0 ? best : null;
  }

  async function waitForListPageReady(timeout = 8000) {
    try {
      await waitFor(() => {
        if (document.querySelector('.el-form-item input, .el-select, .ag-floating-filter input, .ag-root, .el-table, .el-form .el-button')) {
          return true;
        }
        // 任意业务页：出现查询按钮也算就绪
        const buttons = [...document.querySelectorAll('button, .el-button')];
        return buttons.some((btn) => {
          if (!isVisibleEl(btn) || isInSidebar(btn)) return false;
          const text = (btn.innerText || '').replace(/\s+/g, '');
          return text === '查询' || text === '搜索' || text === '重置';
        });
      }, timeout);
    } catch (error) {
      // 超时也继续试
    }
    await delay(400);
  }

  /** 通用列表筛选：不绑定待办，适用于任意已打开的列表/查询页 */
  async function applyListFilter(keyword, utterance) {
    const key = String(keyword || '').trim();
    if (!key) return { status: 'error', message: '没有筛选关键字。', choices: [] };

    await waitForListPageReady();

    const selectResult = await applySelectFilter(key, utterance);
    if (selectResult) {
      return selectResult.ok
        ? { status: 'open', message: selectResult.message, choices: [] }
        : { status: 'error', message: selectResult.message, choices: [] };
    }

    const input = findBestFilterInput(key, utterance || '');
    if (!input) {
      return {
        status: 'error',
        message: `当前页面没有找到可用的筛选/搜索框，无法自动筛「${key}」。请确认已打开目标列表页后重试，或手动筛选。`,
        choices: [],
      };
    }

    const written = await writeFilterInput(input, key);
    if (!written) {
      return {
        status: 'error',
        message: `找到了筛选框，但未能写入「${key}」（可能是只读或组件未接受）。请手动填写。`,
        choices: [],
      };
    }

    await clickQueryNear(input);
    await delay(300);
    if (!valueLooksSet(readInputValue(input), key)) {
      return {
        status: 'error',
        message: `已尝试查询，但筛选框里没有保留「${key}」，页面可能未生效。`,
        choices: [],
      };
    }
    const { label } = fieldContextText(input);
    const where = label ? `「${label}」` : '筛选框';
    return { status: 'open', message: `已在${where}写入「${key}」并触发查询。`, choices: [] };
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
        if (opened && opened.status === 'open') await waitForListPageReady(10000);
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
      if (opened && opened.status === 'open') {
        // 等列表页就绪，再给下一步通用筛选
        await waitForListPageReady(10000);
      }
      return { ...opened, choices: [] };
    }
    if (type === 'filter_list') {
      return applyListFilter(query, utterance);
    }
    return { status: 'chat', message: '', choices: [] };
  }

  function collectPageSummary() {
    const labels = [...document.querySelectorAll('.el-form-item__label, label')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 12);
    const crumbs = [...document.querySelectorAll('.el-breadcrumb__inner, .breadcrumb, .ant-breadcrumb')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8);
    const activeMenu = [...document.querySelectorAll('.el-menu-item.is-active, .router-link-active')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 4);
    const searchInputs = [...document.querySelectorAll('input[type="text"], .el-input__inner')]
      .map((el) => String(el.value || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    return {
      title: document.title || '',
      hash: location.hash || '',
      path: location.pathname || '',
      hasDialog: visibleDialogs().length > 0,
      formLabels: labels,
      breadcrumbs: crumbs,
      activeMenu,
      filledInputs: searchInputs,
    };
  }

  function stepLooksFailed(result) {
    if (!result) return true;
    return result.status === 'error' || result.status === 'none' || result.status === 'disabled';
  }

  async function executeChatActions(actions, utterance, options) {
    const opts = options || {};
    const runId = opts.runId;
    const history = Array.isArray(opts.history) ? opts.history : [];
    const list = Array.isArray(actions) && actions.length
      ? actions
      : [{ type: 'none', query: '' }];
    const stepMessages = [];
    let last = { status: 'chat', message: '', choices: [] };

    if (runId && Habits) {
      Habits.startTaskRun(runId).catch(() => {});
    }

    for (let i = 0; i < list.length; i += 1) {
      let action = list[i];
      if (!action || action.type === 'none') continue;
      const seq = action.seq != null ? Number(action.seq) : i + 1;

      if (runId && Habits) {
        Habits.reportStep(runId, seq, 'running', '', false).catch(() => {});
      }

      last = await executeChatAction(action, utterance);

      // 失败时再问 DeepSeek 如何补救，最多重试一次
      if (stepLooksFailed(last) && runId && Habits && last.status !== 'choose' && last.status !== 'login') {
        const advice = await Habits.actOnFailedStep(
          runId,
          seq,
          last.message || last.status,
          collectPageSummary(),
          history,
        );
        if (advice && advice.decision === 'retry') {
          const retryAction = {
            type: advice.type || action.type,
            query: advice.query != null && advice.query !== '' ? advice.query : action.query,
          };
          last = await executeChatAction(retryAction, utterance);
          if (last.message && advice.message) {
            last = { ...last, message: `${last.message}（补救：${advice.message}）` };
          }
        } else if (advice && advice.decision === 'skip') {
          last = {
            status: 'open',
            message: advice.message || `已跳过步骤 ${seq}`,
            choices: [],
          };
        } else if (advice && (advice.decision === 'ask_user' || advice.decision === 'stop')) {
          last = {
            status: advice.decision === 'stop' ? 'error' : 'error',
            message: advice.message || last.message,
            choices: last.choices || [],
          };
        }
      }

      if (last && last.message) stepMessages.push(last.message);

      const stepStatus = last.status === 'choose' || last.status === 'login'
        ? 'failed'
        : stepLooksFailed(last)
          ? 'failed'
          : 'done';
      const isLast = i >= list.length - 1
        || last.status === 'choose'
        || last.status === 'login'
        || stepStatus === 'failed';
      if (runId && Habits) {
        Habits.reportStep(runId, seq, stepStatus, last.message || '', isLast).catch(() => {});
      }

      if (last.status === 'choose' || last.status === 'login' || stepStatus === 'failed') break;
      if (i < list.length - 1 && ['open_todo', 'open_menu', 'open_workflow'].includes(action.type)) {
        await delay(2000);
      }
    }

    if (!stepMessages.length && last.status === 'chat') {
      return last;
    }
    return {
      ...last,
      message: stepMessages.join('\n'),
      stepMessages,
      choices: last.choices || [],
      runId: runId || null,
    };
  }

  function formatChatResult(reply, exec) {
    const lines = [`助手：${reply || ''}`];
    if (exec && exec.runId) {
      lines.push(`任务 #${exec.runId}`);
    }
    const steps = exec && Array.isArray(exec.stepMessages) && exec.stepMessages.length
      ? exec.stepMessages
      : (exec && exec.message ? [exec.message] : []);
    if (steps.length) {
      lines.push('', '执行：');
      steps.forEach((item, index) => {
        lines.push(`${index + 1}. ${item}`);
      });
    }
    return lines.join('\n');
  }

  function saidOpenOrEnter(text) {
    return /打开|进入|发起|新建|帮我开|(?:^|[，,。；;])去/.test(String(text || ''));
  }

  function filterActionableSteps(utterance, actions) {
    const saidTodo = /待办/.test(String(utterance || ''));
    const canJump = saidOpenOrEnter(utterance);
    return (actions || []).filter((item) => {
      if (!item || !item.type || item.type === 'none') return false;
      if (item.type === 'open_todo' && !saidTodo) return false;
      if ((item.type === 'open_menu' || item.type === 'open_workflow') && !canJump) return false;
      return true;
    });
  }

  /** AI 没给出动作时，按原话做本地打开（流程/菜单/待办/请假） */
  async function tryLocalOpenFromUtterance(utterance, settings) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (!text) return null;
    if (!saidOpenOrEnter(text) && !/待办/.test(text)) return null;

    if (Leave.looksLikeLeaveTask(utterance)) {
      return runLeaveAgent(utterance);
    }
    if (/待办/.test(text)) {
      return executeChatAction({ type: 'open_todo', query: '我的待办' }, utterance);
    }

    const scope = Intent.detectScope(utterance, settings || {});
    if (scope === 'menu' || /菜单|模块|页面|导航|流程定义/.test(text)) {
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

    if (scope === 'workflow' || /流程|打开|发起|新建|填写/.test(text)) {
      const opened = await openWorkflowByUtterance(utterance);
      if (opened && opened.status !== 'none') {
        return { ...opened, choices: opened.choices || opened.matches || [] };
      }
      // 流程表可能还没加载：再试菜单
      const menuHits = matchMenusLocally(utterance);
      if (menuHits.length === 1) {
        const openedMenu = await openCandidate(menuHits[0]);
        return { ...openedMenu, choices: [] };
      }
      if (menuHits.length > 1) {
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: menuHits }),
          choices: menuHits,
        };
      }
      return { ...opened, choices: opened.matches || [] };
    }
    return null;
  }

  /**
   * 对话框主路径：始终先走扩展 DeepSeek 多轮对话（带 history），保证有上下文。
   * Nest 仅在需要真正执行步骤时用来落库拿 runId，不再抢对话主导权。
   */
  async function planAndRunUtterance(utterance, options) {
    let reply = '';
    let actions = [];
    let runId = null;
    let plannedVia = 'extension';
    const history = options && Array.isArray(options.history) ? options.history : [];
    const pageSummary = collectPageSummary();

    let chatOk = false;
    let chatError = '';
    try {
      const chat = await askDeepSeekChat(utterance, history, pageSummary);
      reply = chat.reply || '';
      actions = chat.actions && chat.actions.length ? chat.actions : [chat.action];
      plannedVia = 'extension';
      chatOk = true;
    } catch (error) {
      chatError = error && error.message ? String(error.message) : '对话失败';
      reply = '';
      actions = [];
    }

    // 扩展对话失败时，再退回 Nest 规划（同样带 history）
    if (!chatOk && Habits) {
      try {
        const planned = await Habits.planTask(utterance, { history, pageSummary });
        if (planned && planned.ok) {
          reply = planned.reply || reply;
          runId = planned.runId || null;
          plannedVia = 'server';
          if (Array.isArray(planned.steps) && planned.steps.length) {
            actions = planned.steps.map((step) => ({
              type: step.type,
              query: step.query || '',
              seq: step.seq,
            }));
          } else {
            actions = [];
          }
        }
      } catch (error) {
        if (!reply) {
          const nestMsg = error && error.message ? String(error.message) : '规划失败';
          throw new Error(chatError ? `${chatError}；Nest：${nestMsg}` : nestMsg);
        }
      }
    }

    if (!chatOk && !reply) {
      throw new Error(
        chatError
          || 'DeepSeek 对话失败。请检查扩展选项里的 API Key，并重新加载扩展。',
      );
    }

    let actionable = filterActionableSteps(utterance, actions);

    // 模型只回了话、没给打开动作时：本地按关键字补开流程/菜单（关键词默认已含「打开/流程/菜单」）
    if (!actionable.length && (saidOpenOrEnter(utterance) || /待办/.test(String(utterance || '')))) {
      const settings = await loadAiSettings();
      const local = await tryLocalOpenFromUtterance(utterance, settings);
      if (local) {
        return {
          ...local,
          message: local.message
            ? `助手：${reply || '好的。'}\n\n执行：\n1. ${local.message}`
            : `助手：${reply || local.message || '好的。'}`,
          reply: reply || local.message || '好的。',
          action: { type: 'none', query: '' },
          actions: [],
          plannedVia: `${plannedVia}+local`,
          choices: local.choices || [],
          runId: runId || null,
        };
      }
    }

    if (!actionable.length) {
      return {
        status: 'chat',
        message: `助手：${reply || '请再说清楚一点。'}`,
        reply: reply || '请再说清楚一点。',
        action: { type: 'none', query: '' },
        actions: [],
        plannedVia,
        choices: [],
        runId: runId || null,
      };
    }

    // 有可执行步骤时，尝试 Nest 入库拿到 runId（不覆盖前端已结合上下文的动作）
    if (!runId && Habits) {
      try {
        const planned = await Habits.planTask(utterance, { history, pageSummary });
        if (planned && planned.ok && planned.runId) {
          runId = planned.runId;
          plannedVia = 'extension+server';
        }
      } catch (error) {
        // 落库失败不影响执行
      }
    }

    const exec = await executeChatActions(actionable, utterance, { runId, history });
    return {
      ...exec,
      status: exec.status === 'chat' ? 'chat' : exec.status,
      message: formatChatResult(reply, exec),
      reply,
      action: actionable[0] || { type: 'none', query: '' },
      actions: actionable,
      plannedVia,
      choices: exec.choices || [],
      requiredReady: exec.requiredReady,
      missing: exec.missing || [],
      missingTitles: exec.missingTitles || [],
      filled: exec.filled || {},
      runId: exec.runId || runId,
    };
  }

  async function handleUtterance(utterance, options) {
    if (location.hash.startsWith('#/login') || document.querySelector('input[placeholder="请输入密码"]')) {
      return { status: 'login', message: describe({ status: 'login' }), choices: [] };
    }

    const settings = await loadAiSettings();
    const aiReady = Boolean(settings && settings.enabled && settings.hasKey);
    const habitSettings = true
      ? await Habits.loadHabitSettings()
      : null;
    const serverPlanReady = Boolean(habitSettings && habitSettings.habitEnabled && habitSettings.habitBackendUrl);

    // Nest 规划 或 扩展 DeepSeek：拆步 →（入库）→ 逐步执行 → 失败再 Act
    if (serverPlanReady || aiReady) {
      try {
        return await planAndRunUtterance(utterance, options);
      } catch (error) {
        const fallbackNote = `（智能规划失败：${error.message || '调用失败'}，已改用本地处理）`;
        if (true && Leave.looksLikeLeaveTask(utterance)) {
          const local = await runLeaveAgent(utterance);
          return { ...local, message: `${local.message}\n${fallbackNote}` };
        }
      }
    }

    // 未配置 AI：请假填表走本地 Agent
    if (true && Leave.looksLikeLeaveTask(utterance)) {
      return runLeaveAgent(utterance);
    }

    const scope = Intent.detectScope(utterance, settings || {});

    // 明确打开流程：本地唯一命中则直接打开，不混菜单。
    if (scope === 'workflow') {
      const rows = await loadRowsFromTable();
      const local = Match.matchWorkflows(utterance, rows);
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
      const hit = Intent.findById(candidates, decision.id);
      const opened = await openCandidate(hit);
      return { ...opened, choices: [] };
    }
    if (decision.decision === 'choose') {
      const choices = (decision.candidates || []).map((item) => {
        const full = Intent.findById(candidates, item.id) || item;
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== MSG.run) return false;
    handleUtterance(message.utterance || '')
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({
        status: 'error',
        message: error && error.message ? error.message : '执行失败。',
      }));
    return true;
  });

export {
  handleUtterance,
  confirmLeaveSubmit,
  openCandidate,
  suppressAutoOpenFromUrl,
  delay,
  waitFor,
};

