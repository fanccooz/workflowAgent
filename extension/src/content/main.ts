import { createApp } from 'vue';
import App from './App.vue';
import panelCss from './panel.css?inline';
import './orchestrator';

if (!(globalThis as { __wfAgentLoaded?: boolean }).__wfAgentLoaded) {
  (globalThis as { __wfAgentLoaded?: boolean }).__wfAgentLoaded = true;

  const host = document.createElement('div');
  host.id = 'wf-agent-host';
  host.style.cssText =
    'all: initial; position: fixed; right: 20px; top: 35%; z-index: 2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = panelCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.documentElement.appendChild(host);
  createApp(App).mount(mountPoint);
}
