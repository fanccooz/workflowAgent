<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import * as Habits from '@/shared/habits';
import { groupCandidates } from '@/shared/intent';
import { MSG } from '@/shared/types';
import {
  confirmLeaveSubmit,
  handleUtterance,
  openCandidate,
  suppressAutoOpenFromUrl,
} from './legacy-runner';

type ChoiceItem = {
  id: string;
  title: string;
  subtitle?: string;
  type?: string;
  [key: string]: unknown;
};

const open = ref(false);
const input = ref('');
const log = ref(
  '准备好了。配置 DeepSeek 后即可对话，例如：帮我请假，明天到后天，事由开会',
);
const transcript = ref('准备好了。配置 DeepSeek 后即可对话。');
const running = ref(false);
const habitLoading = ref(false);
const choices = ref<ChoiceItem[]>([]);
const awaitingConfirm = ref(false);
const confirmLabel = ref('确认提交');
const confirmHint = ref('');
const chatHistory = ref<Array<{ role: string; content: string }>>([]);
const rootRef = ref<HTMLElement | null>(null);
const headRef = ref<HTMLElement | null>(null);
const toggleRef = ref<HTMLElement | null>(null);
const logRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

const POSITION_KEY = 'warom-agent-position-v2';

const choiceGroups = computed(() => {
  const groups = groupCandidates(choices.value as never[]);
  const labels: Record<string, string> = { workflow: '流程', menu: '菜单', todo: '待办' };
  return (['workflow', 'menu', 'todo'] as const)
    .map((type) => ({
      type,
      label: labels[type],
      items: (groups[type] || []) as ChoiceItem[],
    }))
    .filter((group) => group.items.length > 0);
});

onMounted(async () => {
  await nextTick();
  restorePosition();
  if (headRef.value) enableDrag(headRef.value, { ignoreSelector: '.wf-head-actions' });
  if (toggleRef.value) enableDrag(toggleRef.value);
  suppressAutoOpenFromUrl().catch(() => {});
});

