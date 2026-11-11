// @ts-nocheck
/** 页面 DOM 通用工具（content / tools 共用） */

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitFor(predicate, timeout) {
  const limit = timeout == null ? 10000 : timeout;
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
      } else if (Date.now() - start > limit) {
        clearInterval(timer);
        reject(new Error('等待页面超时'));
      }
    }, 200);
  });
}

export function visibleDialogs() {
  return [...document.querySelectorAll('.el-dialog')].filter((dialog) => {
    const wrap = dialog.closest('.el-dialog__wrapper');
    return wrap && getComputedStyle(wrap).display !== 'none';
  });
}

export function isWorkflowLaunchDialog(dialog) {
  const text = (dialog && dialog.innerText) || '';
  return /基础信息/.test(text) && (/提\s*交/.test(text) || /取\s*消/.test(text) || /提交|取消/.test(text));
}

export function isInSidebar(el) {
  return Boolean(
    el
    && el.closest
    && el.closest('.el-aside, .sidebar, .el-menu, .layout-sider, .left-menu, #warom-agent-host, #wf-agent-host'),
  );
}

export function isVisibleEl(el) {
  if (!el || el.disabled) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

export function findVueInstance(el) {
  let node = el;
  for (let i = 0; i < 12 && node; i += 1) {
    if (node.__vue__) return node.__vue__;
    // Vue 3：组件实例挂在 __vueParentComponent.proxy / ctx
    const parent = node.__vueParentComponent;
    if (parent) {
      if (parent.proxy) return parent.proxy;
      if (parent.ctx) return parent.ctx;
    }
    node = node.parentElement;
  }
  return null;
}

export function setNativeValue(el, value) {
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

export function readInputValue(el) {
  if (!el) return '';
  const wrap = el.closest('.el-select, .el-cascader, .el-date-editor, .el-input, .el-textarea') || el;
  const tags = [...wrap.querySelectorAll('.el-select__tags-text, .el-tag__content, .el-select__selected-item')]
    .map((node) => String(node.textContent || '').trim())
    .filter(Boolean);
  if (tags.length) return tags.join(',');
  const shown = wrap.querySelector('.el-input__inner, input, textarea') || el;
  const fromInput = String(shown.value || shown.getAttribute('value') || '').trim();
  if (fromInput) return fromInput;
  const placeholderish = wrap.querySelector('.el-select__placeholder, .el-range-input');
  if (placeholderish && placeholderish.classList && placeholderish.classList.contains('el-select__placeholder')) {
    return '';
  }
  return String(wrap.innerText || '').replace(/\s+/g, ' ').trim();
}

export function valueLooksSet(actual, expected) {
  if (!actual || !expected) return false;
  const a = String(actual).replace(/\s+/g, '');
  const b = String(expected).replace(/\s+/g, '');
  return a === b || a.includes(b) || b.includes(a);
}

export function tableLoadFailed() {
  const text = (document.body && document.body.innerText) || '';
  return text.includes('加载异常');
}
