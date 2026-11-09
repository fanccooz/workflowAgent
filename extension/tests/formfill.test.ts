import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  extractKeywordFills,
  inferWorkflowQuery,
  isPureOpenRequest,
  mergeFillHints,
  utteranceHasFillHints,
} from '@/shared/formfill';

it('纯打开不算填表提示', () => {
  assert.equal(isPureOpenRequest('打开请假流程'), true);
  assert.equal(utteranceHasFillHints('打开请假流程'), false);
});

it('给丁德志留言抽出接收人', () => {
  assert.equal(utteranceHasFillHints('我要给丁德志留言'), true);
  assert.equal(inferWorkflowQuery('我要给丁德志留言'), '内部留言');
  const fills = extractKeywordFills('我要给丁德志留言');
  assert.equal(fills['接收人'], '丁德志');
});

it('对话 summary.form 优先合并', () => {
  const fills = mergeFillHints('我要给丁德志留言', {
    form: { 接收人: '丁德志', 内容: '你好' },
  });
  assert.equal(fills['接收人'], '丁德志');
  assert.equal(fills['内容'], '你好');
});

it('对话纠正：留言原话升级为 form.open_fill', async () => {
  const { sanitizeChatAction } = await import('@/shared/intent');
  const chat = sanitizeChatAction(
    {
      reply: '我帮你打开新建流程，再选内部留言，接收人填丁德志。',
      summary: { form: { 接收人: '丁德志' } },
      actions: [{ type: 'open_workflow', query: '新建流程' }],
    },
    '我要给丁德志留言',
  );
  assert.equal(chat.action.type, 'form.open_fill');
  assert.match(chat.action.query, /留言|内部留言/);
});