function hostEl(): HTMLElement | null {
  return (document.getElementById('wf-agent-host') as HTMLElement | null) || rootRef.value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyPosition(left: number, top: number) {
  const el = hostEl();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const nextLeft = clamp(left, 8, maxLeft);
  const nextTop = clamp(top, 8, maxTop);
  el.style.left = `${nextLeft}px`;
  el.style.top = `${nextTop}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function restorePosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return;
    const pos = JSON.parse(raw) as { left?: number; top?: number };
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      applyPosition(pos.left, pos.top);
    }
  } catch {
    // ignore
  }
}

function savePosition() {
  const el = hostEl();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
}

function enableDrag(handle: HTMLElement, options: { ignoreSelector?: string } = {}) {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (options.ignoreSelector && (event.target as HTMLElement).closest(options.ignoreSelector)) {
      return;
    }
    const el = hostEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    moved = false;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    applyPosition(originLeft + dx, originTop + dy);
  });

  handle.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (moved) {
      savePosition();
      event.preventDefault();
      event.stopPropagation();
    }
    (handle as HTMLElement & { _wfDragMoved?: boolean })._wfDragMoved = moved;
  });

  handle.addEventListener('pointercancel', () => {
    dragging = false;
  });
}

async function maybeFillHabitSuggestion(options: {
  force?: boolean;
  refresh?: boolean;
  announce?: boolean;
} = {}) {
  if (!options.force && input.value.trim()) return;
  try {
    const result = await Habits.fetchChatBoxSuggestion(Boolean(options.refresh));
    if (result?.suggestion) {
      if (options.force || !input.value.trim()) {
        input.value = result.suggestion;
      }
      if (options.announce) {
        log.value = `${log.value}\n\n（已填入习惯建议语${result.cached ? '·缓存' : ''}）`;
      }
      return;
    }
    if (options.announce) {
      const reason =
        result?.message ||
        result?.error ||
        (result?.reason === 'no-user'
          ? '未识别工号，请到设置填写'
          : '暂无建议语（需后端 DeepSeek Key，且至少 3 条聊天）');
      log.value = `${log.value}\n\n（习惯建议未填入：${reason}）`;
    }
  } catch (error) {
    if (options.announce) {
      log.value = `${log.value}\n\n（习惯建议失败：${error instanceof Error ? error.message : '未知错误'}）`;
    }
  }
}

function setOpen(next: boolean) {
  const wasClosed = !open.value;
  open.value = next;
  if (next && wasClosed) {
    nextTick(() => {
      maybeFillHabitSuggestion({ announce: false });
      inputRef.value?.focus();
    });
  }
}

function onToggleClick(event: MouseEvent) {
  const btn = event.currentTarget as HTMLElement & { _wfDragMoved?: boolean };
  if (btn._wfDragMoved) {
    event.preventDefault();
    return;
  }
  setOpen(!open.value);
}

function clearConfirm() {
  awaitingConfirm.value = false;
  confirmLabel.value = '确认提交';
  confirmHint.value = '';
}

function applyConfirmUi(response: Record<string, unknown> | null) {
  const waiting = Boolean(response && response.status === 'await_confirm');
  awaitingConfirm.value = waiting;
  if (!waiting) {
    confirmLabel.value = '确认提交';
    confirmHint.value = '';
    return;
  }
  // 与 legacy 一致：确认按钮始终可点，提交时再读页面必填
  const missing =
    (response?.missingTitles as string[]) || (response?.missing as string[]) || [];
  confirmLabel.value = missing.length
    ? `确认提交（请先补：${missing.join('、')}）`
    : '确认提交';
  confirmHint.value = missing.length
    ? `请先在弹窗补全：${missing.join('、')}`
    : '草稿已填好，确认后才会提交。';
}

function scrollLog() {
  nextTick(() => {
    if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
  });
}

async function send() {
  const utterance = input.value.trim();
  if (!utterance) {
    log.value = '请先输入内容，例如：帮我请假，明天到后天。';
    return;
  }
  running.value = true;
  choices.value = [];
  clearConfirm();
  transcript.value = `${transcript.value}\n\n我：${utterance}\n助手：正在思考…`;
  log.value = transcript.value;
  scrollLog();
  Habits.reportChat(utterance, 'user').catch(() => {});
  try {
    const historyForApi = chatHistory.value.slice();
    const response = await handleUtterance(utterance, { history: historyForApi });
    const replyText = response?.reply || response?.message || '';
    chatHistory.value.push({ role: 'user', content: utterance });
    chatHistory.value.push({
      role: 'assistant',
      content: String(response?.reply || String(response?.message || '').slice(0, 500)),
    });
    if (chatHistory.value.length > 24) {
      chatHistory.value = chatHistory.value.slice(-24);
    }
    transcript.value = `${transcript.value.replace(/\n助手：正在思考…$/, '')}\n${response?.message || replyText}`;
    log.value = transcript.value;
    scrollLog();
    input.value = '';
    if (response?.status === 'choose') {
      choices.value = Array.isArray(response.choices) ? response.choices : [];
    }
    applyConfirmUi(response);
    maybeFillHabitSuggestion({ refresh: true, announce: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行失败。';
    transcript.value = `${transcript.value.replace(/\n助手：正在思考…$/, '')}\n助手：${message}`;
    log.value = transcript.value;
    clearConfirm();
  } finally {
    running.value = false;
  }
}

/** 与 legacy 一致：候选项直接 openCandidate，不再当新对话发送 */
async function pickChoice(item: ChoiceItem) {
  running.value = true;
  log.value = '正在打开…';
  try {
    const response = await openCandidate(item);
    log.value = response?.message || '完成';
    if (response?.status === 'open') choices.value = [];
  } catch (error) {
    log.value = error instanceof Error ? error.message : '执行失败。';
  } finally {
    running.value = false;
  }
}

async function onConfirm() {
  if (!awaitingConfirm.value) return;
  running.value = true;
  log.value = '正在提交…';
  try {
    const response = await confirmLeaveSubmit();
    log.value = response?.message || '';
    if (response?.status === 'done') clearConfirm();
    else if (response?.status === 'missing') {
      applyConfirmUi({
        status: 'await_confirm',
        requiredReady: false,
        missing: response.missing || [],
        missingTitles: response.missingTitles || [],
      });
    } else {
      clearConfirm();
    }
  } catch (error) {
    log.value = error instanceof Error ? error.message : '提交失败。';
    clearConfirm();
  } finally {
    running.value = false;
  }
}

async function onHabitSuggest() {
  habitLoading.value = true;
  log.value = `${log.value}\n\n正在向后端索取习惯建议语…`;
  try {
    await maybeFillHabitSuggestion({ force: true, refresh: true, announce: true });
  } finally {
    habitLoading.value = false;
  }
}

function openSettings() {
  chrome.runtime.sendMessage({ type: MSG.openOptions }, (response) => {
    if (chrome.runtime.lastError || (response && response.ok === false)) {
      log.value =
        '打不开设置页。请到 chrome://extensions → 流程助手 → 详细信息 → 扩展程序选项。';
    }
  });
}

function clearInput() {
  input.value = '';
  nextTick(() => inputRef.value?.focus());
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send();
  }
}
</script>

<template>
  <div ref="rootRef" class="wf-root">
    <div class="wf-wrap">
      <section v-show="open" class="wf-panel">
        <div ref="headRef" class="wf-head">
          <strong>流程助手 · 可拖动</strong>
          <div class="wf-head-actions">
            <button type="button" aria-label="收起" @click="setOpen(false)">×</button>
          </div>
        </div>
        <div class="wf-body">
          <p class="wf-hint-top">
            先与 DeepSeek 对话；需要办事时会自动匹配并打开。请先在设置里配置 Key（或 .env）。
          </p>
          <div ref="logRef" class="wf-log">{{ log }}</div>

          <div v-if="choiceGroups.length" class="wf-choices">
            <div v-for="group in choiceGroups" :key="group.type" class="wf-choice-group">
              <h4>{{ group.label }}</h4>
              <button
                v-for="item in group.items"
                :key="item.id || item.title"
                type="button"
                class="wf-choice"
                :disabled="running"
                @click="pickChoice(item)"
              >
                {{ item.subtitle ? `${item.title}（${item.subtitle}）` : item.title }}
              </button>
            </div>
          </div>

          <div class="wf-input-wrap">
            <textarea
              ref="inputRef"
              v-model="input"
              rows="3"
              placeholder="打开请假流程"
              @keydown="onKeydown"
            />
            <button
              v-show="input.trim()"
              type="button"
              class="wf-input-clear"
              aria-label="清空输入"
              title="清空"
              @click="clearInput"
            >
              ×
            </button>
          </div>

          <div class="wf-actions">
            <button
              type="button"
              class="ghost"
              :disabled="habitLoading || running"
              @click="onHabitSuggest"
            >
              {{ habitLoading ? '拉取中…' : '习惯建议' }}
            </button>
            <button type="button" class="ghost" @click="openSettings">设置</button>
            <button type="button" class="primary" :disabled="running" @click="send">
              {{ running ? '处理中…' : '发送' }}
            </button>
          </div>

          <div v-if="awaitingConfirm" class="wf-actions">
            <button type="button" class="confirm" :disabled="running" @click="onConfirm">
              {{ confirmLabel }}
            </button>
          </div>
          <p v-if="confirmHint" class="wf-hint">{{ confirmHint }}</p>
        </div>
      </section>
      <button ref="toggleRef" type="button" class="wf-toggle" @click="onToggleClick">
        流程助手
      </button>
    </div>
  </div>
</template>
