// @ts-nocheck
import * as Intent from '@/shared/intent';
import { MSG } from '@/shared/types';

export async function loadAiSettings() {
  try {
    const settingResponse = await chrome.runtime.sendMessage({ type: MSG.getSettings });
    return settingResponse && settingResponse.settings;
  } catch (error) {
    return null;
  }
}

export async function askDeepSeekChat(utterance, history, pageRaw) {
  const response = await chrome.runtime.sendMessage({
    type: MSG.aiChat,
    utterance,
    history: Array.isArray(history) ? history : [],
    pageSummary: pageRaw || null,
  });
  if (!response || !response.ok) {
    throw new Error((response && response.message) || '对话失败');
  }
  const raw = String(response.content || '').trim();
  try {
    const parsed = Intent.parseModelJson(raw);
    return Intent.sanitizeChatAction(parsed, utterance);
  } catch (error) {
    // 模型偶尔不按 JSON 回：当普通文本回复，再用关键词纠正打开/搜索
    const plain = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return Intent.sanitizeChatAction({
      reply: plain || '模型返回格式异常，请再说一次。',
      actions: [{ type: 'none', query: '' }],
    }, utterance);
  }
}
