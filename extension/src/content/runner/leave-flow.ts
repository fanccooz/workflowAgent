// @ts-nocheck
import * as Intent from '@/shared/intent';
import * as Agent from '@/shared/agent';
import * as Tools from '@/shared/tools';
import { MSG } from '@/shared/types';
import { openWorkflowByUtterance, aiOpenWorkflow } from './navigation';

let activeLeaveTask = null;

export async function aiPlanFill(utterance, fields, analysis) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const response = await chrome.runtime.sendMessage({
    type: MSG.aiFillForm,
    utterance,
    fields,
    today: `${yyyy}-${mm}-${dd}`,
    analysis: analysis || null,
  });
  if (!response || !response.ok) {
    throw new Error((response && response.message) || '填表推理失败');
  }
  const parsed = Intent.parseModelJson(response.content);
  const labels = (fields || []).map((item) => item.label);
  return Intent.sanitizeFillMap(parsed, labels);
}

export async function aiReflect(payload) {
  const response = await chrome.runtime.sendMessage({
    type: MSG.aiReflect,
    payload: payload || {},
  });
  if (!response || !response.ok) {
    throw new Error((response && response.message) || '反思失败');
  }
  const parsed = Intent.parseModelJson(response.content);
  return Intent.sanitizeReflect(parsed);
}

export async function runLeaveAgent(utterance, options) {
  const opts = options || {};
  const analysis = opts.analysis || null;
  const task = Agent.createTask(utterance, {
    goal: opts.goal || 'form.open_fill',
    openQuery: opts.openQuery || '',
  });
  const helpers = {
    openWorkflowByUtterance,
    aiOpenWorkflow,
    aiPlanFill: (text, fields) => aiPlanFill(text, fields, analysis),
    aiReflect,
    analysis,
    confirmToken: null,
  };
  const { task: finished, log } = await Tools.runAgentLoop(task, helpers);
  activeLeaveTask = finished.status === 'await_confirm' ? finished : null;
  const steps = log.map((item) => {
    if (item.type === 'tool') return `${item.ok ? '✓' : '✗'} ${item.name}${item.message ? `：${item.message}` : ''}`;
    if (item.type === 'reflect') return `💭 ${item.message || '反思'}`;
    return item.message || item.status;
  }).join('\n');
  return {
    status: finished.status,
    message: [finished.lastMessage || '', steps].filter(Boolean).join('\n\n'),
    choices: finished.choices || [],
    leaveTask: finished.status === 'await_confirm' ? finished : null,
    requiredReady: Boolean(finished.requiredReady),
    missing: finished.missing || [],
    missingTitles: finished.missingTitles || [],
    filled: finished.filled || {},
  };
}

export async function confirmLeaveSubmit() {
  if (!activeLeaveTask || activeLeaveTask.status !== 'await_confirm') {
    return { status: 'error', message: '当前没有待确认的请假草稿。' };
  }
  const token = `confirm-${Date.now()}`;
  const accepted = Agent.acceptConfirm(activeLeaveTask, token);
  if (!accepted.ok) return { status: 'error', message: accepted.message };
  // 提交前再读页面（用户可能已手补缺项）
  const check = Tools.checkRequired();
  if (check.filled) activeLeaveTask.filled = check.filled;
  if (!check.ready) {
    activeLeaveTask.status = 'await_confirm';
    activeLeaveTask.confirmToken = null;
    activeLeaveTask.awaitingSubmit = false;
    return {
      status: 'missing',
      message: `还有必填未填：${(check.missingTitles || check.missing).join('、')}。请在弹窗补全后再确认。`,
      missing: check.missing,
      missingTitles: check.missingTitles || [],
    };
  }
  const result = await Tools.submitWorkflow(token, token);
  activeLeaveTask = null;
  return {
    status: result.ok ? 'done' : 'error',
    message: result.message,
  };
}
