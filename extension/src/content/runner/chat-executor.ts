// @ts-nocheck
import * as Intent from '@/shared/intent';
import * as FormFill from '@/shared/formfill';
import * as Habits from '@/shared/habits';
import * as TaskPlan from '@/shared/taskplan';
import * as FillLock from '@/shared/fill-lock';
import { MSG } from '@/shared/types';
import {
  delay,
  visibleDialogs,
} from '@/shared/dom';
import {
  listBlockingDialogs,
  listConfirmClosePrompts,
  ensureDialogsClosedForNavigation,
  resetCloseOnce,
} from '@/shared/dialog-dismiss';
import { runLeaveAgent } from './leave-flow';
import {
  openWorkflowByUtterance,
  aiOpenWorkflow,
  openMenuByUtterance,
  openCandidate,
} from './navigation';
import {
  applyListFilter,
  normalizeFilterKeyword,
  waitForListPageReady,
  clickUiByLabel,
} from './list-filter';
import { approveTodo } from './todo-approve';
import { askDeepSeekChat } from './ai-chat';

export async function executeChatAction(action, utterance, options) {
  const opts = options || {};
  const type = action && action.type ? action.type : 'none';
  const query = (action && action.query) || utterance;

  if (type === 'none') {
    return { status: 'chat', message: '', choices: [] };
  }

  // 模型显式关窗：关表单 → 确认关闭，不提交。
  if (type === 'close_dialog') {
    const closed = await ensureDialogsClosedForNavigation();
    if (closed && !listBlockingDialogs().length && !listConfirmClosePrompts().length) {
      return { status: 'closed', message: '已关闭流程弹窗（未提交任何内容）。', choices: [] };
    }
    if (listConfirmClosePrompts().length) {
      return {
        status: 'error',
        message: '已点取消，但确认关闭弹窗还在。请再说一次「关掉弹窗」，或手动点确定。',
        choices: [],
      };
    }
    return {
      status: 'error',
      message: '没能关掉流程弹窗。请手动点取消/关闭后再试，或再说一次「关掉弹窗」。',
      choices: [],
    };
  }

  // 只有明确离开当前表单时才关窗。打开/回填流程本身不在这里关，避免和回填打架。
  const leavesCurrentForm = [
    'open_menu',
    'open_todo',
    'approve_todo',
  ].includes(type);
  if (leavesCurrentForm) {
    const closed = await ensureDialogsClosedForNavigation();
    if (!closed && (listBlockingDialogs().length || listConfirmClosePrompts().length)) {
      return {
        status: 'error',
        message: '表单弹窗还开着，先关掉再进入其他页面。可再说「关掉弹窗」或「打开首页」。',
        choices: [],
      };
    }
  }

  if (type === 'leave.open_fill' || type === 'form.open_fill') {
    return runLeaveAgent(utterance, {
      goal: type,
      openQuery: query,
      analysis: opts.analysis || null,
    });
  }
  if (type === 'open_workflow') {
    // 优先用纠正后的 action.query；若仍空则回退用户原话，避免模型乱指流程名
    const openQuery = String(query || utterance || '').trim() || utterance;
    let opened = await openWorkflowByUtterance(openQuery);
    if (opened.status === 'none') {
      // 模型 query 仍没命中时，再用用户原话重试一次
      if (openQuery !== utterance) {
        opened = await openWorkflowByUtterance(utterance);
      }
    }
    if (opened.status === 'none') {
      const aiOpened = await aiOpenWorkflow(utterance);
      if (aiOpened) opened = aiOpened;
    }
    return { ...opened, choices: opened.choices || opened.matches || [] };
  }
  if (type === 'open_menu') {
    const opened = await openMenuByUtterance(query || utterance);
    if (opened && opened.status === 'open') await waitForListPageReady(10000);
    return { ...opened, choices: opened.choices || [] };
  }
  if (type === 'approve_todo') {
    return approveTodo(query, opts.analysis);
  }
  if (type === 'open_todo') {
    const opened = await openCandidate({
      type: 'todo',
      id: 'todo:entry',
      title: '我的待办',
    });
    if (opened && opened.status === 'open') {
      // 等列表页就绪，再给下一步通用筛选
      await waitForListPageReady(10000);
    }
    return { ...opened, choices: [] };
  }
  if (type === 'filter_list') {
    return applyListFilter(normalizeFilterKeyword(query, utterance), utterance);
  }
  if (type === 'click_ui') {
    const clickLabel = String(query || '').replace(/\s+/g, '');
    // 「取消/关闭」已由 intent 归一成 close_dialog；这里不再为普通点击抢先整窗关掉
    const isFooterClose = /^(取消|关闭)$/.test(clickLabel);
    if (
      !isFooterClose
      && listBlockingDialogs().length
      && !FillLock.isFormFillActive()
      && !/草稿|确定|确认|保存|查询|搜索|重置|新建/.test(clickLabel)
    ) {
      // 点击侧栏/页面其它控件前，挡路表单先关
      const closed = await ensureDialogsClosedForNavigation();
      if (!closed && listBlockingDialogs().length) {
        return {
          status: 'error',
          message: '表单弹窗挡着，点不到。请先说「关掉弹窗」。',
          choices: [],
        };
      }
    }
    return clickUiByLabel(query, utterance);
  }
  if (type === 'panel_minimize') {
    return {
      status: 'panel',
      message: '已最小化流程助手。',
      panelAction: 'minimize',
      choices: [],
    };
  }
  return { status: 'chat', message: '', choices: [] };
}

