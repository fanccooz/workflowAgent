// @ts-nocheck
import * as TaskPlan from '@/shared/taskplan';
import {
  delay,
  isInSidebar,
  isVisibleEl,
  controlText,
  setNativeValue,
} from '@/shared/dom';
import { closeWorkflowDialogs } from '@/shared/dialog-dismiss';
import { openCandidate } from './navigation';
import { waitForListPageReady } from './list-filter';

export function clickDecisionButton(label) {
  const buttons = [...document.querySelectorAll('button, .el-button, a')].filter((el) => isVisibleEl(el));
  const hit = buttons.find((el) => {
    const text = controlText(el);
    if (/提交/.test(text)) return false;
    return text === label;
  });
  if (!hit) return false;
  hit.click();
  return true;
}

export function readVisibleGridRows() {
  return [...document.querySelectorAll('.ag-center-cols-container .ag-row')].map((row) => ({
    rowIndex: row.getAttribute('row-index'),
    text: String(row.innerText || '').replace(/\s+/g, ' ').trim(),
    el: row,
  })).filter((row) => row.text && row.text !== '加载异常');
}

/** 打开我的待办，找到一条，再点同意或驳回；回读列表确认离开待办。不点提交。 */
export async function approveTodo(query, analysis) {
  const parsed = TaskPlan.parseApprovalQuery(query);
  const opened = await openCandidate({ type: 'todo', id: 'todo:entry', title: '我的待办' });
  if (!opened || opened.status !== 'open') {
    return opened || { status: 'error', message: '没有打开我的待办。', choices: [] };
  }
  await waitForListPageReady(10000);
  await delay(400);
  const rows = readVisibleGridRows();
  const hit = parsed.keyword
    ? rows.find((row) => row.text.replace(/\s+/g, '').includes(parsed.keyword))
    : rows[0];
  if (!hit) {
    return {
      status: 'error',
      message: parsed.keyword ? `待办里没有找到「${parsed.keyword}」。` : '待办列表是空的。',
      choices: [],
    };
  }
  const beforeText = hit.text;
  const right = hit.rowIndex == null
    ? null
    : document.querySelector(`.ag-pinned-right-cols-container .ag-row[row-index="${hit.rowIndex}"]`);
  const operate = right
    ? [...right.querySelectorAll('button, a, span')].find((el) => /办理|审批|处理|查看/.test(controlText(el)))
    : null;
  if (operate) operate.click();
  else hit.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await delay(700);
  const form = analysis && analysis.form;
  const opinion = form && (form['审批意见'] || form['意见'] || form['备注']);
  if (opinion) {
    const area = [...document.querySelectorAll('textarea')].find((el) => isVisibleEl(el));
    if (area) setNativeValue(area, String(opinion));
  }
  const clicked = clickDecisionButton(parsed.decision);
  if (!clicked) {
    return {
      status: 'error',
      message: `已打开待办「${hit.text.slice(0, 40)}」，但没有点到「${parsed.decision}」。`,
      choices: [],
    };
  }
  await delay(500);
  // 关掉办理弹窗，回到列表再看这条还在不在
  await closeWorkflowDialogs();
  await delay(400);
  const refresh = [...document.querySelectorAll('button, .el-button, a, span')].find((el) => {
    if (!isVisibleEl(el) || isInSidebar(el)) return false;
    const text = controlText(el);
    return text === '查询' || text === '刷新' || text === '刷新列表';
  });
  if (refresh) {
    refresh.click();
    await delay(600);
  }
  await waitForListPageReady(8000);
  const afterRows = readVisibleGridRows().map((row) => row.text);
  const settled = TaskPlan.approvalSettled(beforeText, afterRows, parsed.keyword, parsed.decision);
  if (!settled) {
    return {
      status: 'error',
      message: `已点击「${parsed.decision}」，但待办列表里「${hit.text.slice(0, 40)}」仍在，未确认办完。`,
      choices: [],
      approved: false,
    };
  }
  return {
    status: 'open',
    message: `已在待办中对「${hit.text.slice(0, 40)}」完成「${parsed.decision}」，列表已离开待办。未点击提交。`,
    choices: [],
    approved: true,
  };
}
