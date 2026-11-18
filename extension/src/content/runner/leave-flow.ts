// @ts-nocheck
/**
 * 打开流程 + 回填：线性流水线（无嵌套 Agent 状态机）。
 * 规划由外环 native tool calling 负责；这里只做页面动作。
 */
import * as Intent from '@/shared/intent';
import * as Tools from '@/shared/tools';
import { MSG } from '@/shared/types';
import { openWorkflowByUtterance, aiOpenWorkflow } from './navigation';

function dialogMatchesTarget(observation, openQuery) {
  const obs = observation || {};
  if (!obs.launchDialogOpen) return true;
  const text = String(obs.launchDialogText || '').replace(/\s+/g, '');
  const query = String(openQuery || '').replace(/\s+/g, '');
  if (!query || !text) return true;
  const core = query.replace(/(流程|申请)$/g, '');
  if (!core || core.length < 2) return true;
  return text.includes(query) || text.includes(core);
}

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

function buildHelpers(utterance, analysis) {
  return {
    openWorkflowByUtterance,
    aiOpenWorkflow,
    aiPlanFill: (text, fields) => aiPlanFill(text, fields, analysis),
    analysis: analysis || null,
  };
}

/**
 * 线性：必要时进流程列表 → 打开流程 → AI 回填 → 检查必填。
 * 不提交。失败时外环模型可根据返回信息再调工具。
 */
export async function openAndFill(utterance, options) {
  const opts = options || {};
  const analysis = opts.analysis || null;
  const openQuery = String(opts.openQuery || '').trim();
  const preferLeave = String(opts.goal || '').indexOf('leave') === 0
    || /请假/.test(String(utterance || ''))
    || /请假/.test(openQuery);
  const helpers = buildHelpers(utterance, analysis);
  const steps = [];

  let observed = await Tools.runTool('observe_page', {}, helpers);
  let obs = (observed && observed.observation) || {};

  if (obs.login) {
    return {
      status: 'login',
      message: '请先在这个页面登录华荣照明信息平台。',
      choices: [],
      requiredReady: false,
      missing: [],
      missingTitles: [],
      filled: {},
    };
  }

  const needOpen = !obs.launchDialogOpen || !dialogMatchesTarget(obs, openQuery);
  if (needOpen) {
    if (!obs.onWorkflowList) {
      const listed = await Tools.runTool('goto_workflow_list', {}, helpers);
      steps.push(`${listed.ok ? '✓' : '✗'} 进入流程定义${listed.message ? `：${listed.message}` : ''}`);
      if (!listed.ok) {
        return {
          status: 'error',
          message: [listed.message || '进不了流程定义。', steps.join('\n')].filter(Boolean).join('\n\n'),
          choices: [],
          requiredReady: false,
          missing: [],
          missingTitles: [],
          filled: {},
        };
      }
    }

    let opened = await Tools.runTool('open_workflow', {
      utterance,
      query: openQuery || undefined,
      preferLeave,
    }, helpers);
    steps.push(`${opened.ok ? '✓' : '✗'} 打开流程${opened.message ? `：${opened.message}` : ''}`);

    // 简单重试一次（短词），替代原 Agent 反思环
    if (!opened.ok && opened.status !== 'choose' && openQuery) {
      const shortQuery = openQuery.replace(/(流程|申请|通用)$/g, '').trim() || (preferLeave ? '请假' : openQuery);
      if (shortQuery !== openQuery) {
        opened = await Tools.runTool('open_workflow', {
          utterance,
          query: shortQuery,
          preferLeave,
        }, helpers);
        steps.push(`${opened.ok ? '✓' : '✗'} 重试打开（${shortQuery}）${opened.message ? `：${opened.message}` : ''}`);
      }
    }

    if (opened.status === 'choose' || (opened.choices && opened.choices.length > 1 && !opened.ok)) {
      return {
        status: 'choose',
        message: [opened.message || '匹配到多条，请选一项。', steps.join('\n')].filter(Boolean).join('\n\n'),
        choices: opened.choices || opened.matches || [],
        requiredReady: false,
        missing: [],
        missingTitles: [],
        filled: {},
      };
    }

    if (!opened.ok) {
      return {
        status: opened.status || 'error',
        message: [opened.message || '打不开流程。', steps.join('\n')].filter(Boolean).join('\n\n'),
        choices: opened.choices || [],
        requiredReady: false,
        missing: [],
        missingTitles: [],
        filled: {},
      };
    }
  }

  const filled = await Tools.runTool('ai_fill_form', { utterance }, helpers);
  steps.push(`${filled.ok ? '✓' : '✗'} 回填${filled.message ? `：${filled.message}` : ''}`);

  const check = Tools.checkRequired();
  const missingTitles = check.missingTitles || check.missing || [];
  const note = missingTitles.length
    ? `已按打开后的表单分析回填，未提交。仍缺：${missingTitles.join('、')}。`
    : '已按打开后的表单分析回填，未提交。请手动点「提交」。';

  return {
    status: filled.ok === false ? 'error' : 'filled',
    message: [note, steps.join('\n')].filter(Boolean).join('\n\n'),
    choices: [],
    requiredReady: Boolean(check.ready),
    missing: check.missing || [],
    missingTitles,
    filled: filled.filled || check.filled || {},
  };
}

/** @deprecated 与 openAndFill 相同，保留给无 AI 本地入口 */
export async function runLeaveAgent(utterance, options) {
  return openAndFill(utterance, {
    ...(options || {}),
    goal: (options && options.goal) || 'leave.open_fill',
  });
}

/** 提交必须用户手点；此接口仅兼容旧面板按钮 */
export async function confirmLeaveSubmit() {
  return {
    status: 'error',
    message: '流程提交必须在弹窗里手动点「提交」，助手不会代为提交。',
  };
}
