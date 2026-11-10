import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  detectScope,
  filterByScope,
  groupCandidates,
  sanitizeDecision,
  sanitizeChatAction,
  sanitizeFillMap,
  sanitizeReflect,
} from '@/shared/intent';

it('打开请假流程归为 workflow', () => {
  assert.equal(detectScope('打开请假流程'), 'workflow');
});

it('打开待办归为 todo', () => {
  assert.equal(detectScope('打开我的待办'), 'todo');
});

it('进入人事模块归为 menu', () => {
  assert.equal(detectScope('进入人事模块'), 'menu');
});

it('自定义菜单关键字生效', () => {
  assert.equal(detectScope('导航到人事', { menuKeywords: '导航到' }), 'menu');
});

it('打开菜单 流程定义仍归为 menu', () => {
  assert.equal(detectScope('打开菜单流程定义'), 'menu');
});

it('含糊说法归为 all', () => {
  assert.equal(detectScope('我想请假'), 'all');
});

it('workflow 范围过滤掉菜单', () => {
  const list = filterByScope([
    { type: 'workflow', id: '1', title: '请假申请' },
    { type: 'menu', id: '2', title: '请假调班' },
  ], 'workflow');
  assert.deepEqual(list.map((item) => item.id), ['1']);
});

it('分组不混排', () => {
  const groups = groupCandidates([
    { type: 'menu', id: 'm', title: '流程管理' },
    { type: 'workflow', id: 'w', title: '请假申请' },
  ]);
  assert.equal(groups.workflow[0].id, 'w');
  assert.equal(groups.menu[0].id, 'm');
});

it('open 到菜单但 scope 是 workflow 时改成只列流程', () => {
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

it('对话动作清洗：请假填表', () => {
  const chat = sanitizeChatAction({
    reply: '好的，帮你开请假',
    action: { type: 'leave.open_fill', query: '打开请假' },
  });
  assert.equal(chat.reply, '好的，帮你开请假');
  assert.equal(chat.action.type, 'leave.open_fill');
  assert.equal(chat.action.query, '打开请假');
  assert.equal(chat.actions.length, 1);
});

it('对话动作清洗：未知 type 变 none', () => {
  const chat = sanitizeChatAction({ reply: '嗯', action: { type: 'hack' } });
  assert.equal(chat.action.type, 'none');
});

it('对话动作清洗：多步 actions 保持顺序', () => {
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

it('对话动作清洗：原样保留模型给出的动作与自设 summary', () => {
  const chat = sanitizeChatAction({
    summary: { listCount: 12, page: '我的待办' },
    reply: '当前页面共 12 条。',
    actions: [{ type: 'none', query: '' }],
  });
  assert.equal(chat.reply, '当前页面共 12 条。');
  assert.equal(chat.action.type, 'none');
  assert.deepEqual(chat.summary, { listCount: 12, page: '我的待办' });
});

it('对话动作清洗：模型给的打开/搜索动作原样保留', () => {
  const open = sanitizeChatAction({
    reply: '好的',
    actions: [{ type: 'open_menu', query: '流程定义' }],
  }, '打开流程定义');
  assert.deepEqual(open.actions.map((item) => item.type), ['open_menu']);

  const search = sanitizeChatAction({
    reply: '好的',
    actions: [{ type: 'filter_list', query: '吃' }],
  }, '搜索吃');
  assert.deepEqual(search.actions.map((item) => [item.type, item.query]), [
    ['filter_list', '吃'],
  ]);
});

it('打开通用流程不能被改成筛选', () => {
  const chat = sanitizeChatAction(
    {
      reply: '我帮你在本页筛出通用流程。',
      actions: [{ type: 'filter_list', query: '通用流程' }],
    },
    '你好，我想打开通用流程',
  );
  assert.equal(chat.action.type, 'open_workflow');
  assert.match(chat.action.query, /通用流程/);
  assert.equal(chat.actions.some((item) => item.type === 'filter_list'), false);
});

it('打开请假流程时不能执行成通用流程', () => {
  const chat = sanitizeChatAction(
    {
      reply: '当前在我的已办，我帮你打开新建流程入口，再选请假申请。',
      actions: [{ type: 'open_workflow', query: '通用流程' }],
    },
    '打开请假流程',
  );
  assert.equal(chat.action.type, 'open_workflow');
  assert.match(chat.action.query, /请假/);
  assert.equal(/通用/.test(chat.action.query), false);
});

it('打开请假被写成新建流程入口时纠正为请假', () => {
  const chat = sanitizeChatAction(
    {
      reply: '好的',
      actions: [{ type: 'open_menu', query: '新建流程' }],
    },
    '打开请假流程',
  );
  assert.equal(chat.action.type, 'open_workflow');
  assert.match(chat.action.query, /请假/);
});

it('帮我点查看草稿应产出 click_ui', () => {
  const chat = sanitizeChatAction(
    {
      reply: '已帮你点开查看草稿',
      actions: [{ type: 'none', query: '' }],
    },
    '帮我点查看草稿',
  );
  assert.equal(chat.action.type, 'click_ui');
  assert.equal(chat.action.query, '查看草稿');
});

it('不能把提交变成点击', () => {
  const chat = sanitizeChatAction(
    {
      reply: '已帮你提交。',
      actions: [{ type: 'click_ui', query: '提交' }],
    },
    '帮我提交',
  );
  assert.equal(chat.actions.some((item) => item.type === 'click_ui' && /提交/.test(item.query || '')), false);
  assert.match(chat.reply, /手动/);
});

it('没有动作时不能假装已点开', () => {
  const chat = sanitizeChatAction(
    {
      reply: '草稿填好后可以直接提交。',
      actions: [{ type: 'none', query: '' }],
    },
    '草稿怎么提交',
  );
  assert.equal(chat.action.type, 'none');
});

it('模型只口头说要点击时，从 reply 补 click_ui', () => {
  const chat = sanitizeChatAction(
    {
      reply: '已帮你点开「查看草稿」。',
      summary: { nextClicks: ['查看草稿'] },
      actions: [{ type: 'none', query: '' }],
    },
    '下一步呢',
  );
  assert.equal(chat.action.type, 'click_ui');
  assert.equal(chat.action.query, '查看草稿');
});

it('最小化流程助手', () => {
  const chat = sanitizeChatAction(
    { reply: '好的', actions: [{ type: 'none', query: '' }] },
    '最小化流程助手',
  );
  assert.equal(chat.action.type, 'panel_minimize');
});

it('填表映射只保留页面上的字段 label', () => {
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

it('填表映射允许 label 轻微包含匹配', () => {
  const result = sanitizeFillMap(
    { fills: { 开始: '2026-10-31' } },
    ['开始日期', '结束日期'],
  );
  assert.equal(result.fills['开始日期'], '2026-10-31');
});

it('反思结果清洗：retry 必须带合法 tool', () => {
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

it('反思结果清洗：ask_user', () => {
  const plan = sanitizeReflect({
    decision: 'ask_user',
    message: '请手选日期',
  });
  assert.equal(plan.decision, 'ask_user');
});
