<script setup lang="ts">
import { ref } from 'vue';
import { MSG, SITE_PREFIX } from '@/shared/types';

const utterance = ref('');
const result = ref('');
const running = ref(false);

async function ensureContentScript(tabId: number) {
  const manifest = chrome.runtime.getManifest();
  const files = (manifest.content_scripts || [])
    .flatMap((entry) => entry.js || [])
    .filter(Boolean);
  if (!files.length) {
    throw new Error('未找到 content scripts，请重新加载扩展。');
  }
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function run() {
  const text = utterance.value.trim();
  if (!text) {
    result.value = '请先输入要打开的流程，例如：打开请假流程。';
    return;
  }
  running.value = true;
  result.value = '正在打开…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !String(tab.url || '').startsWith(SITE_PREFIX)) {
      result.value = '请先在当前标签页打开并登录目标信息平台。';
      return;
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: MSG.run, utterance: text });
    } catch {
      await ensureContentScript(tab.id);
      response = await chrome.tabs.sendMessage(tab.id, { type: MSG.run, utterance: text });
    }
    result.value = response?.message || '没有收到页面的执行结果。';
  } catch (error) {
    result.value = error instanceof Error ? error.message : '执行失败。';
  } finally {
    running.value = false;
  }
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) run();
}
</script>

<template>
  <main>
    <h1>流程助手</h1>
    <p class="hint">在已登录的平台页面上说要打开哪条流程。</p>
    <textarea v-model="utterance" placeholder="例如：打开请假流程" @keydown="onKeydown" />
    <div class="actions">
      <button type="button" class="primary" :disabled="running" @click="run">
        {{ running ? '执行中…' : '执行' }}
      </button>
      <button type="button" class="ghost" @click="openSettings">设置</button>
    </div>
    <p class="result">{{ result }}</p>
  </main>
</template>
