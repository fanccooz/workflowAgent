// @ts-nocheck
import * as LeaveSkill from './leave';
import * as FormFill from './formfill';
import * as AgentApi from './agent';
import * as FillLock from './fill-lock';
import { LIST_HASH } from './types';
import {
  delay,
  waitFor,
  visibleDialogs,
  isWorkflowLaunchDialog,
  isBlockingFormDialog,
  tableLoadFailed,
  findVueInstance,
  setNativeValue,
  readInputValue,
  valueLooksSet,
} from './dom';

  function hasAgRows() {
    return document.querySelectorAll('.ag-center-cols-container .ag-row').length > 0;
  }

  function observePage() {
    const login = Boolean(
      (typeof location !== 'undefined' && location.hash.startsWith('#/login'))
      || document.querySelector('input[placeholder="请输入密码"]'),
    );
    const hash = (typeof location !== 'undefined' && location.hash) || '';
    const onWorkflowList = hash.split('?')[0] === LIST_HASH;
    const dialogs = visibleDialogs();
    const launch = dialogs.find(isWorkflowLaunchDialog) || null;
    const fields = launch ? collectDialogFields() : [];
    return {
      ok: true,
      observation: {
        login,
        onWorkflowList,
        hasRows: hasAgRows(),
        listLoadFailed: tableLoadFailed(),
        launchDialogOpen: Boolean(launch),
        launchDialogText: launch
          ? String(launch.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240)
          : '',
        fieldCount: fields.length,
        fields: fields.map((field) => ({
          label: field.label,
          kind: field.kind,
          required: Boolean(field.required),
          value: field.value || '',
        })),
        hash,
      },
    };
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

  function clickRefreshList() {
    const buttons = [...document.querySelectorAll('button, a, span, div')];
    const target = buttons.find((el) => {
      const text = (el.innerText || '').replace(/\s+/g, '');
      return text === '刷新列表' || text === '刷新';
    });
    if (!target) return false;
    target.click();
    return true;
  }

  function btnText(el) {
    return String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, '');
  }

  function clickDom(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === 'function') el.click();
      return true;
    } catch (error) {
      return false;
    }
  }

  function listConfirmClosePrompts() {
    const boxes = [...document.querySelectorAll(
      '.el-message-box__wrapper, .el-overlay-message-box, .el-message-box, .el-overlay.is-message-box',
    )].filter((item) => {
      const style = getComputedStyle(item);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
    const confirmDialogs = visibleDialogs().filter((dialog) => {
      if (isWorkflowLaunchDialog(dialog)) return false;
      const text = String(dialog.innerText || '').replace(/\s+/g, '');
      if (/基础信息/.test(text) && /提交/.test(text)) return false;
      const looksConfirm = /是否关闭|确认关闭|未保存|是否放弃|放弃编辑|离开当前|是否离开|关闭当前|数据尚未|内容尚未/.test(text);
      const buttons = [...dialog.querySelectorAll('button, .el-button')];
      const hasOk = buttons.some((b) => /^(确定|确认|是|关闭|不保存|放弃)$/.test(btnText(b)));
      const hasCancel = buttons.some((b) => /^(取消|否)$/.test(btnText(b)));
      return looksConfirm || (hasOk && hasCancel && buttons.length <= 4 && !/提交/.test(text));
    });
    return [...boxes, ...confirmDialogs];
  }

  async function confirmClosePromptIfAny() {
    const prompts = listConfirmClosePrompts();
    if (!prompts.length) return false;
    const prompt = prompts[prompts.length - 1];
    const root = (prompt.classList && prompt.classList.contains('el-message-box'))
      ? prompt
      : (prompt.querySelector && prompt.querySelector('.el-message-box')) || prompt;
    const boxButtons = [...root.querySelectorAll('button, .el-button')].filter((item) => !/提交/.test(btnText(item)));
    const discard = boxButtons.find((item) => /不保存|放弃|不提交|离开|丢弃/.test(btnText(item)));
    const confirmClose = boxButtons.find((item) => /^(确定|确认|是|关闭|OK|Yes)$/i.test(btnText(item)));
    const primary = boxButtons.find((item) => item.classList && item.classList.contains('el-button--primary')
      && !/取消|否|提交/.test(btnText(item)));
    const pick = discard || confirmClose || primary;
    if (!pick) return false;
    clickDom(pick);
    await delay(300);
    return true;
  }

  /** 进流程列表前清掉挡路弹窗：关表单 → 确认关闭。不点提交。回填进行中不关。 */
  async function dismissBlockingDialogs() {
    if (FillLock.isFormFillActive()) return false;
    for (let round = 0; round < 5; round += 1) {
      await confirmClosePromptIfAny();
      const dialogs = visibleDialogs().filter(isBlockingFormDialog);
      if (!dialogs.length) return true;
      const dialog = dialogs[dialogs.length - 1];
      const footer = dialog.querySelector('.el-dialog__footer, .dialog-footer, .el-drawer__footer');
      const scope = footer || dialog;
      const buttons = [...scope.querySelectorAll('button, .el-button, a')];
      const cancel = buttons.find((button) => {
        const text = btnText(button);
        return /^(取消|关闭)$/.test(text) || (/取消|关闭/.test(text) && !/提交/.test(text));
      });
      const closeButton = dialog.querySelector('.el-dialog__headerbtn, .el-dialog__close');
      const target = cancel || closeButton;
      if (!target) {
        if (!(await confirmClosePromptIfAny())) break;
        continue;
      }
      clickDom(target);
      for (let wait = 0; wait < 8; wait += 1) {
        await delay(180);
        if (await confirmClosePromptIfAny()) break;
        if (!visibleDialogs().filter(isBlockingFormDialog).length) return true;
      }
    }
    await confirmClosePromptIfAny();
    return visibleDialogs().filter(isBlockingFormDialog).length === 0;
  }

  async function gotoWorkflowList() {
    await dismissBlockingDialogs();
    const baseHash = location.hash.split('?')[0];
    if (baseHash !== LIST_HASH) {
      const clicked = clickMenuByTitle('流程定义') || clickMenuByTitle('流程管理');
      if (!clicked) {
        location.hash = LIST_HASH;
      }
      await delay(400);
    }

    // 最多自动刷新 2 次，处理页面「加载异常」
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await waitFor(() => hasAgRows() || tableLoadFailed(), 8000);
      } catch (error) {
        if (attempt >= 2) {
          return { ok: false, message: '进了流程定义，但列表没有出来。请手动点「刷新列表」后重试。' };
        }
      }
      if (hasAgRows()) {
        return { ok: true, message: attempt ? '已刷新并进入流程定义列表。' : '已在流程定义列表。' };
      }
      if (tableLoadFailed() || !hasAgRows()) {
        const refreshed = clickRefreshList();
        if (!refreshed && attempt >= 1) {
          return { ok: false, message: '流程列表加载异常，且页面上找不到「刷新列表」按钮。' };
        }
        await delay(600);
      }
    }
    return { ok: false, message: '流程定义列表仍显示加载异常。请手动点「刷新列表」或刷新网页后再试。' };
  }

  function normalizeLabel(text) {
    return String(text || '').replace(/\s+/g, '').replace(/[:：*＊]/g, '');
  }

  function findLabelInput(labels) {
    const list = Array.isArray(labels) ? labels : [];
    const dialog = visibleDialogs().find(isWorkflowLaunchDialog) || document;
    // 优先：表单项 label 精确/包含匹配，避免整行 includes 点到错误 input
    const items = [...dialog.querySelectorAll('.el-form-item')];
    for (const labelText of list) {
      const want = normalizeLabel(labelText);
      if (!want) continue;
      for (const item of items) {
        const labelEl = item.querySelector('.el-form-item__label, label');
        const label = normalizeLabel(labelEl ? labelEl.textContent : '');
        if (!label || (label !== want && !label.includes(want) && !want.includes(label))) continue;
        const input = item.querySelector('.el-form-item__content input:not([type="hidden"]), .el-form-item__content textarea, input:not([type="hidden"]), textarea');
        if (input) return input;
      }
    }
    return null;
  }

  function dateFormatVariants(ymd) {
    const raw = String(ymd || '').trim();
    const m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) return [raw];
    const y = m[1];
    const mo = String(m[2]).padStart(2, '0');
    const d = String(m[3]).padStart(2, '0');
    const day = `${y}-${mo}-${d}`;
    return [
      day,
      `${y}/${mo}/${d}`,
      `${day} 00:00:00`,
      `${day} 09:00:00`,
      `${y}-${mo}-${d}T00:00:00`,
    ];
  }

  function visiblePoppers(selectors) {
    return [...document.querySelectorAll(selectors)]
      .filter((panel) => {
        const style = getComputedStyle(panel);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
  }

  function clickConfirmIn(panel) {
    if (!panel) return false;
    const ok = [...panel.querySelectorAll('button')].find((btn) => /确定|OK|此刻/i.test(btn.innerText || ''));
    if (!ok) return false;
    ok.click();
    return true;
  }

  function parseTimeParts(text) {
    const raw = String(text || '').trim();
    const hit = raw.match(/(?:(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)/);
    if (!hit) return null;
    return {
      hour: Number(hit[1]),
      minute: Number(hit[2]),
      second: hit[3] == null ? null : Number(hit[3]),
    };
  }

  async function pickSpinnerColumn(panel, columnIndex, want) {
    if (want == null || !Number.isFinite(want)) return false;
    const columns = [...panel.querySelectorAll('.el-time-spinner__wrapper, .el-scrollbar')];
    const column = columns[columnIndex];
    if (!column) return false;
    const items = [...column.querySelectorAll('.el-time-spinner__item, li')];
    const target = items.find((item) => {
      const n = Number(String(item.textContent || '').trim());
      return n === want;
    });
    if (!target) return false;
    target.click();
    await delay(80);
    return true;
  }

  async function pickTimeFromPanel(input, text) {
    const parts = parseTimeParts(text);
    if (!parts) return false;
    try {
      input.click();
    } catch (error) {
      return false;
    }
    await delay(250);
    const panels = visiblePoppers('.el-time-panel, .el-picker-panel, .el-time-picker__panel, .el-picker__popper');
    const panel = panels[panels.length - 1];
    if (!panel || !panel.querySelector('.el-time-spinner, .el-time-panel')) return false;
    await pickSpinnerColumn(panel, 0, parts.hour);
    await pickSpinnerColumn(panel, 1, parts.minute);
    if (parts.second != null) await pickSpinnerColumn(panel, 2, parts.second);
    clickConfirmIn(panel);
    await delay(120);
    return valueLooksSet(readInputValue(input), text);
  }

  async function pickDateFromPanel(input, ymd) {
    const m = String(ymd || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const timeParts = parseTimeParts(ymd);
    try {
      input.click();
    } catch (error) {
      return false;
    }
    await delay(250);
    const panels = visiblePoppers('.el-picker-panel, .el-date-picker, .el-picker__popper, .el-date-range-picker');
    const panel = panels[panels.length - 1];
    if (!panel) return false;

    for (let guard = 0; guard < 24; guard += 1) {
      const label = (panel.querySelector('.el-date-picker__header-label, .el-date-range-picker__header') || panel)
        .innerText || '';
      const hasYear = label.includes(String(year));
      const hasMonth = label.includes(`${month}月`) || label.includes(`-${String(month).padStart(2, '0')}`);
      if (hasYear && (hasMonth || !/月/.test(label))) break;
      const next = panel.querySelector('[aria-label="下个月"], .el-icon-arrow-right, .arrow-right, .el-picker-panel__icon-btn.el-icon-arrow-right');
      const prev = panel.querySelector('[aria-label="上个月"], .el-icon-arrow-left, .arrow-left, .el-picker-panel__icon-btn.el-icon-arrow-left');
      const currentYear = Number((label.match(/(\d{4})/) || [])[1]);
      const btn = currentYear > year ? prev : next;
      if (!btn) break;
      btn.click();
      await delay(120);
    }

    const cells = [...panel.querySelectorAll('td.available, td:not(.disabled)')];
    const target = cells.find((td) => {
      if (td.classList.contains('prev-month') || td.classList.contains('next-month')) return false;
      const span = td.querySelector('span, div') || td;
      return Number(String(span.textContent || '').trim()) === day;
    });
    if (!target) return false;
    target.click();
    await delay(150);
    if (timeParts) {
      await pickSpinnerColumn(panel, 0, timeParts.hour);
      await pickSpinnerColumn(panel, 1, timeParts.minute);
      if (timeParts.second != null) await pickSpinnerColumn(panel, 2, timeParts.second);
    }
    clickConfirmIn(panel);
    await delay(120);
    return valueLooksSet(readInputValue(input), ymd);
  }

  function optionText(el) {
    return String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  }

  function optionMatches(text, want) {
    const a = String(text || '').replace(/\s+/g, '');
    const b = String(want || '').replace(/\s+/g, '');
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  async function openSelectPanel(input) {
    const root = input.closest('.el-select, .el-cascader') || input;
    const trigger = root.querySelector('.el-input__inner, input, .el-select__wrapper, .el-cascader__label') || input;
    try {
      trigger.click();
    } catch (error) {
      return null;
    }
    await delay(280);
    const panels = visiblePoppers('.el-select-dropdown, .el-cascader__dropdown, .el-popper, .el-autocomplete-suggestion');
    return panels[panels.length - 1] || null;
  }

  async function fillSelectByOption(input, value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const panel = await openSelectPanel(input);
    if (!panel) return false;
    const filter = panel.querySelector('input') || input;
    if (filter && !filter.readOnly) {
      setNativeValue(filter, text);
      await delay(280);
    }
    const options = [...panel.querySelectorAll(
      '.el-select-dropdown__item, .el-cascader-node, .el-autocomplete-suggestion li, li, .el-option',
    )];
    const hit = options.find((opt) => {
      if (opt.classList && opt.classList.contains('is-disabled')) return false;
      return optionMatches(optionText(opt), text);
    });
    if (!hit) {
      document.body.click();
      await delay(80);
      return false;
    }
    hit.click();
    await delay(180);
    const leaf = [...panel.querySelectorAll('.el-cascader-node__label')].find((node) => optionMatches(optionText(node), text));
    if (leaf) {
      leaf.click();
      await delay(120);
    }
    return valueLooksSet(readInputValue(input), text);
  }

  async function fillPersonBySearch(input, value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const root = input.closest('.el-select, .el-autocomplete, .el-form-item__content') || input.parentElement;
    const editable = root.querySelector('input:not([type="hidden"])') || input;
    try {
      editable.click();
    } catch (error) {
      // 继续写字
    }
    setNativeValue(editable, text);
    await delay(350);
    const panels = visiblePoppers(
      '.el-select-dropdown, .el-autocomplete-suggestion, .el-popper, .el-table, .warom-user, .person-select, .user-select',
    );
    const panel = panels[panels.length - 1];
    if (panel) {
      const options = [...panel.querySelectorAll(
        '.el-select-dropdown__item, li, tr, .el-option, [role="option"], .user-item, .person-item',
      )];
      const hit = options.find((opt) => optionMatches(optionText(opt), text));
      if (hit) {
        const clickable = hit.querySelector('td, a, button, span') || hit;
        clickable.click();
        await delay(180);
        if (valueLooksSet(readInputValue(input), text) || valueLooksSet(readInputValue(editable), text)) {
          return true;
        }
      }
    }
    // 某些选人组件回车确认
    try {
      editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      editable.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    } catch (error) {
      // 忽略
    }
    await delay(120);
    return valueLooksSet(readInputValue(input), text) || valueLooksSet(readInputValue(editable), text);
  }

  async function pushVueValue(root, value) {
    const vue = findVueInstance(root);
    if (!vue) return false;
    try {
      if (typeof vue.handleInput === 'function') vue.handleInput(value);
      if (typeof vue.$emit === 'function') {
        vue.$emit('input', value);
        vue.$emit('update:modelValue', value);
        vue.$emit('change', value);
      }
      if (vue.value !== undefined) vue.value = value;
      if (vue.modelValue !== undefined) vue.modelValue = value;
      return true;
    } catch (error) {
      return false;
    }
  }

  async function fillControl(input, value, kind) {
    const text = String(value);
    const resolved = kind || detectInputKind(input, input.closest('.el-form-item'));

    if (resolved === 'select' || resolved === 'cascader') {
      if (await fillSelectByOption(input, text)) return true;
      await pushVueValue(input.closest('.el-select, .el-cascader') || input, text);
      await delay(40);
      return valueLooksSet(readInputValue(input), text);
    }

    if (resolved === 'person') {
      if (await fillPersonBySearch(input, text)) return true;
      if (await fillSelectByOption(input, text)) return true;
      return valueLooksSet(readInputValue(input), text);
    }

    if (resolved === 'time') {
      if (await pickTimeFromPanel(input, text)) return true;
      setNativeValue(input, text);
      await pushVueValue(input.closest('.el-date-editor, .el-time-picker') || input, text);
      await delay(40);
      return valueLooksSet(readInputValue(input), text);
    }

    if (resolved === 'date' || resolved === 'datetime' || input.closest('.el-date-editor')) {
      const variants = dateFormatVariants(text);
      for (const variant of variants) {
        setNativeValue(input, variant);
        await delay(40);
        if (valueLooksSet(readInputValue(input), text)) return true;
      }
      await pushVueValue(input.closest('.el-date-editor') || input, variants[0]);
      if (await pickDateFromPanel(input, variants[0] || text)) return true;
      if (resolved === 'datetime' || parseTimeParts(text)) {
        if (await pickTimeFromPanel(input, text)) return true;
      }
      return valueLooksSet(readInputValue(input), text);
    }

    setNativeValue(input, text);
    await delay(30);
    if (valueLooksSet(readInputValue(input), text)) return true;
    await pushVueValue(input, text);
    await delay(30);
    return valueLooksSet(readInputValue(input), text);
  }

  /** 只根据页面真实控件结构判断，不写死业务字段名。 */
  function detectInputKind(input, item) {
    if (!input) return 'text';
    if (input.tagName === 'TEXTAREA') return 'textarea';
    if (input.closest('.el-cascader') || (item && item.querySelector('.el-cascader'))) return 'cascader';
    if (input.closest('.el-select') || (item && item.querySelector('.el-select'))) return 'select';
    if (input.closest('.el-autocomplete') || (item && item.querySelector('.el-autocomplete'))) return 'person';
    const dateRoot = input.closest('.el-date-editor, .el-time-picker');
    if (dateRoot) {
      const cls = String(dateRoot.className || '');
      if (/time/.test(cls) && !/date/.test(cls)) return 'time';
      if (/datetime|date-editor--datetime|daterange|datetimerange/i.test(cls)) return 'datetime';
      if (/time/.test(cls)) return 'datetime';
      return 'date';
    }
    const type = String(input.getAttribute('type') || '').toLowerCase();
    if (type === 'date') return 'date';
    if (type === 'time') return 'time';
    if (type === 'datetime-local') return 'datetime';
    return 'text';
  }

  function collectDialogFields() {
    const dialog = visibleDialogs().find(isWorkflowLaunchDialog);
    if (!dialog) return [];
    const items = [...dialog.querySelectorAll('.el-form-item')];
    const fields = [];
    const seen = new Set();
    items.forEach((item, index) => {
      const labelEl = item.querySelector('.el-form-item__label, label');
      const rawLabel = labelEl ? labelEl.textContent : '';
      const label = normalizeLabel(rawLabel);
      if (!label || label.length > 40) return;
      if (seen.has(label)) return;
      const input = item.querySelector(
        '.el-form-item__content input:not([type="hidden"]), .el-form-item__content textarea, input:not([type="hidden"]), textarea',
      );
      if (!input) return;
      seen.add(label);
      const required = item.classList.contains('is-required')
        || /\*/.test(String(rawLabel || ''))
        || Boolean(item.querySelector('.el-form-item__label .el-form-item__required, .el-form-item__label [class*="required"]'));
      fields.push({
        id: `f${index}`,
        label,
        required,
        kind: detectInputKind(input, item),
        value: readInputValue(input),
        options: [],
      });
    });
    return fields;
  }

  /** 点开下拉，把页面上正在显示的选项原文采下来，再关掉。 */
  async function peekSelectOptions(input) {
    const panel = await openSelectPanel(input);
    if (!panel) return [];
    const options = [...panel.querySelectorAll(
      '.el-select-dropdown__item, .el-cascader-node__label, .el-autocomplete-suggestion li, .el-option, li[role="option"]',
    )]
      .map((el) => optionText(el))
      .filter((text) => text && text.length <= 40);
    const unique = [];
    options.forEach((text) => {
      if (!unique.includes(text)) unique.push(text);
    });
    try {
      document.body.click();
    } catch (error) {
      // 忽略
    }
    await delay(100);
    return unique.slice(0, 40);
  }

  async function enrichFieldsFromPage(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const field = list[i];
      if (!field || (field.kind !== 'select' && field.kind !== 'cascader' && field.kind !== 'person')) {
        out.push(field);
        continue;
      }
      const input = findLabelInput([field.label]);
      if (!input) {
        out.push(field);
        continue;
      }
      const options = await peekSelectOptions(input);
      out.push({ ...field, options });
    }
    return out;
  }

  async function fillByLabelMap(fills) {
    const data = fills && typeof fills === 'object' ? fills : {};
    const filled = {};
    const skipped = [];
    const notStuck = [];
    const labels = Object.keys(data);
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const value = data[label];
      if (value == null || String(value).trim() === '') continue;
      const input = findLabelInput([label]);
      if (!input) {
        skipped.push(label);
        continue;
      }
      const item = input.closest('.el-form-item');
      const kind = detectInputKind(input, item);
      let ok = await fillControl(input, String(value), kind);
      let actual = readInputValue(input);
      // 封装组件偶发没点中：同一字段只重试一次
      if (!(ok && valueLooksSet(actual, value))) {
        await delay(120);
        ok = await fillControl(input, String(value), kind);
        actual = readInputValue(input);
      }
      if (ok && valueLooksSet(actual, value)) filled[label] = actual;
      else notStuck.push(label);
    }
    const parts = [];
    if (Object.keys(filled).length) parts.push(`已填入：${Object.keys(filled).join('、')}`);
    if (notStuck.length) parts.push(`未生效需手补：${notStuck.join('、')}`);
    if (skipped.length) parts.push(`未找到控件：${skipped.join('、')}`);
    // 有计划填写但一个都没写进页面 → 算失败，便于反思/提示
    const attempted = labels.filter((key) => data[key] != null && String(data[key]).trim() !== '');
    const hardFail = attempted.length > 0 && Object.keys(filled).length === 0;
    return {
      ok: !hardFail,
      filled,
      skipped: skipped.concat(notStuck),
      notStuck,
      message: parts.length ? parts.join('；') : '没有可填的槽位。',
    };
  }

  /** 规则兜底：仍可用 leave skill 抽槽，再按已知别名填 */
  function fillLeaveFormFallback(utterance) {
    const Leave = LeaveSkill;
    if (!Leave) return { ok: false, fills: {}, message: '请假 skill 未加载。' };
    const slots = Leave.extractSlots(utterance, new Date());
    const fills = {};
    Object.keys(Leave.FIELD_LABELS).forEach((key) => {
      if (!slots[key]) return;
      const labels = Leave.labelsFor(key);
      const fields = collectDialogFields();
      const hit = fields.find((field) => labels.some((label) => {
        const a = normalizeLabel(field.label);
        const b = normalizeLabel(label);
        return a === b || a.includes(b) || b.includes(a);
      }));
      if (hit) fills[hit.label] = slots[key];
    });
    return { ok: true, fills, slots, message: '已用本地规则解析字段。' };
  }

  /** 弹窗里的封装组件会晚于弹窗出现。等字段数量连续两次不变再交给模型。 */
  async function waitForDialogFields() {
    let lastCount = -1;
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < 4500) {
      const count = collectDialogFields().length;
      if (count > 0 && count === lastCount) {
        stable += 1;
        if (stable >= 2) return collectDialogFields();
      } else {
        stable = 0;
        lastCount = count;
      }
      await delay(250);
    }
    return collectDialogFields();
  }

  /**
   * 顺序固定：等表单出现 → 把真实字段交给大模型分析 → 再按分析结果回填。
   * 打开前的对话摘要只作参考，不能跳过「拿到表单后再分析」这一步。
   */
  async function aiFillForm(utterance, helpers) {
    FillLock.beginFormFill();
    try {
      const rawFields = await waitForDialogFields();
      if (!rawFields.length) {
        return { ok: false, message: '弹窗里没有读到可填字段。', filled: {}, skipped: [] };
      }
      // 下拉选项也从当前页面实时采集，不使用写死的业务类型表
      const fields = await enrichFieldsFromPage(rawFields);

      const h = helpers || {};
      const priorAnalysis = h.analysis || null;
      const judged = FormFill.fillsFromSummary(priorAnalysis && (priorAnalysis.summary || priorAnalysis));
      let fills = {};
      let note = '';
      let analyzedAfterOpen = false;

      if (typeof h.aiPlanFill === 'function') {
        try {
          const planned = await h.aiPlanFill(utterance, fields, priorAnalysis);
          fills = (planned && planned.fills) || {};
          analyzedAfterOpen = true;
          note = (planned && planned.note)
            || `已读取 ${fields.length} 个字段并完成分析，开始回填。`;
        } catch (error) {
          fills = { ...judged };
          note = `表单已打开，但分析失败（${error.message || '错误'}），改用打开前的对话摘要兜底`;
        }
      } else {
        fills = { ...judged };
        note = Object.keys(judged).length
          ? '表单已打开，但没有填表分析接口，暂用打开前的对话摘要。'
          : '表单已打开，但没有可用来分析的内容。';
      }

      // 打开后再分析得到的结果为空时，才退回对话摘要
      if (!Object.keys(fills).length && Object.keys(judged).length) {
        fills = { ...judged };
        if (analyzedAfterOpen) note = `${note}；分析未给出字段值，已用对话摘要补充。`;
      }

      if (!Object.keys(fills).length) {
        return {
          ok: true,
          slotsExtracted: true,
          formFilled: true,
          filled: {},
          skipped: [],
          fields,
          analyzedAfterOpen,
          message: note || '已读取表单，但模型未给出可填内容，请在弹窗中手填。',
        };
      }

      const applied = await fillByLabelMap(fills);
      return {
        ok: applied.ok !== false,
        slotsExtracted: true,
        formFilled: true,
        filled: applied.filled,
        skipped: applied.skipped,
        notStuck: applied.notStuck || [],
        fields,
        fills,
        analyzedAfterOpen,
        message: [note, applied.message].filter(Boolean).join('；'),
      };
    } finally {
      FillLock.endFormFill();
    }
  }

  function checkRequired() {
    const fields = collectDialogFields();
    const required = fields.filter((field) => field.required);
    // 没有必填标记时，只检查页面上已采集到、且仍为空的字段里偏关键的输入类
    const targets = required.length
      ? required
      : fields.filter((field) => field.kind === 'date' || field.kind === 'datetime' || field.kind === 'text' || field.kind === 'textarea');
    const missingTitles = [];
    targets.forEach((field) => {
      const input = findLabelInput([field.label]);
      if (!readInputValue(input)) missingTitles.push(field.label);
    });
    const filled = {};
    fields.forEach((field) => {
      const value = readInputValue(findLabelInput([field.label]));
      if (value) filled[field.label] = value;
    });
    return {
      ok: true,
      ready: missingTitles.length === 0,
      missing: missingTitles,
      missingTitles,
      filled,
      message: missingTitles.length ? `必填仍缺：${missingTitles.join('、')}` : '必填已齐。',
    };
  }

  // 兼容旧名
  async function fillLeaveForm(slots) {
    const Leave = LeaveSkill;
    if (!Leave || !slots) return { ok: false, message: '无槽位。', filled: {}, skipped: [] };
    const fills = {};
    Object.keys(slots).forEach((key) => {
      if (!slots[key] || !Leave.FIELD_LABELS[key]) return;
      const labels = Leave.labelsFor(key);
      const fields = collectDialogFields();
      const hit = fields.find((field) => labels.some((label) => {
        const a = normalizeLabel(field.label);
        const b = normalizeLabel(label);
        return a === b || a.includes(b) || b.includes(a);
      }));
      if (hit) fills[hit.label] = slots[key];
    });
    return fillByLabelMap(fills);
  }

  function extractLeaveSlots(utterance) {
    const Leave = LeaveSkill;
    if (!Leave) return { ok: false, slots: {}, message: '请假 skill 未加载。' };
    const slots = Leave.extractSlots(utterance, new Date());
    return { ok: true, slots, message: '已解析请假字段。' };
  }

  async function submitWorkflow() {
    return { ok: false, message: '流程提交必须手动完成，我不会点击「提交」。' };
  }

  /**
   * 执行状态机一步对应的工具。openWorkflowFn 由 content 注入（复用现有打开逻辑）。
   */
  async function runTool(name, args, helpers) {
    const h = helpers || {};
    if (name === 'observe_page') return observePage();
    if (name === 'goto_workflow_list') return gotoWorkflowList();
    if (name === 'extract_leave_slots') return extractLeaveSlots(args && args.utterance);
    if (name === 'fill_leave_form') return fillLeaveForm(args && args.slots);
    if (name === 'ai_fill_form') return aiFillForm(args && args.utterance, h);
    if (name === 'check_required') return checkRequired();
    if (name === 'submit_workflow') {
      return submitWorkflow(args && args.confirmToken, h.confirmToken);
    }
    if (name === 'open_workflow') {
      if (typeof h.openWorkflowByUtterance !== 'function') {
        return { ok: false, message: '打开流程能力未注入。' };
      }
      // 短查询打开；反思重试可用 args.query 覆盖
      const preferLeave = Boolean(args && args.preferLeave)
        || /请假/.test(String(args && args.utterance || ''));
      const inferred = FormFill.inferWorkflowQuery(args && args.utterance);
      let openUtterance = String((args && args.query) || inferred || (args && args.utterance) || '');
      if (args && args.query) {
        openUtterance = /打开/.test(args.query) ? args.query : `打开${args.query}`;
      } else if (inferred) {
        openUtterance = `打开${inferred}`;
      } else if (preferLeave) {
        openUtterance = '打开请假';
      }
      let result = await h.openWorkflowByUtterance(openUtterance);

      // 本地没命中时，再用 DeepSeek 在流程候选里选（若已配置）
      if (result.status === 'none' && typeof h.aiOpenWorkflow === 'function') {
        const aiResult = await h.aiOpenWorkflow(args && args.utterance ? args.utterance : openUtterance);
        if (aiResult) result = aiResult;
      }

      return {
        ok: result.status === 'open',
        status: result.status,
        message: result.message,
        choices: result.choices || result.matches || [],
        matches: result.matches,
      };
    }
    return { ok: false, message: `未知工具：${name}` };
  }

  function applyToolSideEffects(task, toolName, result) {
    if ((toolName === 'fill_leave_form' || toolName === 'ai_fill_form') && result.filled) {
      task.filled = result.filled;
    }
    if (toolName === 'ai_fill_form') {
      task.slotsExtracted = true;
      task.formFilled = true;
    }
    if (toolName === 'check_required') {
      task.filled = result.filled || {};
      task.missing = result.missing || [];
      task.missingTitles = result.missingTitles || [];
      task.requiredReady = Boolean(result.ready);
    }
  }

  function localReflectFallback(toolName, result) {
    const message = String((result && result.message) || '');
    if (toolName === 'goto_workflow_list' || /加载异常|刷新列表|没有出来/.test(message)) {
      return {
        decision: 'retry',
        tool: 'goto_workflow_list',
        args: {},
        message: '列表异常，正在自动刷新重试。',
        reason: 'local-fallback',
      };
    }
    if (toolName === 'open_workflow') {
      return {
        decision: 'retry',
        tool: 'open_workflow',
        args: { query: '请假', preferLeave: true },
        message: '打开失败，改用更短关键词「请假」重试。',
        reason: 'local-fallback',
      };
    }
    return {
      decision: 'stop',
      tool: null,
      args: {},
      message: message || '执行失败。',
      reason: 'local-fallback',
    };
  }

  async function runAgentLoop(task, helpers) {
    const Agent = AgentApi;
    if (!Agent) throw new Error('Agent 未加载');
    const h = helpers || {};
    const log = [];
    const maxReflect = Agent.MAX_REFLECT || 2;

    for (let i = 0; i < Agent.MAX_STEPS; i += 1) {
      if (task.status !== 'running') break;
      const observed = observePage();
      const action = Agent.nextAction(task, {
        ...observed.observation,
        requiredReady: task.requiredReady,
        missing: task.missing,
      });
      if (action.type === 'stop') {
        log.push({ type: 'stop', status: action.status, message: action.message });
        break;
      }

      let result = await runTool(action.name, action.args, helpers);
      log.push({ type: 'tool', name: action.name, ok: result.ok, message: result.message });

      // 失败反思重试：不立刻 apply 失败结果，先问 DeepSeek（或本地兜底）
      if (Agent.isRecoverableFailure(action.name, result)
        && Number(task.reflectCount || 0) < maxReflect) {
        task.reflectCount = Number(task.reflectCount || 0) + 1;
        let plan;
        if (typeof h.aiReflect === 'function') {
          try {
            plan = await h.aiReflect({
              utterance: task.utterance,
              goal: task.goal,
              failedTool: action.name,
              error: result.message || '',
              status: result.status || null,
              observation: observed.observation,
            });
          } catch (error) {
            plan = localReflectFallback(action.name, result);
            plan.message = `${plan.message}（反思调用失败：${error.message || '错误'}）`;
          }
        } else {
          plan = localReflectFallback(action.name, result);
        }

        log.push({
          type: 'reflect',
          ok: true,
          message: `反思：${plan.decision}${plan.message ? ` — ${plan.message}` : ''}`,
        });

        if (plan.decision === 'retry' && plan.tool) {
          const retryArgs = { ...(action.args || {}), ...(plan.args || {}) };
          if (plan.args && plan.args.query) {
            retryArgs.utterance = plan.args.query;
            retryArgs.preferLeave = true;
          }
          const retryResult = await runTool(plan.tool, retryArgs, helpers);
          log.push({
            type: 'tool',
            name: plan.tool,
            ok: retryResult.ok,
            message: `重试：${retryResult.message || ''}`,
          });
          Agent.applyResult(task, plan.tool, retryResult);
          applyToolSideEffects(task, plan.tool, retryResult);
          continue;
        }

        if (plan.decision === 'ask_user') {
          task.status = 'ask';
          task.lastMessage = plan.message || result.message || '需要你补充信息后再试。';
          log.push({ type: 'stop', status: 'ask', message: task.lastMessage });
          break;
        }
        // stop：落下原失败结果
      }

      Agent.applyResult(task, action.name, result);
      applyToolSideEffects(task, action.name, result);
    }
    return { task, log };
  }

export {
  observePage,
  gotoWorkflowList,
  collectDialogFields,
  fillByLabelMap,
  fillLeaveForm,
  aiFillForm,
  checkRequired,
  extractLeaveSlots,
  submitWorkflow,
  runTool,
  runAgentLoop,
};
