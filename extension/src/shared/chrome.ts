import type { AiSettings } from './types';

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

/** 来自 extension/.env（Vite 注入）；可被 chrome.storage 覆盖 */
export const SETTINGS_DEFAULTS: AiSettings = {
  provider: 'deepseek',
  apiKey: String(import.meta.env.VITE_DEEPSEEK_API_KEY || ''),
  baseUrl: String(import.meta.env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com'),
  model: String(import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat'),
  enabled: envFlag(import.meta.env.VITE_DEEPSEEK_ENABLED, true),
  workflowKeywords: '流程,打开,发起,新建,填写',
  menuKeywords: '菜单,进入,模块,页面,导航',
  todoKeywords: '待办,待我审批,我的待办,待审',
  habitEnabled: envFlag(import.meta.env.VITE_HABIT_ENABLED, true),
  habitBackendUrl: String(import.meta.env.VITE_HABIT_BACKEND_URL || 'http://localhost:3000'),
  habitExtensionToken: String(import.meta.env.VITE_HABIT_EXTENSION_TOKEN || 'warom-dev-token'),
  waromUserId: '',
};

export async function loadSettings(): Promise<AiSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const merged = { ...SETTINGS_DEFAULTS, ...stored } as AiSettings;
  // storage 里若是空 Key，回退到 .env 构建默认值
  if (!String(merged.apiKey || '').trim() && SETTINGS_DEFAULTS.apiKey) {
    merged.apiKey = SETTINGS_DEFAULTS.apiKey;
  }
  return merged;
}

export async function saveSettings(partial: Partial<AiSettings>): Promise<void> {
  await chrome.storage.local.set(partial);
}
