<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { SETTINGS_DEFAULTS, loadSettings, saveSettings } from '@/shared/chrome';

const form = reactive({ ...SETTINGS_DEFAULTS });
const status = ref('');

onMounted(async () => {
  try {
    const settings = await loadSettings();
    Object.assign(form, settings);
  } catch (error) {
    status.value = error instanceof Error ? error.message : '读取设置失败';
  }
});

async function onSave() {
  try {
    await saveSettings({
      provider: form.provider || 'deepseek',
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim() || SETTINGS_DEFAULTS.baseUrl,
      model: form.model.trim() || SETTINGS_DEFAULTS.model,
      enabled: Boolean(form.enabled),
      workflowKeywords: form.workflowKeywords.trim() || SETTINGS_DEFAULTS.workflowKeywords,
      menuKeywords: form.menuKeywords.trim() || SETTINGS_DEFAULTS.menuKeywords,
      todoKeywords: form.todoKeywords.trim() || SETTINGS_DEFAULTS.todoKeywords,
      habitEnabled: Boolean(form.habitEnabled),
      habitBackendUrl: form.habitBackendUrl?.trim() || SETTINGS_DEFAULTS.habitBackendUrl,
      habitExtensionToken:
        form.habitExtensionToken?.trim() || SETTINGS_DEFAULTS.habitExtensionToken,
      waromUserId: form.waromUserId?.trim() || '',
    });
    status.value = '已保存。回到平台页面刷新后再用助手。';
  } catch (error) {
    status.value = error instanceof Error ? error.message : '保存失败';
  }
}
</script>

<template>
  <main>
    <h1>流程助手设置</h1>
    <p class="hint">DeepSeek Key 与关键字都只保存在本机 Chrome。</p>

    <h2>DeepSeek</h2>
    <label class="row">
      <input v-model="form.enabled" type="checkbox" />
      <span>启用 DeepSeek AI 搜索</span>
    </label>

    <label>
      <span>服务商</span>
      <select v-model="form.provider">
        <option value="deepseek">DeepSeek</option>
      </select>
    </label>

    <label>
      <span>DeepSeek API Key</span>
      <input v-model="form.apiKey" type="text" placeholder="在此粘贴 sk- 开头的 Key" autocomplete="off" spellcheck="false" />
    </label>
    <p class="tip">可在 DeepSeek 开放平台创建并复制 API Key，粘贴后点保存。</p>

    <label>
      <span>Base URL</span>
      <input v-model="form.baseUrl" type="text" placeholder="https://api.deepseek.com" />
    </label>

    <label>
      <span>模型名</span>
      <input v-model="form.model" type="text" placeholder="deepseek-chat" />
    </label>

    <h2>习惯建议语后端（Nest）</h2>
    <p class="tip">用于把 DeepSeek 根据最近聊天生成的句子填进助手输入框。需先启动 server。</p>
    <label class="row">
      <input v-model="form.habitEnabled" type="checkbox" />
      <span>启用习惯建议语</span>
    </label>
    <label>
      <span>后端地址</span>
      <input v-model="form.habitBackendUrl" type="text" placeholder="http://localhost:3000" />
    </label>
    <label>
      <span>扩展 Token（与 server 的 EXTENSION_TOKEN 一致）</span>
      <input v-model="form.habitExtensionToken" type="text" placeholder="warom-dev-token" autocomplete="off" />
    </label>
    <label>
      <span>员工工号（优先；不填则尝试从页面识别）</span>
      <input v-model="form.waromUserId" type="text" placeholder="例如 10001" />
    </label>

    <h2>触发关键字</h2>
    <p class="tip">多个词用逗号或换行分隔。会和系统默认词合并。</p>
    <label>
      <span>流程关键字</span>
      <textarea v-model="form.workflowKeywords" rows="3" />
    </label>
    <label>
      <span>菜单关键字</span>
      <textarea v-model="form.menuKeywords" rows="3" />
    </label>
    <label>
      <span>待办关键字</span>
      <textarea v-model="form.todoKeywords" rows="2" />
    </label>

    <div class="actions">
      <button type="button" @click="onSave">保存设置</button>
    </div>
    <p class="status" aria-live="polite">{{ status }}</p>

    <h2>怎么说话</h2>
    <ul class="examples">
      <li>打开流程：<code>打开请假流程</code></li>
      <li>打开菜单：<code>进入人事模块</code>、<code>打开菜单 流程定义</code></li>
      <li>打开待办：<code>打开我的待办</code></li>
    </ul>
  </main>
</template>
