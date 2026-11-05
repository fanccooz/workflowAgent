import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  extractSlots,
  isReady,
  looksLikeLeaveTask,
} from '@/shared/leave';

const NOW = new Date(2026, 9, 30); // 2026-10-30

it('明天到后天抽出起止日期', () => {
  const slots = extractSlots('帮我请假，明天到后天，事由开会', NOW);
  assert.equal(slots.startDate, '2026-10-31');
  assert.equal(slots.endDate, '2026-11-01');
  assert.equal(slots.reason, '开会');
});

it('只有明天则起止同一天', () => {
  const slots = extractSlots('请假明天', NOW);
  assert.equal(slots.startDate, '2026-10-31');
  assert.equal(slots.endDate, '2026-10-31');
});

it('没有日期则空', () => {
  const slots = extractSlots('打开请假流程', NOW);
  assert.equal(slots.startDate, '');
  assert.equal(slots.endDate, '');
});

it('必填检查', () => {
  assert.equal(isReady({ startDate: 'a', endDate: 'b', reason: 'c' }).ready, true);
  assert.deepEqual(isReady({ startDate: 'a' }).missing, ['endDate', 'reason']);
});

it('含日期的请假算填表任务', () => {
  assert.equal(looksLikeLeaveTask('打开请假流程'), false);
  assert.equal(looksLikeLeaveTask('帮我请假，明天到后天开会'), true);
});