/** 只采页面原文快照；摘要字段由 DeepSeek 自行设定 */
export function collectPageRaw() {
  const dialogs = visibleDialogs();
  const blocking = listBlockingDialogs();
  const confirms = listConfirmClosePrompts();
  const dialogText = dialogs
    .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1500);
  const visibleText = String(document.body && document.body.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
  return {
    title: document.title || '',
    url: location.href || '',
    hash: location.hash || '',
    path: location.pathname || '',
    hasDialog: dialogs.length > 0,
    hasBlockingDialog: blocking.length > 0,
    blockingDialogCount: blocking.length,
    hasConfirmClose: confirms.length > 0,
    dialogText: dialogText || '',
    visibleText,
  };
}

export function stepLooksFailed(result) {
  if (!result) return true;
  return result.status === 'error' || result.status === 'none' || result.status === 'disabled';
}

export async function replanRemaining(utterance, failedAction, errorMessage, history, pageRaw) {
  const failed = failedAction || { type: '', query: '' };
  const response = await chrome.runtime.sendMessage({
    type: MSG.aiChat,
    utterance: [
      `原任务：${utterance}`,
      `刚失败的步骤：${failed.type || ''} ${failed.query || ''}`.trim(),
      `失败原因：${errorMessage || '未知'}`,
      '请只规划还没做完的步骤，不要重复已成功的步骤，不要点击提交。',
      pageRaw && pageRaw.hasBlockingDialog
        ? '当前有挡路流程弹窗：需要换页时先 close_dialog，再 open_menu/open_todo/open_workflow。'
        : '',
      pageRaw && pageRaw.hasConfirmClose
        ? '确认关闭弹窗还在：优先再执行一次 close_dialog。'
        : '',
    ].filter(Boolean).join('\n'),
    history: Array.isArray(history) ? history : [],
    pageSummary: pageRaw || null,
  });
  if (!response || !response.ok) {
    throw new Error((response && response.message) || '重新规划失败');
  }
  const raw = String(response.content || '').trim();
  let parsed;
  try {
    parsed = Intent.parseModelJson(raw);
  } catch (error) {
    parsed = { reply: raw, actions: [] };
  }
  const chat = Intent.sanitizeChatAction(parsed, utterance);
  return {
    reply: chat.reply || '',
    steps: TaskPlan.cleanPlanSteps(chat.actions),
    analysis: {
      reply: chat.reply || '',
      summary: chat.summary && typeof chat.summary === 'object' ? chat.summary : null,
      form: FormFill.fillsFromSummary(chat.summary),
    },
  };
}

