// @ts-nocheck
import { LIST_HASH } from '@/shared/types';
import * as Match from '@/shared/match';
import {
  delay,
  waitFor,
  tableLoadFailed,
  clickWorkflowListRefresh,
} from '@/shared/dom';

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

export function readRowsFromTable() {
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

export function clickNewWorkflow(row) {
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
export async function openByCodeHash(code) {
  location.hash = `${LIST_HASH}?_reopen=${Date.now()}`;
  await delay(120);
  location.hash = LIST_HASH;
  await delay(120);
  location.hash = Match.openHash(code);
}

export async function loadRowsFromTable() {
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
      const ok = clickWorkflowListRefresh();
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

export function pageErrorText() {
  return [...document.querySelectorAll('.el-message')]
    .map((item) => item.innerText.trim())
    .find((text) => text.includes('未找到可发起的流程定义') || text.includes('打开流程失败')) || '';
}
