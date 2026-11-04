const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectScope,
  filterByScope,
  groupCandidates,
  sanitizeDecision,
  sanitizeChatAction,
  sanitizeFillMap,
  sanitizeReflect,
} = require('../extension/intent');

test('打开请假流程归为 workflow', () => {
  assert.equal(detectScope('打开请假流程'), 'workflow');
});

test('打开待办归为 todo', () => {
  assert.equal(detectScope('打开我的待办'), 'todo');
});

test('进入人事模块归为 menu', () => {
  assert.equal(detectScope('进入人事模块'), 'menu');
});

test('自定义菜单关键字生效', () => {
  assert.equal(detectScope('导航到人事', { menuKeywords: '导航到' }), 'menu');
});

test('打开菜单 流程定义仍归为 menu', () => {
  assert.equal(detectScope('打开菜单流程定义'), 'menu');
});

test('含糊说法归为 all', () => {
  assert.equal(detectScope('我想请假'), 'all');
});

test('workflow 范围过滤掉菜单', () => {
  const list = filterByScope([
    { type: 'workflow', id: '1', title: '请假申请' },
    { type: 'menu', id: '2', title: '请假调班' },
  ], 'workflow');
  assert.deepEqual(list.map((item) => item.id), ['1']);
});

test('分组不混排', () => {
  const groups = groupCandidates([
    { type: 'menu', id: 'm', title: '流程管理' },
    { type: 'workflow', id: 'w', title: '请假申请' },
  ]);
  assert.equal(groups.workflow[0].id, 'w');
  assert.equal(groups.menu[0].id, 'm');
});

test('open 到菜单但 scope 是 workflow 时改成只列流程', () => {
  const result = sanitizeDecision(
    { decision: 'open', type: 'menu', id: 'm' },
    [
      { type: 'workflow', id: 'w', title: '请假申请' },
      { type: 'menu', id: 'm', title: '请假调班' },
    ],
    'workflow',
  );
  assert.equal(result.decision, 'choose');
  assert.deepEqual(result.candidates.map((item) => item.type), ['workflow']);
});

test('对话动作清洗：请假填表', () => {
  const chat = sanitizeChatAction({
    reply: '好的，帮你开请假',
    action: { type: 'leave.open_fill', query: '打开请假' },
  });
  assert.equal(chat.reply, '好的，帮你开请假');
  assert.equal(chat.action.type, 'leave.open_fill');
  assert.equal(chat.action.query, '打开请假');
  assert.equal(chat.actions.length, 1);
});

test('对话动作清洗：未知 type 变 none', () => {
  const chat = sanitizeChatAction({ reply: '嗯', action: { type: 'hack' } });
  assert.equal(chat.action.type, 'none');
});

test('对话动作清洗：多步 actions 保持顺序', () => {
  const chat = sanitizeChatAction({
    reply: '先开待办再筛选',
    actions: [
      { type: 'open_todo', query: '我的待办' },
      { type: 'filter_list', query: '通用流程' },
    ],
  });
  assert.deepEqual(chat.actions.map((item) => item.type), ['open_todo', 'filter_list']);
  assert.equal(chat.actions[1].query, '通用流程');
});

test('对话动作清洗：只返回待办时按原话补筛选步', () => {
  const chat = sanitizeChatAction(
    {
      reply: '好的',
      action: { type: 'open_todo', query: '我的待办' },
    },
    '我的待办页面筛选通用流程的数据',
  );
  assert.deepEqual(chat.actions.map((item) => [item.type, item.query]), [
    ['open_todo', '我的待办'],
    ['filter_list', '通用流程'],
  ]);
});

test('填表映射只保留页面上的字段 label', () => {
  const result = sanitizeFillMap(
    {
      fills: {
        开始日期: '2026-10-31',
        结束日期: '2026-11-01',
        事由: '开会',
        不存在的字段: 'x',
      },
    },
    ['开始日期', '结束日期', '事由', '请假类型'],
  );
  assert.equal(result.fills['开始日期'], '2026-10-31');
  assert.equal(result.fills['事由'], '开会');
  assert.equal(result.fills['不存在的字段'], undefined);
});

test('填表映射允许 label 轻微包含匹配', () => {
  const result = sanitizeFillMap(
    { fills: { 开始: '2026-10-31' } },
    ['开始日期', '结束日期'],
  );
  assert.equal(result.fills['开始日期'], '2026-10-31');
});

test('反思结果清洗：retry 必须带合法 tool', () => {
  const ok = sanitizeReflect({
    decision: 'retry',
    tool: 'goto_workflow_list',
    message: '刷新列表',
  });
  assert.equal(ok.decision, 'retry');
  assert.equal(ok.tool, 'goto_workflow_list');

  const bad = sanitizeReflect({ decision: 'retry', tool: 'hack' });
  assert.equal(bad.decision, 'ask_user');
  assert.equal(bad.tool, null);
});

test('反思结果清洗：ask_user', () => {
  const plan = sanitizeReflect({
    decision: 'ask_user',
    message: '请手选日期',
  });
  assert.equal(plan.decision, 'ask_user');
});
