// @ts-nocheck
/**
 * Content 编排入口：打开流程/菜单/待办、列表筛选、填表执行、聊天拆步、消息桥接。
 * 关窗逻辑见 shared/dialog-dismiss；Agent 工具见 shared/tools。
 */
import * as Match from '@/shared/match';
import * as Intent from '@/shared/intent';
import * as Leave from '@/shared/leave';
import * as Habits from '@/shared/habits';
import * as TaskPlan from '@/shared/taskplan';
import { MSG } from '@/shared/types';
import { listBlockingDialogs } from '@/shared/dialog-dismiss';
import { loadRowsFromTable } from './runner/page-table';
import {
  describe,
  formatChooseMessage,
  askDeepSeek,
  openCandidate,
  openWorkflowRow,
  openWorkflowByUtterance,
  openMenuByUtterance,
  collectCandidates,
  suppressAutoOpenFromUrl,
} from './runner/navigation';
import { runLeaveAgent, confirmLeaveSubmit } from './runner/leave-flow';
import { loadAiSettings, askDeepSeekChat } from './runner/ai-chat';
import {
  planAndRunUtterance,
  executeChatActions,
  collectPageRaw,
} from './runner/chat-executor';
import { readVisibleGridRows } from './runner/todo-approve';

export {
  handleUtterance,
  confirmLeaveSubmit,
  openCandidate,
  suppressAutoOpenFromUrl,
  resumeWaitingTasks,
};

async function handleUtterance(utterance, options) {
  if (location.hash.startsWith('#/login') || document.querySelector('input[placeholder="请输入密码"]')) {
    return { status: 'login', message: describe({ status: 'login' }), choices: [] };
  }

  const settings = await loadAiSettings();
  const aiReady = Boolean(settings && settings.enabled && settings.hasKey);
  const habitSettings = await Habits.loadHabitSettings();
  const serverPlanReady = Boolean(habitSettings && habitSettings.habitEnabled && habitSettings.habitBackendUrl);

  // Nest 规划 或 扩展 DeepSeek：拆步 →（入库）→ 逐步执行 → 失败再 Act
  if (serverPlanReady || aiReady) {
    try {
      return await planAndRunUtterance(utterance, options);
    } catch (error) {
      const fallbackNote = `（智能规划失败：${error.message || '调用失败'}，已改用本地处理）`;
      if (Leave.looksLikeLeaveTask(utterance)) {
        const local = await runLeaveAgent(utterance);
        return { ...local, message: `${local.message}\n${fallbackNote}` };
      }
    }
  }

  // 未配置 AI：请假填表走本地 Agent
  if (Leave.looksLikeLeaveTask(utterance)) {
    return runLeaveAgent(utterance);
  }

  const scope = Intent.detectScope(utterance, settings || {});

  // 明确打开流程：本地唯一命中则直接打开，不混菜单。
  if (scope === 'workflow') {
    const rows = await loadRowsFromTable();
    const local = Match.matchWorkflows(utterance, rows);
    if (local.status === 'open') {
      const opened = await openWorkflowRow(local.matches[0]);
      return { ...opened, choices: [] };
    }
    if (local.status === 'choose') {
      return {
        status: 'choose',
        message: `匹配到多条流程，请说得更具体：\n${local.matches.map((item) => `- ${item.name}（${item.code}）`).join('\n')}`,
        choices: local.matches.map((item) => ({
          type: 'workflow',
          id: `workflow:${item.code}`,
          title: item.name,
          subtitle: item.code,
          code: item.code,
          name: item.name,
          theme: item.theme,
          rowIndex: item.rowIndex,
        })),
      };
    }
    if (local.status === 'disabled') {
      return { status: 'disabled', message: describe(local), choices: [] };
    }
  }

  // 菜单：模糊搜侧栏（含嵌套路径），必要时再问 DeepSeek
  if (scope === 'menu') {
    return openMenuByUtterance(utterance);
  }

  if (!aiReady) {
    const fallback = await openWorkflowByUtterance(utterance);
    return { ...fallback, choices: fallback.matches || [] };
  }

  const candidates = await collectCandidates(scope);
  if (!candidates.length) {
    return { status: 'none', message: '当前范围没有可搜索的内容。', choices: [] };
  }

  let decision;
  try {
    decision = await askDeepSeek(utterance, scope, candidates);
  } catch (error) {
    const fallback = await openWorkflowByUtterance(utterance);
    return {
      ...fallback,
      message: `${fallback.message}\n（DeepSeek 未成功：${error.message || '调用失败'}）`,
      choices: fallback.matches || [],
    };
  }

  if (decision.decision === 'open') {
    const hit = Intent.findById(candidates, decision.id);
    const opened = await openCandidate(hit);
    return { ...opened, choices: [] };
  }
  if (decision.decision === 'choose') {
    const choices = (decision.candidates || []).map((item) => {
      const full = Intent.findById(candidates, item.id) || item;
      return full;
    });
    return {
      status: 'choose',
      message: formatChooseMessage({ candidates: choices }),
      choices,
    };
  }
  return {
    status: 'none',
    message: decision.reason || '没有找到合适的流程、菜单或待办。',
    choices: [],
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MSG.run) return false;
  handleUtterance(message.utterance || '')
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({
      status: 'error',
      message: error && error.message ? error.message : '执行失败。',
    }));
  return true;
});

async function resumeWaitingTasks() {
  if (!Habits || typeof Habits.listWaitingTasks !== 'function') return { messages: [] };
  let listed = null;
  try {
    listed = await Habits.listWaitingTasks();
  } catch (error) {
    return { messages: [] };
  }
  const tasks = (listed && listed.tasks) || [];
  const due = tasks.filter((task) => TaskPlan.shouldResumeNow(task, new Date())).slice(0, 1);
  const messages = [];
  for (let i = 0; i < due.length; i += 1) {
    const task = due[i];
    if (listBlockingDialogs().length) {
      messages.push(`长期任务 #${task.runId} 仍在：${task.utterance}。当前有表单弹窗，先不打断。`);
      continue;
    }
    const pending = (task.steps || []).filter((step) => step.status === 'pending' || step.status === 'running');
    const steps = pending.length ? pending : [{ type: 'open_todo', query: '我的待办' }];
    const exec = await executeChatActions(steps, task.utterance || '', {
      runId: task.runId,
      history: [],
      analysis: null,
    });
    const page = collectPageRaw();
    const approved = Boolean(exec && exec.approved)
      || /列表已离开待办|完成「同意」|完成「驳回」/.test((exec && exec.message) || '');
    const gridText = readVisibleGridRows().map((row) => row.text).join('\n');
    const matched = TaskPlan.reminderMatched(task.utterance, `${(page && page.visibleText) || ''}\n${gridText}`);
    const needles = TaskPlan.reminderNeedles ? TaskPlan.reminderNeedles(task.utterance) : [];
    const stillPending = needles.length
      ? needles.some((needle) => readVisibleGridRows().some((row) => row.text.replace(/\s+/g, '').includes(needle)))
      : false;
    if (task.recurring) {
      await Habits.touchWaitingTask(task.runId);
      messages.push(`已查看长期任务 #${task.runId}：${task.utterance}\n${(exec && exec.message) || ''}`);
    } else if (approved || (matched && !stillPending)) {
      await Habits.finishWaitingTask(task.runId);
      messages.push(`长期任务 #${task.runId} 已完成：${task.utterance}\n${(exec && exec.message) || ''}`);
    } else {
      messages.push(`长期任务 #${task.runId} 还在等：${task.utterance}`);
    }
  }
  return { messages };
}