export async function executeChatActions(actions, utterance, options) {
  const opts = options || {};
  const runId = opts.runId;
  const history = Array.isArray(opts.history) ? opts.history : [];
  let analysis = opts.analysis || null;
  const list = Array.isArray(actions) && actions.length
    ? actions
    : [{ type: 'none', query: '' }];
  let queue = TaskPlan.cleanPlanSteps(list);
  const stepMessages = [];
  let last = { status: 'chat', message: '', choices: [] };
  let executed = 0;
  let replans = 0;
  let sameRetries = 0;

  if (runId && Habits) {
    Habits.startTaskRun(runId).catch(() => {});
  }

  while (queue.length && executed < TaskPlan.MAX_EXEC_STEPS) {
    const action = queue.shift();
    const seq = action.seq != null ? Number(action.seq) : executed + 1;
    executed += 1;

    if (runId && Habits) {
      Habits.reportStep(runId, seq, 'running', '', false).catch(() => {});
    }

    last = await executeChatAction(action, utterance, { analysis });

    const blocked = last.status === 'choose' || last.status === 'login' || TaskPlan.isHardStop(last);
    if (stepLooksFailed(last) && !blocked && TaskPlan.shouldRetrySameStep(last, sameRetries)) {
      sameRetries += 1;
      queue.unshift(action);
      if (last && last.message) stepMessages.push(`重试：${last.message}`);
      continue;
    }
    if (stepLooksFailed(last) && !blocked) {
      sameRetries = 0;
      let replacement = [];
      let replanReply = '';
      if (replans < TaskPlan.MAX_REPLANS) {
        try {
          const planned = await replanRemaining(
            utterance,
            action,
            last.message || last.status,
            history,
            collectPageRaw(),
          );
          replacement = planned.steps || [];
          replanReply = planned.reply || '';
          if (planned.analysis && (planned.analysis.summary || (planned.analysis.form && Object.keys(planned.analysis.form).length))) {
            analysis = planned.analysis;
          }
        } catch (error) {
          replacement = [];
        }
        if (runId && Habits) {
          const stored = await Habits.replanTask(runId, {
            failedSeq: seq,
            lastError: last.message || last.status,
            pageSummary: collectPageRaw(),
            history,
            steps: replacement,
          });
          if (stored && Array.isArray(stored.steps) && stored.steps.length) {
            replacement = stored.steps;
          }
          if (!replanReply && stored && stored.reply) replanReply = stored.reply;
        }
      }
      const decision = TaskPlan.queueAfterFailure(replacement, replans);
      if (runId && Habits) {
        await Habits.reportStep(runId, seq, 'failed', last.message || '', decision.stop);
      }
      if (last && last.message) stepMessages.push(last.message);
      if (!decision.stop) {
        replans += 1;
        queue = decision.queue;
        stepMessages.push(replanReply ? `重新规划：${replanReply}` : '已按新计划继续。');
        continue;
      }
      break;
    }

    if (last && last.message) stepMessages.push(last.message);

    const stepStatus = blocked ? 'failed' : 'done';
    const isLast = queue.length === 0 || stepStatus === 'failed';
    if (runId && Habits) {
      Habits.reportStep(runId, seq, stepStatus, last.message || '', isLast).catch(() => {});
    }

    sameRetries = 0;
    if (stepStatus === 'failed') break;
    if (queue.length && ['open_todo', 'open_menu', 'open_workflow'].includes(action.type)) {
      await delay(2000);
    }
  }

  if (!stepMessages.length && last.status === 'chat') {
    return last;
  }
  return {
    ...last,
    message: stepMessages.join('\n'),
    stepMessages,
    choices: last.choices || [],
    runId: runId || null,
  };
}

export function formatChatResult(reply, exec) {
  const lines = [`助手：${reply || ''}`];
  if (exec && exec.runId) {
    lines.push(`任务 #${exec.runId}`);
  }
  const steps = exec && Array.isArray(exec.stepMessages) && exec.stepMessages.length
    ? exec.stepMessages
    : (exec && exec.message ? [exec.message] : []);
  if (steps.length) {
    lines.push('', '执行：');
    steps.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }
  return lines.join('\n');
}

export function filterActionableSteps(actions) {
  return (actions || []).filter((item) => item && item.type && item.type !== 'none');
}

/**
 * 对话框主路径：DeepSeek 拆成步骤并入库，再按库里的顺序执行。
 * 某步失败时重新规划剩余步骤，替换未执行的尾部，最多重规划一次。
 */
