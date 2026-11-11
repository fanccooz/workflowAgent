import { ref } from 'vue';

const CHAT_HISTORY_KEY = 'warom-agent-chat-history-v1';
const TRANSCRIPT_KEY = 'warom-agent-transcript-v1';

export function useChatSession(defaults: { log: string; transcript: string }) {
  const log = ref(defaults.log);
  const transcript = ref(defaults.transcript);
  const chatHistory = ref<Array<{ role: string; content: string }>>([]);

  async function loadPersistedChat() {
    try {
      const stored = await chrome.storage.session.get({
        [CHAT_HISTORY_KEY]: [],
        [TRANSCRIPT_KEY]: '',
      });
      const history = Array.isArray(stored[CHAT_HISTORY_KEY]) ? stored[CHAT_HISTORY_KEY] : [];
      chatHistory.value = history
        .filter((item: { role?: string; content?: string }) => item && (item.role === 'user' || item.role === 'assistant'))
        .map((item: { role: string; content: string }) => ({
          role: item.role,
          content: String(item.content || '').trim().slice(0, 800),
        }))
        .filter((item: { content: string }) => item.content)
        .slice(-60);
      const savedLog = String(stored[TRANSCRIPT_KEY] || '').trim();
      if (savedLog) {
        transcript.value = savedLog;
        log.value = savedLog;
      }
    } catch {
      // session storage 不可用时忽略
    }
  }

  async function persistChat() {
    try {
      await chrome.storage.session.set({
        [CHAT_HISTORY_KEY]: chatHistory.value.slice(-60),
        [TRANSCRIPT_KEY]: String(transcript.value || '').slice(-8000),
      });
    } catch {
      // ignore
    }
  }

  function pushTurn(userText: string, assistantText: string) {
    chatHistory.value.push({ role: 'user', content: userText.slice(0, 800) });
    chatHistory.value.push({
      role: 'assistant',
      content: assistantText.slice(0, 800),
    });
    if (chatHistory.value.length > 60) {
      chatHistory.value = chatHistory.value.slice(-60);
    }
  }

  function historyForApi() {
    return chatHistory.value
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
      .map((item) => ({
        role: item.role,
        content: String(item.content || '').trim().slice(0, 800),
      }))
      .filter((item) => item.content)
      .slice(-40);
  }

  return {
    log,
    transcript,
    loadPersistedChat,
    persistChat,
    pushTurn,
    historyForApi,
  };
}
