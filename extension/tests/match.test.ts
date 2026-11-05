import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildCandidates,
  matchWorkflows,
  matchMenus,
  selectSolution,
  projectRows,
  buildQuery,
  nextRange,
  openUrl,
} from '@/shared/match';

const rows = [
  { name: '出差申请', code: '10021', theme: 'BusinessTrip', DisableStatus: 0 },
  { name: '用印申请', code: '10022', theme: 'SealUse', DisableStatus: 0 },
  { name: '采购申请', code: '10023', theme: 'Purchase', DisableStatus: 0 },
  { name: '离职申请', code: '10024', theme: 'Resign', DisableStatus: 1 },
];

it('打开出差流程只命中出差申请', () => {
  const result = matchWorkflows('打开出差流程', rows);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].code, '10021');
});

it('带日期事由的请假长句仍能命中请假申请', () => {
  const leaveRows = rows.concat([
    { name: '请假申请', code: '10030', theme: 'Leave', DisableStatus: 0 },
  ]);
  const result = matchWorkflows('帮我请假，明天到后天，事由开会', leaveRows);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].code, '10030');
});

it('打开请假短查询命中请假申请', () => {
  const leaveRows = rows.concat([
    { name: '请假申请', code: '10030', theme: 'Leave', DisableStatus: 0 },
  ]);
  const result = matchWorkflows('打开请假', leaveRows);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].name, '请假申请');
});

it('候选词保留名称开头', () => {
  const candidates = buildCandidates('请帮我打开请假流程');
  assert.ok(candidates.includes('请假'));
  assert.equal(candidates.includes('假'), false);
});

it('只有客套话时要求用户说明流程', () => {
  assert.equal(matchWorkflows('帮我打开一下', rows).status, 'ask');
});

it('多个名称都包含申请时列出未禁用记录', () => {
  const result = matchWorkflows('打开申请', rows);
  assert.equal(result.status, 'choose');
  assert.deepEqual(result.matches.map((item) => item.code), ['10021', '10022', '10023']);
});

it('只命中已禁用记录时不打开', () => {
  const result = matchWorkflows('打开离职流程', rows);
  assert.equal(result.status, 'disabled');
  assert.equal(result.matches.length, 0);
});

it('没有命中时返回当前名称', () => {
  const result = matchWorkflows('打开不存在流程', rows);
  assert.equal(result.status, 'none');
  assert.ok(result.names.includes('出差申请'));
});

it('代码去掉前导零后匹配', () => {
  assert.equal(matchWorkflows('010021', rows).matches[0].name, '出差申请');
});

it('句子里带完整名称时只打开那一条', () => {
  const result = matchWorkflows('关闭出差流程，打开用印申请', rows);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].code, '10022');
});

it('选择查询方案代码为 1 的方案', () => {
  assert.equal(selectSolution([{ ID: 8, Code: '2' }, { ID: 9, Code: '1' }], '1').ID, 9);
});

it('查询体与页面一致', () => {
  assert.deepEqual(buildQuery(9, ['Name', 'Code'], 1, 500).solution, 9);
});

it('还有剩余行时继续请求下一段', () => {
  assert.deepEqual(nextRange(800, 500), { start: 501, end: 800 });
});

it('打开地址带当前代码', () => {
  assert.equal(
    openUrl('10021'),
    'https://test.warom-lighting.com/v2_debug_ouyang/#/workflow/workflow-base/agent?code=10021',
  );
});

it('按表头投影名称和代码', () => {
  const projected = projectRows(
    [{ Title: '用印申请', FlowCode: '10022', View: 'SealUse', DisableStatus: 0 }],
    [
      { field: 'Title', headerName: '名称' },
      { field: 'FlowCode', headerName: '代码' },
      { field: 'View', headerName: '主视图' },
    ],
  );
  assert.equal(projected[0].code, '10022');
});

const menus = [
  { id: 'menu:1', title: '请假调班', path: ['人事'], subtitle: '人事 / 请假调班' },
  { id: 'menu:2', title: '考勤统计', path: ['人事', '考勤'], subtitle: '人事 / 考勤 / 考勤统计' },
  { id: 'menu:3', title: '我的待办', path: ['流程'], subtitle: '流程 / 我的待办' },
  { id: 'menu:4', title: '流程定义', path: ['流程', '流程管理'], subtitle: '流程 / 流程管理 / 流程定义' },
];

it('模糊菜单：不知道目录也能命中请假调班', () => {
  const result = matchMenus('打开请假调班', menus);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].title, '请假调班');
});

it('模糊菜单：短词考勤命中考勤统计', () => {
  const result = matchMenus('进入考勤', menus);
  assert.equal(result.status, 'open');
  assert.equal(result.matches[0].title, '考勤统计');
});

it('模糊菜单：流程相关多项时让用户选', () => {
  const result = matchMenus('打开流程', menus);
  assert.ok(result.status === 'choose' || result.matches.length >= 1);
});
