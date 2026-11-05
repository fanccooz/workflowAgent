(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WaromAgent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_STEPS = 12;
  const MAX_REFLECT = 2;

  function createTask(utterance, options) {
    const opts = options || {};
    return {
      utterance: String(utterance || '').trim(),
      goal: opts.goal || 'leave.open_fill',
      status: 'running',
      step: 0,
      slots: {},
      filled: {},
      missing: [],
      confirmToken: null,
      lastMessage: '',
      history: [],
      reflectCount: 0,
    };
  }

  /** 哪些工具结果算可反思的失败（choose 交给用户点选，不算） */
  function isRecoverableFailure(toolName, result) {
    const res = result || {};
    if (toolName === 'goto_workflow_list') return !res.ok;
    if (toolName === 'open_workflow') {
      if (res.status === 'open' || res.status === 'choose') return false;
      return true;
    }
    if (toolName === 'ai_fill_form' || toolName === 'fill_leave_form') {
      if (res.ok === false) return true;
      // 模型给了值但页面一个都没吃进去
      if (Array.isArray(res.notStuck) && res.notStuck.length && (!res.filled || !Object.keys(res.filled).length)) {
        return true;
      }
      return false;
    }
    return false;
  }

  function stop(task, status, message) {
    task.status = status;
    task.lastMessage = message || '';
    return { type: 'stop', status, message: task.lastMessage };
  }

  function tool(name, args) {
    return { type: 'tool', name, args: args || {} };
  }

  /**
   * 根据当前观察决定下一步。observation 由 tools.observe_page 提供。
   */
  function nextAction(task, observation) {
    const obs = observation || {};
    if (!task || task.status !== 'running') {
      return stop(task || {}, task && task.status ? task.status : 'error', task && task.lastMessage);
    }
    if (task.step >= MAX_STEPS) {
      return stop(task, 'error', '步骤过多，已停止。请手动打开或重试。');
    }

    if (obs.login) {
      return stop(task, 'login', '请先在这个页面登录华荣照明信息平台。');
    }

    // 用户已确认提交
    if (task.confirmToken && task.awaitingSubmit) {
      if (obs.requiredReady === false) {
        return stop(task, 'missing', `还有必填未填：${(obs.missing || task.missing || []).join('、') || '未知'}`);
      }
      return tool('submit_workflow', { confirmToken: task.confirmToken });
    }

    if (!obs.onWorkflowList) {
      return tool('goto_workflow_list');
    }

    // 列表异常：先自动走 goto（内部会点「刷新列表」），超过次数再停
    if (obs.listLoadFailed && !obs.hasRows) {
      task.refreshCount = Number(task.refreshCount || 0) + 1;
      if (task.refreshCount > 2) {
        return stop(task, 'error', '流程定义列表仍加载异常。请手动点「刷新列表」后再发一次。');
      }
      return tool('goto_workflow_list');
    }

    if (!obs.launchDialogOpen) {
      return tool('open_workflow', {
        utterance: task.utterance,
        preferLeave: task.goal.indexOf('leave') === 0,
      });
    }

    // 弹窗已开：用 DeepSeek（或本地兜底）按页面字段拆解并回填
    if (!task.formFilled) {
      return tool('ai_fill_form', { utterance: task.utterance });
    }

    if (!task.requiredChecked) {
      return tool('check_required', { filled: task.filled });
    }

    task.awaitingSubmit = true;
    const missingLabel = (task.missingTitles && task.missingTitles.length)
      ? task.missingTitles.join('、')
      : (task.missing || []).join('、');
    return stop(
      task,
      'await_confirm',
      missingLabel
        ? `已打开请假草稿。页面上仍缺：${missingLabel}。请在弹窗里补全后再点「确认提交」。`
        : '已打开请假草稿。请确认无误后点「确认提交」。',
    );
  }

  function applyResult(task, toolName, result) {
    const res = result || {};
    task.step += 1;
    task.history.push({ tool: toolName, ok: Boolean(res.ok), message: res.message || '' });
    task.lastMessage = res.message || task.lastMessage;

    if (toolName === 'goto_workflow_list' && !res.ok) {
      task.status = 'error';
      return task;
    }

    if (toolName === 'open_workflow') {
      if (res.status === 'choose') {
        task.status = 'choose';
        task.choices = res.choices || res.matches || [];
        return task;
      }
      if (res.status === 'none' || res.status === 'disabled' || res.status === 'login') {
        task.status = res.status;
        return task;
      }
      if (!res.ok && res.status !== 'open') {
        task.status = 'error';
        return task;
      }
    }

    if (toolName === 'extract_leave_slots') {
      task.slotsExtracted = true;
      task.slots = res.slots || {};
    }

    if (toolName === 'fill_leave_form' || toolName === 'ai_fill_form') {
      task.slotsExtracted = true;
      task.formFilled = true;
      task.filled = res.filled || {};
      task.skipped = res.skipped || [];
      if (res.fills) task.slots = res.fills;
    }

    if (toolName === 'check_required') {
      task.requiredChecked = true;
      task.missing = res.missing || [];
      task.missingTitles = res.missingTitles || [];
      task.requiredReady = Boolean(res.ready);
      if (res.filled) task.filled = res.filled;
    }

    if (toolName === 'submit_workflow') {
      if (res.ok) {
        task.status = 'done';
        task.lastMessage = res.message || '已提交。';
      } else {
        task.status = 'error';
        task.lastMessage = res.message || '提交失败。';
      }
    }

    return task;
  }

  function acceptConfirm(task, token) {
    if (!task || task.status !== 'await_confirm') {
      return { ok: false, message: '当前不在确认提交状态。' };
    }
    if (!token) {
      return { ok: false, message: '缺少确认令牌。' };
    }
    task.confirmToken = String(token);
    task.status = 'running';
    task.awaitingSubmit = true;
    return { ok: true };
  }

  return {
    MAX_STEPS,
    MAX_REFLECT,
    createTask,
    nextAction,
    applyResult,
    acceptConfirm,
    isRecoverableFailure,
  };
});
