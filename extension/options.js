const DEFAULTS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  enabled: true,
  workflowKeywords: '流程,打开,发起,新建,填写',
  menuKeywords: '菜单,进入,模块,页面,导航',
  todoKeywords: '待办,待我审批,我的待办,待审',
  habitEnabled: true,
  habitBackendUrl: 'http://localhost:3000',
  habitExtensionToken: 'warom-dev-token',
  waromUserId: '',
};

const enabledInput = document.querySelector('#enabled');
const providerInput = document.querySelector('#provider');
const apiKeyInput = document.querySelector('#apiKey');
const baseUrlInput = document.querySelector('#baseUrl');
const modelInput = document.querySelector('#model');
const workflowKeywordsInput = document.querySelector('#workflowKeywords');
const menuKeywordsInput = document.querySelector('#menuKeywords');
const todoKeywordsInput = document.querySelector('#todoKeywords');
const habitEnabledInput = document.querySelector('#habitEnabled');
const habitBackendUrlInput = document.querySelector('#habitBackendUrl');
const habitExtensionTokenInput = document.querySelector('#habitExtensionToken');
const waromUserIdInput = document.querySelector('#waromUserId');
const statusNode = document.querySelector('#status');
const saveButton = document.querySelector('#save');

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };
  enabledInput.checked = Boolean(settings.enabled);
  providerInput.value = settings.provider || 'deepseek';
  apiKeyInput.value = settings.apiKey || '';
  baseUrlInput.value = settings.baseUrl || DEFAULTS.baseUrl;
  modelInput.value = settings.model || DEFAULTS.model;
  workflowKeywordsInput.value = settings.workflowKeywords || DEFAULTS.workflowKeywords;
  menuKeywordsInput.value = settings.menuKeywords || DEFAULTS.menuKeywords;
  todoKeywordsInput.value = settings.todoKeywords || DEFAULTS.todoKeywords;
  habitEnabledInput.checked = Boolean(settings.habitEnabled);
  habitBackendUrlInput.value = settings.habitBackendUrl || DEFAULTS.habitBackendUrl;
  habitExtensionTokenInput.value = settings.habitExtensionToken || DEFAULTS.habitExtensionToken;
  waromUserIdInput.value = settings.waromUserId || '';
}

async function save() {
  await chrome.storage.local.set({
    provider: providerInput.value || 'deepseek',
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim() || DEFAULTS.baseUrl,
    model: modelInput.value.trim() || DEFAULTS.model,
    enabled: enabledInput.checked,
    workflowKeywords: workflowKeywordsInput.value.trim() || DEFAULTS.workflowKeywords,
    menuKeywords: menuKeywordsInput.value.trim() || DEFAULTS.menuKeywords,
    todoKeywords: todoKeywordsInput.value.trim() || DEFAULTS.todoKeywords,
    habitEnabled: habitEnabledInput.checked,
    habitBackendUrl: habitBackendUrlInput.value.trim() || DEFAULTS.habitBackendUrl,
    habitExtensionToken: habitExtensionTokenInput.value.trim() || DEFAULTS.habitExtensionToken,
    waromUserId: waromUserIdInput.value.trim(),
  });
  statusNode.textContent = '已保存。回到华荣页面刷新后再用助手。';
}

saveButton.addEventListener('click', () => {
  save().catch((error) => {
    statusNode.textContent = error.message || '保存失败';
  });
});

load().catch((error) => {
  statusNode.textContent = error.message || '读取设置失败';
});
