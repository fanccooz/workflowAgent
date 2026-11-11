<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import * as Habits from '@/shared/habits';
import { groupCandidates } from '@/shared/intent';
import { MSG } from '@/shared/types';
import {
  confirmLeaveSubmit,
  handleUtterance,
  openCandidate,
  resumeWaitingTasks,
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
const habitSuggestions = ref<Array<{ id: number; content: string }>>([]);
const habitError = ref('');
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
  maybeFillHabitSuggestion({ announce: false }).catch(() => {});
  try {
    const resumed = await resumeWaitingTasks();
    const notes = resumed && Array.isArray(resumed.messages) ? resumed.messages.filter(Boolean) : [];
    if (notes.length) {
      log.value = `${log.value}\n\n${notes.join('\n\n')}`;
      persistChat();
    }
  } catch {
    // 长期任务续跑失败时不影响当前页
  }
});

function formatHabitError(message: string) {
  if (/database is locked/i.test(message)) {
    return '建议库被数据库工具占用，先显示上次的三条。关掉 DB Browser 后会重新生成。';
  }
  return message;
}

function setHabitSuggestions(list: Array<{ id?: number; content?: string } | string>) {
  const next: Array<{ id: number; content: string }> = [];
  for (const item of list) {
    const content = String(typeof item === 'string' ? item : item?.content || '').trim();
    const id = typeof item === 'string' ? 0 : Number(item?.id);
    if (!content || next.some((row) => row.content === content)) continue;
    next.push({ id: Number.isInteger(id) ? id : 0, content });
    if (next.length >= 3) break;
  }
  habitSuggestions.value = next;
}

function applyHabitSuggestion(text: string) {
  input.value = text;
  nextTick(() => composerRef.value?.focus());
}

async function dismissHabitSuggestion(id: number) {
  const previous = habitSuggestions.value.slice();
  habitSuggestions.value = previous.filter((item) => item.id !== id);
  const result = await Habits.removeChatBoxSuggestion(id);
  if (!result?.ok) {
    habitSuggestions.value = previous;
    habitError.value = formatHabitError(result?.message || '删除失败');
    return;
  }
  if (Array.isArray(result.suggestions)) setHabitSuggestions(result.suggestions);
}

async function clearHabitSuggestions() {
  const previous = habitSuggestions.value.slice();
  habitSuggestions.value = [];
  const result = await Habits.clearChatBoxSuggestions();
  if (!result?.ok) {
    habitSuggestions.value = previous;
    habitError.value = formatHabitError(result?.message || '删除失败');
  }
}

function habitFailReason(result: Record<string, unknown> | null | undefined) {
  return String(
    result?.message
      || result?.error
      || (result?.reason === 'no-user'
        ? '未识别工号，请到设置填写'
        : '暂无建议语（需后端 DeepSeek Key，且至少 3 条聊天）'),
  );
}

async function maybeFillHabitSuggestion(options: {
  force?: boolean;
  refresh?: boolean;
  announce?: boolean;
} = {}) {
  try {
    const result = await Habits.fetchChatBoxSuggestion(Boolean(options.refresh));
    const incoming = Array.isArray(result?.suggestions) && result.suggestions.length
      ? result.suggestions
      : (result?.suggestion ? [{ id: 0, content: result.suggestion }] : []);
    if (incoming.length) {
      setHabitSuggestions(incoming);
      habitError.value = formatHabitError(String(result?.error || result?.message || ''));
      if (options.announce) {
        log.value = `${log.value}\n\n（已更新顶部快捷建议${result.cached ? '·缓存' : ''}，点击可填入）`;
      }
      return;
    }
    habitError.value = formatHabitError(habitFailReason(result));
    if (options.announce) {
      log.value = `${log.value}\n\n（习惯建议未更新：${habitFailReason(result)}）`;
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

function showTranscript(next: string) {
  transcript.value = next;
  log.value = next;
  scrollLog();
}

function appendAssistant(message: string) {
  showTranscript(`${transcript.value}\n助手：${message}`);
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
  showTranscript(`${transcript.value}\n\n我：${utterance}\n助手：正在思考…`);
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
    showTranscript(
      `${transcript.value.replace(/\n助手：正在思考…$/, '')}\n${response?.message || replyText}`,
    );
    input.value = '';
    if (response?.status === 'choose') {
      choices.value = Array.isArray(response.choices) ? response.choices : [];
    }
    const wantMinimize = response?.panelAction === 'minimize'
      || (Array.isArray(response?.actions) && response.actions.some((item: { type?: string }) => item?.type === 'panel_minimize'));
    if (wantMinimize) setOpen(false);
    applyConfirmUi(response);
    maybeFillHabitSuggestion({ announce: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行失败。';
    showTranscript(`${transcript.value.replace(/\n助手：正在思考…$/, '')}\n助手：${message}`);
    clearConfirm();
  } finally {
    running.value = false;
  }
}

async function pickChoice(item: ChoiceItem) {
  running.value = true;
  try {
    const opened = await openCandidate(item);
    appendAssistant(opened?.message || '已打开。');
    choices.value = [];
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
    appendAssistant(response?.message || '已提交。');
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
            :error="habitError"
            :disabled="habitLoading || running"
            @apply="applyHabitSuggestion"
            @dismiss="dismissHabitSuggestion"
            @clear="clearHabitSuggestions"
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
