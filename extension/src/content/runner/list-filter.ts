// @ts-nocheck
import {
  delay,
  waitFor,
  visibleDialogs,
  isInSidebar,
  isVisibleEl,
  findVueInstance,
  setNativeValue,
  readInputValue,
  valueLooksSet,
  normalizeFieldLabel,
} from '@/shared/dom';

export async function writeFilterInput(input, key) {
  const text = String(key || '');
  try {
    input.focus();
    input.select?.();
  } catch (error) {
    // 忽略
  }
  // 先清空再写入，避免上次关键字残留导致「搜一次就改不了」
  setNativeValue(input, '');
  await delay(50);
  setNativeValue(input, text);
  await delay(80);
  if (valueLooksSet(readInputValue(input), text)) return true;
  const vue = findVueInstance(input);
  if (vue) {
    try {
      if (typeof vue.handleInput === 'function') {
        vue.handleInput('');
        vue.handleInput(text);
      } else if (typeof vue.$emit === 'function') {
        vue.$emit('input', '');
        vue.$emit('input', text);
        vue.$emit('change', text);
      }
      if (vue.value !== undefined) vue.value = text;
    } catch (error) {
      // 忽略组件差异
    }
    await delay(80);
  }
  return valueLooksSet(readInputValue(input), text);
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
  const label = normalizeFieldLabel(labelEl ? labelEl.textContent : '');
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
      && !el.disabled
      // 允许 readonly：Element 常把展示框标成只读，写入时会临时解开
      && !el.closest('.el-select, .el-pagination, .el-date-editor, .el-dialog')
    ));
}

/** 清洗筛选关键字：只要真正要搜的内容，去掉「搜索/流程编号」等杂质 */
export function normalizeFilterKeyword(query, utterance) {
  const utter = String(utterance || '').trim();
  const q = String(query || '').trim();
  const id = (utter.match(/\d{6,}/) || q.match(/\d{6,}/) || [])[0];
  if (id) return id;

  let key = q || utter;
  key = key.replace(/^(请?(?:帮我)?(?:搜索|筛选|过滤|查找|查询))\s*/u, '');
  key = key.replace(/\s*(搜索|筛选|查询|查找)$/u, '');
  const labels = [
    '流程编号', '流程单号', '单据编号', '流程名称', '流程定义名称', '流程定义',
    '单据标题', '关键字', '关键词', '单号', '编号', '编码', '名称', '标题', '主题',
  ];
  for (const label of labels) {
    if (key.startsWith(label)) {
      key = key.slice(label.length).replace(/^[\s:：]+/, '');
      break;
    }
  }
  return key.trim() || q || utter;
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

export async function waitForListPageReady(timeout = 8000) {
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

/** 点击当前页/弹窗可见按钮/链接（按文案模糊匹配） */
export async function clickUiByLabel(keyword, utterance) {
  const key = String(keyword || '').replace(/\s+/g, '').trim()
    || String(utterance || '').replace(/\s+/g, '').replace(/^(请)?(帮我)?(点击|点开|点一下|点)/, '').trim();
  if (!key) {
    return {
      status: 'error',
      message: '没有要点的按钮名。可以说「帮我点查看草稿」。',
      choices: [],
    };
  }
  if (/提交/.test(key) && !/不提交/.test(key)) {
    return {
      status: 'chat',
      message: '流程提交需要你在表单里手动点击「提交」，我不会代为提交。',
      choices: [],
    };
  }

  // 弹窗优先：草稿/提交按钮多半在 dialog 里
  const dialogs = visibleDialogs();
  const roots = dialogs.length ? dialogs : [document];
  const nodes = [];
  for (const root of roots) {
    nodes.push(
      ...root.querySelectorAll(
        'button, a, .el-button, [role="button"], .el-link, span.el-link, .el-dropdown-menu__item, li.el-select-dropdown__item',
      ),
    );
  }
  if (dialogs.length) {
    // 再补一层页面主区，避免漏掉非弹窗按钮
    nodes.push(
      ...document.querySelectorAll(
        'button, a, .el-button, [role="button"], .el-link',
      ),
    );
  }
  const unique = [...new Set(nodes)].filter((el) => isVisibleEl(el) && !isInSidebar(el));
  const scored = unique.map((el) => {
    const text = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, '')
      .trim();
    if (!text) return { el, text, score: 0 };
    let score = 0;
    if (text === key) score = 100;
    else if (text.includes(key) || key.includes(text)) score = 80;
    else if (text.length >= 2 && key.includes(text.slice(0, Math.min(4, text.length)))) score = 40;
    // 弹窗内按钮优先
    if (score > 0 && el.closest && el.closest('.el-dialog, .el-overlay-dialog, [role="dialog"]')) {
      score += 8;
    }
    return { el, text, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  if (!scored.length) {
    return {
      status: 'error',
      message: `当前页没找到可点的「${key}」。请确认按钮已显示，或再说准确名称。`,
      choices: [],
    };
  }

  const top = scored.filter((item) => item.score >= scored[0].score - 10).slice(0, 6);
  if (top.length > 1 && scored[0].score < 100) {
    return {
      status: 'choose',
      message: `找到多个相近按钮，请选一个：\n${top.map((item) => `- ${item.text}`).join('\n')}`,
      choices: top.map((item, index) => ({
        type: 'menu',
        id: `click:${index}:${item.text}`,
        title: item.text,
        subtitle: '点击按钮',
        openable: true,
        kind: 'click',
      })),
    };
  }

  const hit = scored[0];
  hit.el.click();
  await delay(280);
  return {
    status: 'open',
    message: `已点击「${hit.text}」。`,
    choices: [],
  };
}

/** 通用列表筛选：不绑定待办，适用于任意已打开的列表/查询页 */
export async function applyListFilter(keyword, utterance) {
  const key = normalizeFilterKeyword(keyword, utterance);
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
  // 部分页面查询后会清空输入框，只要写入成功就视为已触发
  const { label } = fieldContextText(input);
  const where = label ? `「${label}」` : '筛选框';
  return { status: 'open', message: `已在${where}写入「${key}」并触发查询。`, choices: [] };
}
