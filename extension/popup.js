const utteranceInput = document.querySelector('#utterance');
const runButton = document.querySelector('#run');
const resultNode = document.querySelector('#result');
const SITE_PREFIX = 'https://test.warom-lighting.com/v2_debug_ouyang/';

function show(text) {
  resultNode.textContent = text;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      'extension/match.js',
      'extension/intent.js',
      'extension/skills/leave.js',
      'extension/agent.js',
      'extension/tools.js',
      'extension/content.js',
    ],
  });
}

async function run() {
  const utterance = utteranceInput.value.trim();
  if (!utterance) {
    show('请先输入要打开的流程，例如：打开请假流程。');
    return;
  }
  runButton.disabled = true;
  show('正在打开…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !String(tab.url || '').startsWith(SITE_PREFIX)) {
      show('请先在当前标签页打开并登录华荣照明信息平台。');
      return;
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'warom-run', utterance });
    } catch (error) {
      await ensureContentScript(tab.id);
      response = await chrome.tabs.sendMessage(tab.id, { type: 'warom-run', utterance });
    }
    show(response && response.message ? response.message : '没有收到页面的执行结果。');
  } catch (error) {
    show(error && error.message ? error.message : '执行失败。');
  } finally {
    runButton.disabled = false;
  }
}

document.querySelector('#settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

runButton.addEventListener('click', run);
utteranceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) run();
});
