const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTask,
  nextAction,
  applyResult,
  acceptConfirm,
  isRecoverableFailure,
} = require('../extension/agent');

test('未登录则停止', () => {
  const task = createTask('请假明天');
  const action = nextAction(task, { login: true });
  assert.equal(action.type, 'stop');
  assert.equal(action.status, 'login');
});

test('不在列表则 goto', () => {
  const task = createTask('请假明天');
  const action = nextAction(task, {
    login: false,
    onWorkflowList: false,
  });
  assert.equal(action.type, 'tool');
  assert.equal(action.name, 'goto_workflow_list');
});

test('在列表无弹窗则 open_workflow', () => {
  const task = createTask('打开请假');
  const action = nextAction(task, {
    login: false,
    onWorkflowList: true,
    hasRows: true,
    launchDialogOpen: false,
  });
  assert.equal(action.name, 'open_workflow');
});

test('弹窗已开则 ai_fill_form', () => {
  const task = createTask('请假明天到后天开会');
  const action = nextAction(task, {
    login: false,
    onWorkflowList: true,
    hasRows: true,
    launchDialogOpen: true,
  });
  assert.equal(action.name, 'ai_fill_form');
});

test('填表后 check，再 await_confirm', () => {
  const task = createTask('请假');
  applyResult(task, 'ai_fill_form', {
    ok: true,
    filled: { 事由: '开会' },
    skipped: ['开始日期'],
  });
  let action = nextAction(task, {
    login: false,
    onWorkflowList: true,
    launchDialogOpen: true,
  });
  assert.equal(action.name, 'check_required');

  applyResult(task, 'check_required', {
    ok: true,
    ready: false,
    missing: ['开始日期'],
    missingTitles: ['开始日期'],
  });
  action = nextAction(task, {
    login: false,
    onWorkflowList: true,
    launchDialogOpen: true,
  });
  assert.equal(action.type, 'stop');
  assert.equal(action.status, 'await_confirm');
});

test('确认后带 token 才 submit', () => {
  const task = createTask('请假');
  task.slotsExtracted = true;
  task.formFilled = true;
  task.requiredChecked = true;
  task.status = 'await_confirm';
  const accepted = acceptConfirm(task, 'tok-1');
  assert.equal(accepted.ok, true);
  const action = nextAction(task, {
    login: false,
    onWorkflowList: true,
    launchDialogOpen: true,
    requiredReady: true,
  });
  assert.equal(action.name, 'submit_workflow');
  assert.equal(action.args.confirmToken, 'tok-1');
});

test('open 多选则 choose 停止', () => {
  const task = createTask('请假');
  applyResult(task, 'open_workflow', {
    ok: false,
    status: 'choose',
    choices: [{ title: '请假申请' }, { title: '请假调班' }],
  });
  assert.equal(task.status, 'choose');
  assert.equal(task.choices.length, 2);
});

test('可恢复失败判定', () => {
  assert.equal(isRecoverableFailure('goto_workflow_list', { ok: false }), true);
  assert.equal(isRecoverableFailure('open_workflow', { status: 'open', ok: true }), false);
  assert.equal(isRecoverableFailure('open_workflow', { status: 'choose' }), false);
  assert.equal(isRecoverableFailure('open_workflow', { status: 'none', ok: false }), true);
  assert.equal(isRecoverableFailure('ai_fill_form', { ok: false }), true);
});