export async function planAndRunUtterance(utterance, options) {
  resetCloseOnce();
  let reply = '';
  let actions = [];
  let runId = null;
  let plannedVia = 'extension';
  const history = options && Array.isArray(options.history) ? options.history : [];
  const pageRaw = collectPageRaw();
  // Nest / 失败补救用：优先模型自设 summary，否则退回原文快照
  let pageSummary = pageRaw;

  let chatOk = false;
  let chatError = '';
  let analysis = null;
  try {
    const chat = await askDeepSeekChat(utterance, history, pageRaw);
    reply = chat.reply || '';
    actions = chat.actions && chat.actions.length ? chat.actions : [chat.action];
    analysis = {
      reply,
      summary: chat.summary && typeof chat.summary === 'object' ? chat.summary : null,
      form: FormFill.fillsFromSummary(chat.summary),
    };
    if (chat.summary && typeof chat.summary === 'object') {
      pageSummary = chat.summary;
    }
    plannedVia = 'extension';
    chatOk = true;
  } catch (error) {
    chatError = error && error.message ? String(error.message) : '对话失败';
    reply = '';
    actions = [];
  }

  // 扩展对话失败时，再退回 Nest 规划（带 history + 页面原文）
  if (!chatOk && Habits) {
    try {
      const planned = await Habits.planTask(utterance, { history, pageSummary: pageRaw });
      if (planned && planned.ok) {
        reply = planned.reply || reply;
        runId = planned.runId || null;
        plannedVia = 'server';
        if (Array.isArray(planned.steps) && planned.steps.length) {
          actions = planned.steps.map((step) => ({
            type: step.type,
            query: step.query || '',
            seq: step.seq,
          }));
        } else {
          actions = [];
        }
        chatOk = true;
      }
    } catch (error) {
      if (!reply) {
        const nestMsg = error && error.message ? String(error.message) : '规划失败';
        throw new Error(chatError ? `${chatError}；Nest：${nestMsg}` : nestMsg);
      }
    }
  }

  if (!chatOk && !reply) {
    throw new Error(
      chatError
        || 'DeepSeek 对话失败。请检查扩展选项里的 API Key，并重新加载扩展。',
    );
  }

  let actionable = filterActionableSteps(actions);
  const horizon = TaskPlan.classifyTaskHorizon(utterance);
  if (horizon.durable) {
    const remembered = actionable.length ? actionable : [{ type: 'open_todo', query: '我的待办' }];
    let savedId = null;
    if (Habits) {
      try {
        const saved = await Habits.saveTaskPlan(utterance, reply, remembered, horizon);
        if (saved && saved.ok) savedId = saved.runId;
      } catch (error) {
        savedId = null;
      }
    }
    const note = savedId
      ? `已记为长期任务 #${savedId}。${horizon.waitNote}。下次打开助手会继续查看。`
      : `这句话要事后再做。${horizon.waitNote}。当前没能写入任务库，请确认工号和 Nest 已启动。`;
    return {
      status: 'chat',
      message: `助手：${reply || '好的。'}\n\n${note}`,
      reply: reply || '好的。',
      action: remembered[0],
      actions: remembered,
      plannedVia,
      choices: [],
      runId: savedId,
    };
  }

  if (!actionable.length) {
    return {
      status: 'chat',
      message: `助手：${reply || '请再说清楚一点。'}`,
      reply: reply || '请再说清楚一点。',
      action: { type: 'none', query: '' },
      actions: [],
      plannedVia,
      choices: [],
      runId: runId || null,
    };
  }

  // 入库不能挡住点页面。库正常时几百毫秒内拿到编号；被占用时先按内存步骤执行。
  if (!runId && Habits && actionable.length) {
    const pending = Habits.saveTaskPlan(utterance, reply, actionable).catch(() => null);
    const saved = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve(null), 400)),
    ]);
    if (saved && saved.ok && saved.runId) {
      runId = saved.runId;
      if (Array.isArray(saved.steps) && saved.steps.length) {
        actionable = saved.steps.map((step) => ({
          type: step.type,
          query: step.query || '',
          seq: step.seq,
        }));
      }
      plannedVia = 'extension+server';
    }
  }

  const exec = await executeChatActions(actionable, utterance, { runId, history, analysis });
  return {
    ...exec,
    status: exec.status === 'chat' ? 'chat' : exec.status,
    message: formatChatResult(reply, exec),
    reply,
    action: actionable[0] || { type: 'none', query: '' },
    actions: actionable,
    plannedVia,
    choices: exec.choices || [],
    requiredReady: exec.requiredReady,
    missing: exec.missing || [],
    missingTitles: exec.missingTitles || [],
    filled: exec.filled || {},
    runId: exec.runId || runId,
  };
}
