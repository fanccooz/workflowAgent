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
import { usePanelPosition } from './composables/usePanelPosition';
import { useChatSession } from './composables/useChatSession';
import HabitSuggestions from './components/HabitSuggestions.vue';
import ChoiceList from './components/ChoiceList.vue';
import ChatComposer from './components/ChatComposer.vue';
import LeaveConfirmBar from './components/LeaveConfirmBar.vue';

type ChoiceItem = {
  id: string;
  title: string;
  subtitle?: string;
  type?: string;
  [key: string]: unknown;
};

const open = ref(false);
const input = ref('');
const running = ref(false);
const habitLoading = ref(false);
const habitSuggestions = ref<string[]>([]);
const choices = ref<ChoiceItem[]>([]);
const awaitingConfirm = ref(false);
const confirmLabel = ref('确认提交');
const confirmHint = ref('');
const aiReadyHint = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const headRef = ref<HTMLElement | null>(null);
const toggleRef = ref<HTMLElement | null>(null);
const logRef = ref<HTMLElement | null>(null);
const composerRef = ref<{ focus: () => void } | null>(null);

const {
  log,
  transcript,
  loadPersistedChat,
  persistChat,
  pushTurn,
  historyForApi,
} = useChatSession({
  log: '准备好了。可以闲聊，也可以办事，例如：打开请假流程；或帮我请假，明天到后天，事由开会。',
  transcript: '准备好了。可以闲聊，也可以说要打开的流程/菜单。',
});

const { restorePosition, enableDrag } = usePanelPosition(rootRef);

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

async function refreshAiHint() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.getSettings });
    aiReadyHint.value = Boolean(response?.settings?.enabled && response?.settings?.hasKey);
  } catch {
    aiReadyHint.value = false;
  }
}

onMounted(async () => {
  await nextTick();
  restorePosition();
  await loadPersistedChat();
  await refreshAiHint();
  if (headRef.value) enableDrag(headRef.value, { ignoreSelector: '.wf-head-actions' });
  if (toggleRef.value) enableDrag(toggleRef.value);
  suppressAutoOpenFromUrl().catch(() => {});
});

function addHabitSuggestion(text: string) {
  const suggestion = String(text || '').trim();
  if (!suggestion) return;
  habitSuggestions.value = [
    suggestion,
    ...habitSuggestions.value.filter((item) => item !== suggestion),
  ].slice(0, 3);
}

function applyHabitSuggestion(text: string) {
  input.value = text;
  nextTick(() => composerRef.value?.focus());
}

function dismissHabitSuggestion(text: string) {
  habitSuggestions.value = habitSuggestions.value.filter((item) => item !== text);
}

async function maybeFillHabitSuggestion(options: {
  force?: boolean;
  refresh?: boolean;
  announce?: boolean;
} = {}) {
  try {
    const result = await Habits.fetchChatBoxSuggestion(Boolean(options.refresh));
    if (result?.suggestion) {
      addHabitSuggestion(result.suggestion);
      if (options.announce) {
        log.value = `${log.value}\n\n（已更新顶部快捷建议${result.cached ? '·缓存' : ''}，点击可填入）`;
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
      log.value = `${log.value}\n\n（习惯建议未更新：${reason}）`;
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
      composerRef.value?.focus();
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
    const response = await handleUtterance(utterance, { history: historyForApi() });
    const replyText = response?.reply || response?.message || '';
    const assistantMemory = String(response?.reply || response?.message || '')
      .replace(/^助手：/, '')
      .trim()
      .slice(0, 800);
    pushTurn(utterance, assistantMemory || String(replyText || '').slice(0, 800));
    await persistChat();
    if (assistantMemory) {
      Habits.reportChat(assistantMemory, 'assistant').catch(() => {});
    }
    transcript.value = `${transcript.value.replace(/\n助手：正在思考…$/, '')}\n${response?.message || replyText}`;
    log.value = transcript.value;
    scrollLog();
    input.value = '';
    if (response?.status === 'choose') {
      choices.value = Array.isArray(response.choices) ? response.choices : [];
    }
    const wantMinimize = response?.panelAction === 'minimize'
      || (Array.isArray(response?.actions) && response.actions.some((item: { type?: string }) => item?.type === 'panel_minimize'));
    if (wantMinimize) setOpen(false);
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

async function pickChoice(item: ChoiceItem) {
  running.value = true;
  try {
    const opened = await openCandidate(item);
    transcript.value = `${transcript.value}\n助手：${opened?.message || '已打开。'}`;
    log.value = transcript.value;
    choices.value = [];
    scrollLog();
  } catch (error) {
    log.value = error instanceof Error ? error.message : '打开失败。';
  } finally {
    running.value = false;
  }
}

async function onConfirm() {
  running.value = true;
  try {
    const response = await confirmLeaveSubmit();
    transcript.value = `${transcript.value}\n助手：${response?.message || '已提交。'}`;
    log.value = transcript.value;
    scrollLog();
    if (response?.status === 'await_confirm') {
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
          <HabitSuggestions
            :items="habitSuggestions"
            :disabled="habitLoading || running"
            @apply="applyHabitSuggestion"
            @dismiss="dismissHabitSuggestion"
            @clear="habitSuggestions = []"
          />
          <p class="wf-hint-top">
            <template v-if="aiReadyHint">
              与 DeepSeek 对话即可；页面摘要由 AI 按本轮需要自行提炼。
            </template>
            <template v-else>
              先与 DeepSeek 对话；需要办事时会自动匹配并打开。请先在设置里配置 Key（或 .env 后重新加载扩展）。
            </template>
          </p>
          <div ref="logRef" class="wf-log">{{ log }}</div>

          <ChoiceList
            :groups="choiceGroups"
            :disabled="running"
            @pick="pickChoice"
          />

          <ChatComposer
            ref="composerRef"
            v-model="input"
            :running="running"
            :habit-loading="habitLoading"
            @send="send"
            @habit="onHabitSuggest"
            @settings="openSettings"
          />

          <LeaveConfirmBar
            :awaiting="awaitingConfirm"
            :label="confirmLabel"
            :hint="confirmHint"
            :disabled="running"
            @confirm="onConfirm"
          />
        </div>
      </section>
      <button ref="toggleRef" type="button" class="wf-toggle" @click="onToggleClick">
        流程助手
      </button>
    </div>
  </div>
</template>
