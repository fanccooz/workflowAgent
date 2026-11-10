import { it } from 'vitest';
import assert from 'node:assert/strict';
import { cleanPlanSteps, queueAfterFailure } from '@/shared/taskplan';

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

it('失败后换成剩余步骤，且只重规划一次', () => {
  const first = queueAfterFailure(
    [{ type: 'open_workflow', query: '请假' }, { type: 'click_ui', query: '提交' }],
    0,
  );
  assert.equal(first.replanned, true);
  assert.equal(first.stop, false);
  assert.equal(first.queue.length, 1);
  assert.equal(first.queue[0].query, '请假');

  const second = queueAfterFailure([{ type: 'open_menu', query: '人事' }], 1);
  assert.equal(second.stop, true);
  assert.equal(second.queue.length, 0);
});

it('没有新步骤时停止', () => {
  const result = queueAfterFailure([], 0);
  assert.equal(result.stop, true);
  assert.equal(result.replanned, false);
});
