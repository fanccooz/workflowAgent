import * as DeepSeek from '@/shared/deepseek';
import { loadSettings } from '@/shared/chrome';
import { MSG } from '@/shared/types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MSG.openOptions) {
    chrome.runtime
      .openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '打不开设置页' }));
    return true;
  }

  if (message.type === MSG.getSettings) {
    loadSettings()
      .then((settings) =>
        sendResponse({
          ok: true,
          settings: {
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            model: settings.model,
            enabled: settings.enabled,
            hasKey: Boolean(settings.apiKey),
            workflowKeywords: settings.workflowKeywords,
            menuKeywords: settings.menuKeywords,
            todoKeywords: settings.todoKeywords,
          },
        }),
      )
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '读取设置失败' }));
    return true;
  }

  if (message.type === MSG.aiDecide) {
    loadSettings()
      .then((settings) =>
        DeepSeek.decide(settings, message.utterance, message.scope, message.candidates),
      )
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '模型调用失败' }));
    return true;
  }

  if (message.type === MSG.aiChat) {
    loadSettings()
      .then((settings) =>
        DeepSeek.chat(settings, message.utterance, message.history, message.pageSummary),
      )
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '对话失败' }));
    return true;
  }

  if (message.type === MSG.aiFillForm) {
    loadSettings()
      .then((settings) =>
        DeepSeek.fillForm(
          settings,
          message.utterance,
          message.fields,
          message.today,
          message.analysis,
        ),
      )
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '填表推理失败' }));
    return true;
  }

  if (message.type === MSG.aiReflect) {
    loadSettings()
      .then((settings) => DeepSeek.reflect(settings, message.payload))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error: Error) => sendResponse({ ok: false, message: error.message || '反思失败' }));
    return true;
  }

  return false;
});
