import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  approvalSettled,
  classifyTaskHorizon,
  cleanPlanSteps,
  isHardStop,
  parseApprovalQuery,
  queueAfterFailure,
  reminderMatched,
  shouldResumeNow,
  shouldRetrySameStep,
} from '@/shared/taskplan';

it('入库步骤丢掉空动作和提交点击', () => {
  const steps = cleanPlanSteps([
    { type: 'open_workflow', query: '请假', seq: 1 },
    { type: 'none', query: '' },
    { type: 'click_ui', query: '提交' },
    { type: 'form.open_fill', query: '内部留言' },
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'open_workflow');
  assert.equal(steps[1].type, 'form.open_fill');
});

it('失败后换成剩余步骤，超过重规划上限才停', () => {
  const first = queueAfterFailure(
    [{ type: 'open_workflow', query: '请假' }, { type: 'click_ui', query: '提交' }],
    0,
  );
  assert.equal(first.replanned, true);
  assert.equal(first.stop, false);
  assert.equal(first.queue.length, 1);
  assert.equal(first.queue[0].query, '请假');

  const again = queueAfterFailure([{ type: 'approve_todo', query: '同意请假' }], 3);
  assert.equal(again.stop, false);
  const stopped = queueAfterFailure([{ type: 'open_menu', query: '人事' }], 4);
  assert.equal(stopped.stop, true);
  assert.equal(stopped.queue.length, 0);
});

it('手动提交和登录不再重试，普通失败会重做当前步', () => {
  assert.equal(isHardStop({ status: 'error', message: '请在表单里手动点击「提交」，我不会代为提交。' }), true);
  assert.equal(isHardStop({ status: 'login', message: '请登录' }), true);
  assert.equal(shouldRetrySameStep({ status: 'error', message: '没有找到菜单' }, 0), true);
  assert.equal(shouldRetrySameStep({ status: 'error', message: '没有找到菜单' }, 2), false);
});

it('审批话术拆成同意或驳回和关键字', () => {
  const agree = parseApprovalQuery('待办里把请假同意掉');
  assert.equal(agree.decision, '同意');
  assert.match(agree.keyword, /请假/);
  const reject = parseApprovalQuery('驳回张三的加班');
  assert.equal(reject.decision, '驳回');
  assert.match(reject.keyword, /张三/);
});

it('事后提醒算长期任务，每天查看隔 12 小时再做', () => {
  const once = classifyTaskHorizon('请假批下来之后告诉我');
  assert.equal(once.durable, true);
  assert.equal(once.recurring, false);
  const daily = classifyTaskHorizon('每天看看待办里有没有加班');
  assert.equal(daily.durable, true);
  assert.equal(daily.recurring, true);
  assert.equal(classifyTaskHorizon('打开请假流程').durable, false);
  assert.equal(reminderMatched('请假批下来之后告诉我', '待办列表 请假 张三'), true);
  const recent = new Date('2026-11-10T09:00:00');
  assert.equal(shouldResumeNow({
    status: 'waiting',
    recurring: true,
    updatedAt: '2026-11-10 08:30:00',
  }, recent), false);
  assert.equal(shouldResumeNow({ status: 'waiting', recurring: false, updatedAt: '2026-11-10 08:30:00' }, recent), true);
});

it('审批回读：原行消失才算办完', () => {
  assert.equal(
    approvalSettled('请假 张三 待办', ['加班 李四 待办'], '请假', '同意'),
    true,
  );
  assert.equal(
    approvalSettled('请假 张三 待办', ['请假 张三 待办'], '请假', '同意'),
    false,
  );
});

it('没有新步骤时停止', () => {
  const result = queueAfterFailure([], 0);
  assert.equal(result.stop, true);
  assert.equal(result.replanned, false);
});
