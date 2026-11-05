/* global DeepSeek */
importScripts('deepseek.js');

const DEFAULTS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: DeepSeek.API_DEFAULTS.baseUrl,
  model: DeepSeek.API_DEFAULTS.model,
  enabled: true,
  workflowKeywords: '流程,打开,发起,新建,填写',
  menuKeywords: '菜单,进入,模块,页面,导航',
  todoKeywords: '待办,待我审批,我的待办,待审',
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'warom-open-options') {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '打不开设置页' }));
    return true;
  }

  if (message.type === 'warom-get-settings') {
    loadSettings()
      .then((settings) => sendResponse({
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
      }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '读取设置失败' }));
    return true;
  }

  // —— 以下三条都转发到 deepseek.js ——
  if (message.type === 'warom-ai-decide') {
    loadSettings()
      .then((settings) => DeepSeek.decide(
        settings,
        message.utterance,
        message.scope,
        message.candidates,
      ))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '模型调用失败' }));
    return true;
  }

  if (message.type === 'warom-ai-chat') {
    loadSettings()
      .then((settings) => DeepSeek.chat(settings, message.utterance, message.history))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '对话失败' }));
    return true;
  }

  if (message.type === 'warom-ai-fill-form') {
    loadSettings()
      .then((settings) => DeepSeek.fillForm(
        settings,
        message.utterance,
        message.fields,
        message.today,
      ))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '填表推理失败' }));
    return true;
  }

  if (message.type === 'warom-ai-reflect') {
    loadSettings()
      .then((settings) => DeepSeek.reflect(settings, message.payload))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error) => sendResponse({ ok: false, message: error.message || '反思失败' }));
    return true;
  }

  return false;
});
