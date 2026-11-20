// @ts-nocheck
import {
  AGENT_TOOLS,
  MAX_TOOL_ROUNDS,
  buildToolChatMessages,
  toolCallToAction,
  summarizeToolResult,
} from '@/shared/agent-tools';
import { askDeepSeekToolsTurn } from './ai-chat';

function assistantMessageForHistory(message) {
  const out = {
    role: 'assistant',
    content: message && message.content != null ? message.content : null,
  };
  if (Array.isArray(message && message.tool_calls) && message.tool_calls.length) {
    out.tool_calls = message.tool_calls;
  }
  return out;
}

/**
 * DeepSeek 原生 function calling 环：模型选工具 → 本地执行 → 结果回灌 → 再问模型。
 * deps: { executeChatAction, collectPageRaw }，避免与 chat-executor 循环依赖。
 */
export async function runNativeToolLoop(utterance, options, deps) {
  const opts = options || {};
  const executeChatAction = deps && deps.executeChatAction;
  const collectPageRaw = deps && deps.collectPageRaw;
  if (typeof executeChatAction !== 'function' || typeof collectPageRaw !== 'function') {
    throw new Error('tool loop 缺少 executeChatAction / collectPageRaw');
  }

  const history = Array.isArray(opts.history) ? opts.history : [];
  const analysis = opts.analysis || null;
  const pageRaw = collectPageRaw();
  const messages = buildToolChatMessages(utterance, history, pageRaw);

  const executed = [];
  const stepResults = [];
  const stepMessages = [];
  let lastResult = null;
  let finalReply = '';
  let rounds = 0;

  function pack(status) {
    return {
      status,
      reply: finalReply,
      message: finalReply,
      actions: executed,
      action: executed[0] || { type: 'none', query: '' },
      stepMessages,
      stepResults,
      choices: (lastResult && lastResult.choices) || [],
      lastResult,
      plannedVia: 'extension-tools',
      requiredReady: lastResult && lastResult.requiredReady,
      missing: (lastResult && lastResult.missing) || [],
      missingTitles: (lastResult && lastResult.missingTitles) || [],
      filled: (lastResult && lastResult.filled) || {},
    };
  }

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const assistant = await askDeepSeekToolsTurn(messages, AGENT_TOOLS);
    if (!assistant) throw new Error('模型没有返回内容');

    messages.push(assistantMessageForHistory(assistant));

    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!toolCalls.length) {
      finalReply = String(assistant.content || '').trim();
      break;
    }

    for (const call of toolCalls) {
      const action = toolCallToAction(call);
      if (!action) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            message: `未知工具：${call.function && call.function.name}`,
          }),
        });
        continue;
      }

      const result = await executeChatAction(action, utterance, { analysis });
      lastResult = result;
      executed.push(action);
      stepResults.push({ action, result });
      if (result && result.message) stepMessages.push(String(result.message));

      const afterPage = collectPageRaw();
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: summarizeToolResult(action, result, afterPage),
      });

      if (result && (result.status === 'choose' || (result.choices && result.choices.length > 1))) {
        finalReply = String(assistant.content || result.message || '请从候选里选一项。').trim();
        return pack(result.status || 'choose');
      }
    }
  }

  if (!finalReply && lastResult && lastResult.message) {
    finalReply = String(lastResult.message);
  }
  if (!finalReply) {
    finalReply = executed.length ? '已按工具调用执行。' : '请再说清楚一点。';
  }

  const status = lastResult && lastResult.status
    ? lastResult.status
    : (executed.length ? 'ok' : 'chat');

  return pack(status);
}
