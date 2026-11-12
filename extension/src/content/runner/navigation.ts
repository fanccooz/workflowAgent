// @ts-nocheck
import * as Match from '@/shared/match';
import * as Intent from '@/shared/intent';
import { MSG, LIST_HASH } from '@/shared/types';
import {
  delay,
  waitFor,
  visibleDialogs,
  isWorkflowLaunchDialog,
} from '@/shared/dom';
import {
  listBlockingDialogs,
  listConfirmClosePrompts,
  closeWorkflowDialogs,
  ensureDialogsClosedForNavigation,
} from '@/shared/dialog-dismiss';
import {
  loadRowsFromTable,
  clickNewWorkflow,
  openByCodeHash,
  pageErrorText,
} from './page-table';
import { clickUiByLabel } from './list-filter';

function dialogLooksLikeTarget(dialog, name) {
  const text = String((dialog && dialog.innerText) || '').replace(/\s+/g, '');
  const want = String(name || '').replace(/\s+/g, '');
  if (!text || !want) return false;
  const core = want.replace(/(流程|申请)$/g, '');
  return text.includes(want) || (core.length >= 2 && text.includes(core));
}

export function currentCode() {
  const query = location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get('code') || '';
}

// 去掉地址里的 ?code=，避免刷新后再次自动打开发起弹窗。
export function clearEmbedCodeFromHash() {
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

export async function suppressAutoOpenFromUrl() {
  // early-clean 可能已清 URL；这里再补关弹窗，并短时重试。
  for (let attempt = 0; attempt < 25; attempt += 1) {
    clearEmbedCodeFromHash();
    const opened = listBlockingDialogs().length > 0;
    if (opened || currentCode()) {
      await closeWorkflowDialogs({ force: true });
      clearEmbedCodeFromHash();
      if (!listBlockingDialogs().length && !currentCode()) return;
    } else if (attempt >= 8) {
      // 等了一会儿都没有自动弹窗，结束。
      return;
    }
    await delay(200);
  }
  clearEmbedCodeFromHash();
  await closeWorkflowDialogs();
}

export function describe(result) {
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

function menuNodeTitle(node) {
  if (!node) return '';
  const aria = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
  const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  const title = text || aria;
  return title.length > 48 ? title.slice(0, 48) : title;
}

function menuParentPath(node) {
  const path = [];
  let cur = node && node.parentElement;
  while (cur) {
    if (cur.classList && cur.classList.contains('el-submenu')) {
      const titleEl = cur.querySelector(':scope > .el-submenu__title');
      const title = menuNodeTitle(titleEl);
      if (title) path.unshift(title);
    }
    cur = cur.parentElement;
    if (path.length >= 6) break;
  }
  return path;
}

function isSidebarMenuRoot(node) {
  return Boolean(
    node
    && node.closest
    && node.closest('.el-aside, .sidebar, .layout-sider, .left-menu, .el-menu, [class*="side"]'),
  );
}

/** 采集侧栏菜单（含嵌套路径），供模糊搜索；不要求用户知道在哪个目录下 */
function collectMenus() {
  const seen = new Set();
  const items = [];
  const pushItem = (node, kind) => {
    if (!node || !isSidebarMenuRoot(node)) return;
    const title = menuNodeTitle(node);
    if (!title || title.length < 1) return;
    const path = menuParentPath(node);
    const pathKey = path.join('/');
    const key = `${kind}:${pathKey}:${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    const href = node.getAttribute('href') || (node.closest && node.closest('a') && node.closest('a').getAttribute('href')) || '';
    items.push({
      type: 'menu',
      id: `menu:${key}`,
      title,
      subtitle: pathKey ? `${pathKey} / ${title}` : (href || title),
      path,
      kind,
      href: href || '',
      openable: kind === 'item' || kind === 'link',
    });
  };

  const roots = [
    ...document.querySelectorAll('.el-aside, .sidebar, .layout-sider, .left-menu'),
  ];
  const scope = roots.length ? roots : [document];
  for (const root of scope) {
    root.querySelectorAll('.el-menu-item').forEach((node) => pushItem(node, 'item'));
    root.querySelectorAll('.el-submenu__title').forEach((node) => pushItem(node, 'submenu'));
    root.querySelectorAll('a[href], [role="menuitem"]').forEach((node) => {
      if (node.classList && (node.classList.contains('el-menu-item') || node.classList.contains('el-submenu__title'))) return;
      pushItem(node, 'link');
    });
  }
  // 顶栏/页签作补充（无侧栏路径）
  document.querySelectorAll('.el-tabs__item').forEach((node) => {
    const title = menuNodeTitle(node);
    if (!title || seen.has(`tab:${title}`)) return;
    seen.add(`tab:${title}`);
    items.push({
      type: 'menu',
      id: `menu:tab:${title}`,
      title,
      subtitle: `页签 / ${title}`,
      path: ['页签'],
      kind: 'tab',
      href: '',
      openable: true,
    });
  });
  return items.slice(0, 200);
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

export async function collectCandidates(scope) {
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

export async function openWorkflowRow(match) {
  const alreadyOpen = visibleDialogs().some((dialog) => (
    isWorkflowLaunchDialog(dialog) && dialogLooksLikeTarget(dialog, match.name)
  ));
  if (alreadyOpen) {
    clearEmbedCodeFromHash();
    return { status: 'open', message: `「${match.name}」的发起弹窗已经打开。` };
  }

  // 只关掉其它挡路弹窗，保留已是目标流程的窗；回填中也不会为了「再打开一次」把自己关了
  await closeWorkflowDialogs({ force: true, keepMatch: match.name });
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

export async function openWorkflowByUtterance(utterance) {
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

function findMenuNodeByTitle(title, preferKind) {
  const want = String(title || '').replace(/\s+/g, ' ').trim();
  if (!want) return null;
  const selectors = [
    '.el-menu-item',
    '.el-submenu__title',
    '[role="menuitem"]',
    '.sidebar a',
    '.el-aside a',
    '.el-tabs__item',
  ];
  const nodes = [...document.querySelectorAll(selectors.join(', '))];
  const matches = nodes.filter((node) => menuNodeTitle(node) === want);
  if (!matches.length) return null;
  if (preferKind === 'item') {
    const leaf = matches.find((node) => node.classList && node.classList.contains('el-menu-item'));
    if (leaf) return leaf;
  }
  if (preferKind === 'submenu') {
    const sub = matches.find((node) => node.classList && node.classList.contains('el-submenu__title'));
    if (sub) return sub;
  }
  return matches[0];
}

function clickMenuByTitle(title) {
  const target = findMenuNodeByTitle(title, 'item') || findMenuNodeByTitle(title);
  if (!target) return false;
  target.click();
  return true;
}

async function expandMenuPath(path) {
  const parents = Array.isArray(path) ? path : [];
  for (const parentTitle of parents) {
    const node = findMenuNodeByTitle(parentTitle, 'submenu') || findMenuNodeByTitle(parentTitle);
    if (!node) continue;
    const submenu = node.closest && node.closest('.el-submenu');
    const opened = submenu && submenu.classList && submenu.classList.contains('is-opened');
    if (!opened) {
      (node.classList && node.classList.contains('el-submenu__title') ? node : submenu && submenu.querySelector('.el-submenu__title') || node).click();
      await delay(120);
    }
  }
}

async function openMenuCandidate(item) {
  if (!item) return { status: 'error', message: '没有可打开的菜单。' };
  const closed = await ensureDialogsClosedForNavigation();
  if (!closed && (listBlockingDialogs().length || listConfirmClosePrompts().length)) {
    return {
      status: 'error',
      message: '表单还没关掉（确认关闭弹窗可能还在）。请点确认关闭后再说一次，或再说「打开首页」。',
    };
  }
  const title = item.title;
  const path = Array.isArray(item.path) ? item.path : [];
  await expandMenuPath(path);
  const prefer = item.kind === 'submenu' ? 'submenu' : 'item';
  let target = findMenuNodeByTitle(title, prefer) || findMenuNodeByTitle(title);
  // 路径展开后再找一次：有时叶子在折叠时不在可点状态
  if (!target && path.length) {
    await expandMenuPath(path);
    target = findMenuNodeByTitle(title, prefer) || findMenuNodeByTitle(title);
  }
  if (!target) {
    return { status: 'error', message: `没有点到菜单「${title}」。` };
  }
  target.click();
  await delay(200);
  const where = path.length ? `${path.join(' / ')} / ${title}` : title;
  return { status: 'open', message: `已打开菜单「${where}」。` };
}

export async function openCandidate(item) {
  if (!item) return { status: 'error', message: '没有可打开的项。' };
  if (item.kind === 'click' || String(item.id || '').startsWith('click:')) {
    return clickUiByLabel(item.title || item.query || '', item.title || '');
  }
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
    return openMenuCandidate(item);
  }
  if (item.type === 'todo') {
    if (item.id === 'todo:entry') {
      await ensureDialogsClosedForNavigation();
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

export function formatChooseMessage(decision) {
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

export async function askDeepSeek(utterance, scope, candidates) {
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

async function openHomePage() {
  const closed = await ensureDialogsClosedForNavigation();
  if (!closed && (listBlockingDialogs().length || listConfirmClosePrompts().length)) {
    return {
      status: 'error',
      message: '还没关掉当前表单（需要先确认关闭）。请点确认关闭后再说「打开首页」。',
    };
  }
  const titles = ['首页', '主页', '工作台', '门户', '首页门户'];
  for (const title of titles) {
    const hit = menusFindByTitle(title);
    if (hit) return openMenuCandidate(hit);
    if (clickMenuByTitle(title)) {
      await delay(250);
      return { status: 'open', message: `已打开「${title}」。` };
    }
  }
  // 侧栏点不到时，退回常见首页路由
  const candidates = ['#/', '#/home', '#/index', '#/dashboard', '#/portal'];
  const current = String(location.hash || '').split('?')[0];
  for (const hash of candidates) {
    if (current === hash) {
      return { status: 'open', message: '已在首页。' };
    }
  }
  location.hash = '#/';
  await delay(300);
  return { status: 'open', message: '已尝试进入首页。' };
}

export function menusFindByTitle(title) {
  const want = String(title || '').replace(/\s+/g, '');
  return collectMenus().find((item) => String(item.title || '').replace(/\s+/g, '') === want) || null;
}

export async function openMenuByUtterance(utterance) {
  const text = String(utterance || '').replace(/\s+/g, '');
  if (/首页|主页|工作台|门户/.test(text)) {
    return openHomePage();
  }
  const menus = collectMenus();
  const result = Match.matchMenus(utterance, menus);
  if (result.status === 'open' && result.matches[0]) {
    return openMenuCandidate(result.matches[0]);
  }
  if (result.status === 'choose' && result.matches.length) {
    return {
      status: 'choose',
      message: formatChooseMessage({ candidates: result.matches }),
      choices: result.matches,
    };
  }
  // 本地模糊没命中：交给 DeepSeek 在全量菜单里选
  try {
    const settings = await loadAiSettings();
    if (settings && settings.enabled && settings.hasKey && menus.length) {
      const decision = await askDeepSeek(utterance, 'menu', menus.slice(0, 80));
      if (decision.decision === 'open') {
        const hit = Intent.findById(menus, decision.id) || menus.find((m) => m.title === decision.title);
        if (hit) return openMenuCandidate(hit);
      }
      if (decision.decision === 'choose' && decision.candidates && decision.candidates.length) {
        const choices = decision.candidates
          .map((item) => Intent.findById(menus, item.id) || item)
          .filter(Boolean);
        return {
          status: 'choose',
          message: formatChooseMessage({ candidates: choices }),
          choices,
        };
      }
    }
  } catch (error) {
    // 忽略，走下面的 none
  }
  return {
    status: 'none',
    message: menus.length
      ? `没有匹配到菜单「${String(utterance || '').trim()}」。可以说更短的名称，或从侧栏相近项里选。`
      : '当前页面没有采集到侧栏菜单。',
    choices: [],
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

export async function aiOpenWorkflow(utterance) {
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
