import { defineManifest } from '@crxjs/vite-plugin';

const SITE = 'https://test.warom-lighting.com';
const APP_PATH = `${SITE}/v2_debug_ouyang/*`;

export default defineManifest({
  manifest_version: 3,
  name: '流程助手',
  version: '1.2.0',
  description: '在目标信息平台里用一句话打开流程，并可用 DeepSeek 跨流程/菜单/待办搜索。',
  permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: [
    `${SITE}/*`,
    'https://api.deepseek.com/*',
    'http://localhost:3000/*',
    'http://127.0.0.1:3000/*',
  ],
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  action: {
    default_title: '流程助手',
    default_popup: 'src/popup/index.html',
  },
  content_scripts: [
    {
      matches: [APP_PATH],
      js: ['src/content/early-clean.ts'],
      run_at: 'document_start',
    },
    {
      matches: [APP_PATH],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
});
