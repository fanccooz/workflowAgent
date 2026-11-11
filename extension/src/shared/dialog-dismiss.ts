// @ts-nocheck
/**
 * 关挡路表单：点取消/关闭 → 确认关闭弹窗 → 再导航。
 * 绝不点「提交」。回填中默认不关（leaveCurrentForm 除外）。
 */
import * as FillLock from './fill-lock';
import {
  delay,
  visibleDialogs,
  isWorkflowLaunchDialog,
  isBlockingFormDialog,
  isVisibleOverlay,
  controlText,
  clickDom,
} from './dom';

let closeUsedThisTurn = false;

export function resetCloseOnce() {
  closeUsedThisTurn = false;
}

export function listBlockingDialogs() {
  return visibleDialogs().filter(isBlockingFormDialog);
}

function dialogLooksLikeTarget(dialog, name) {
  const text = String((dialog && dialog.innerText) || '').replace(/\s+/g, '');
  const want = String(name || '').replace(/\s+/g, '');
  if (!text || !want) return false;
  const core = want.replace(/(流程|申请)$/g, '');
  return text.includes(want) || (core.length >= 2 && text.includes(core));
}

/** 平台「确认关闭 / 是否放弃」二次确认（message-box 或小对话框） */
export function listConfirmClosePrompts() {
  const boxes = [...document.querySelectorAll(
    '.el-message-box__wrapper, .el-overlay-message-box, .el-message-box, .el-overlay.is-message-box',
  )].filter((item) => {
    const box = item.classList && item.classList.contains('el-message-box')
      ? item
      : (item.querySelector && item.querySelector('.el-message-box')) || item;
    return isVisibleOverlay(item) && isVisibleOverlay(box);
  });

  const confirmDialogs = visibleDialogs().filter((dialog) => {
    if (isWorkflowLaunchDialog(dialog)) return false;
    if (dialog.closest('#warom-agent-host, #wf-agent-host, .wf-root, .wf-panel')) return false;
    const text = String(dialog.innerText || '').replace(/\s+/g, '');
    if (/基础信息/.test(text) && /提交/.test(text)) return false;
    const looksConfirm = /是否关闭|确认关闭|未保存|是否放弃|放弃编辑|离开当前|是否离开|关闭当前|数据尚未|内容尚未|是否继续/.test(text);
    const buttons = [...dialog.querySelectorAll('button, .el-button')];
    const hasOk = buttons.some((b) => /^(确定|确认|是|关闭|不保存|放弃)$/.test(controlText(b)));
    const hasCancel = buttons.some((b) => /^(取消|否)$/.test(controlText(b)));
    return looksConfirm || (hasOk && hasCancel && buttons.length <= 4 && !/提交/.test(text));
  });

  return [...boxes, ...confirmDialogs];
}

/** 点确认关闭：优先「不保存/放弃」，否则「确定/确认」。 */
export async function confirmClosePromptIfAny() {
  const prompts = listConfirmClosePrompts();
  if (!prompts.length) return false;
  const prompt = prompts[prompts.length - 1];
  const root = (prompt.classList && prompt.classList.contains('el-message-box'))
    ? prompt
    : (prompt.querySelector && prompt.querySelector('.el-message-box')) || prompt;
  const boxButtons = [...root.querySelectorAll('button, .el-button')].filter((item) => {
    const text = controlText(item);
    return text && !/提交/.test(text);
  });
  const discard = boxButtons.find((item) => /不保存|放弃|不提交|离开|丢弃/.test(controlText(item)));
  const confirmClose = boxButtons.find((item) => /^(确定|确认|是|关闭|OK|Yes)$/i.test(controlText(item)));
  const primary = boxButtons.find((item) => item.classList && item.classList.contains('el-button--primary')
    && !/取消|否|提交/.test(controlText(item)));
  const pick = discard || confirmClose || primary;
  if (!pick) return false;
  clickDom(pick);
  await delay(320);
  return true;
}

function findCancelOrCloseButton(dialog) {
  const footer = dialog.querySelector('.el-dialog__footer, .dialog-footer, .el-drawer__footer');
  const scope = footer || dialog;
  const buttons = [...scope.querySelectorAll('button, .el-button, a')];
  const cancel = buttons.find((button) => /^(取消|关闭)$/.test(controlText(button)))
    || buttons.find((button) => {
      const text = controlText(button);
      return /取消|关闭/.test(text) && !/提交|确定提交|确认提交/.test(text);
    });
  const closeButton = dialog.querySelector('.el-dialog__headerbtn, .el-dialog__close, button.el-dialog__headerbtn');
  return cancel || closeButton || null;
}

/**
 * @param {{ force?: boolean, leaveCurrentForm?: boolean, keepMatch?: string, trackOnce?: boolean }} [options]
 * - leaveCurrentForm：离开当前表（进菜单/首页）时允许在回填中关窗
 * - keepMatch：保留已是目标流程的弹窗
 * - trackOnce：默认 true，同轮只关一次（除非 force）
 */
export async function closeWorkflowDialogs(options) {
  const opts = options || {};
  const force = Boolean(opts.force);
  const leaveCurrentForm = Boolean(opts.leaveCurrentForm);
  const keepMatch = opts.keepMatch ? String(opts.keepMatch) : '';
  const trackOnce = opts.trackOnce !== false;

  if (FillLock.isFormFillActive() && !leaveCurrentForm) return false;
  if (trackOnce) {
    if (!force && closeUsedThisTurn) return false;
    closeUsedThisTurn = true;
  }

  const remaining = () => listBlockingDialogs().filter((dialog) => {
    if (keepMatch && dialogLooksLikeTarget(dialog, keepMatch)) return false;
    return true;
  });

  for (let round = 0; round < 5; round += 1) {
    await confirmClosePromptIfAny();
    if (!remaining().length) return true;

    const dialogs = remaining();
    const dialog = dialogs[dialogs.length - 1];
    const button = findCancelOrCloseButton(dialog);
    if (!button) {
      if (!(await confirmClosePromptIfAny())) break;
      continue;
    }
    clickDom(button);

    let confirmed = false;
    for (let wait = 0; wait < 8; wait += 1) {
      await delay(180);
      if (await confirmClosePromptIfAny()) {
        confirmed = true;
        break;
      }
      if (!remaining().length) return true;
    }
    if (!confirmed) await delay(200);
  }

  await confirmClosePromptIfAny();
  await delay(200);
  return remaining().length === 0;
}

/** 导航前关窗：关表单 → 确认关闭 → 再进其他页。 */
export async function ensureDialogsClosedForNavigation() {
  if (!listBlockingDialogs().length && !listConfirmClosePrompts().length) return true;
  let closed = await closeWorkflowDialogs({ force: true, leaveCurrentForm: true });
  if (!closed) {
    await delay(350);
    closeUsedThisTurn = false;
    closed = await closeWorkflowDialogs({ force: true, leaveCurrentForm: true });
  }
  if (!closed) {
    await delay(350);
    closeUsedThisTurn = false;
    closed = await closeWorkflowDialogs({ force: true, leaveCurrentForm: true });
  }
  return closed;
}

/** Agent 进流程列表前清挡路弹窗（回填中不关，不占用 once 标记）。 */
export async function dismissBlockingDialogs() {
  if (FillLock.isFormFillActive()) return false;
  return closeWorkflowDialogs({ force: true, leaveCurrentForm: false, trackOnce: false });
}
