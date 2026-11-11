// @ts-nocheck

  const MAX_EXEC_STEPS = 12;
  const MAX_REPLANS = 4;
  const MAX_SAME_STEP_RETRIES = 2;
  const RECURRING_GAP_MS = 12 * 60 * 60 * 1000;

  function isSubmitClick(step) {
    const query = String((step && step.query) || '');
    return step && step.type === 'click_ui' && /提交/.test(query) && !/不提交/.test(query);
  }

  function cleanPlanSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (!item || !item.type || item.type === 'none') continue;
      if (isSubmitClick(item)) continue;
      const next = {
        type: item.type,
        query: String(item.query || ''),
      };
      if (item.seq != null && item.seq !== '') next.seq = Number(item.seq);
      out.push(next);
    }
    return out;
  }

  function isHardStop(result) {
    if (!result) return false;
    if (result.status === 'login' || result.status === 'choose') return true;
    const message = String(result.message || '');
    return /手动点击「提交」|我不会代为提交|必须手动/.test(message);
  }

  /** 登录、待选择、必须手动提交时不再重试。其余失败先重做当前步。 */
  function shouldRetrySameStep(result, retries) {
    if (Number(retries || 0) >= MAX_SAME_STEP_RETRIES) return false;
    if (!result || isHardStop(result)) return false;
    return result.status === 'error' || result.status === 'none' || result.status === 'disabled';
  }

  function parseApprovalQuery(query) {
    const text = String(query || '').replace(/\s+/g, '');
    const decision = /驳回|拒绝|不同意/.test(text) ? '驳回' : '同意';
    const keyword = text
      .replace(/待办里|待办|待审|待我|审批|帮我|请你|把|一下|点击|处理|打开/g, '')
      .replace(/同意|驳回|拒绝|通过|不同意/g, '')
      .trim();
    return { decision, keyword };
  }

  function classifyTaskHorizon(utterance) {
    const text = String(utterance || '').replace(/\s+/g, '');
    const recurring = /每天|每周|定时/.test(text);
    const later = /之后|以后|等.{0,8}后|批下来|通过后|明天再|下次/.test(text) || recurring;
    const follow = /告诉|提醒|通知|看待办|再看|跟进|继续|看看/.test(text);
    if (later && follow) {
      return {
        durable: true,
        recurring,
        waitNote: recurring ? '按周期继续查看' : '等到条件满足后再继续',
      };
    }
    return { durable: false, recurring: false, waitNote: '' };
  }

  function reminderNeedles(utterance) {
    const text = String(utterance || '');
    const quoted = text.match(/[「『"]([^」』"]{1,20})[」』"]/);
    if (quoted && quoted[1]) return [quoted[1].replace(/\s+/g, '')];
    const cleaned = text
      .replace(/批下来|通过后|之后|以后|告诉我|提醒我|通知我|帮我|请你|每天|每周|待办里|待办|再看看|看看|查看|跟进|继续|一下/g, '')
      .replace(/\s+/g, '');
    return cleaned.length >= 2 ? [cleaned.slice(0, 16)] : [];
  }

  function reminderMatched(utterance, pageText) {
    const needles = reminderNeedles(utterance);
    const page = String(pageText || '').replace(/\s+/g, '');
    if (!needles.length || !page) return false;
    return needles.some((item) => page.includes(item));
  }

  /**
   * 审批是否真正离开待办：原行消失，或同行状态变成已办/已同意/已驳回。
   * rows 是页面上当前可见行的文案数组。
   */
  function approvalSettled(beforeText, afterRows, keyword, decision) {
    const before = String(beforeText || '').replace(/\s+/g, '');
    const key = String(keyword || '').replace(/\s+/g, '');
    const rows = (Array.isArray(afterRows) ? afterRows : [])
      .map((item) => String(item || '').replace(/\s+/g, ''))
      .filter(Boolean);
    if (!before && !key) return false;
    const stillSame = before
      ? rows.some((row) => row === before)
      : rows.some((row) => row.includes(key));
    if (!stillSame) return true;
    const doneWord = /驳回|拒绝|不同意/.test(String(decision || ''))
      ? /已驳回|驳回|拒绝/
      : /已同意|已通过|已办|同意|通过/;
    const matched = before
      ? rows.filter((row) => row === before || (key && row.includes(key)))
      : rows.filter((row) => key && row.includes(key));
    return matched.some((row) => doneWord.test(row) && !/待办|待审|待我/.test(row));
  }

  function shouldResumeNow(task, now) {
    if (!task || task.status !== 'waiting') return false;
    if (!task.recurring) return true;
    const updated = Date.parse(String(task.updatedAt || '').replace(' ', 'T'));
    if (!Number.isFinite(updated)) return true;
    const clock = now instanceof Date ? now : new Date();
    return clock.getTime() - updated >= RECURRING_GAP_MS;
  }

  /**
   * 失败后换成剩余步骤。同一轮最多重规划数次；新计划里丢掉提交点击。
   */
  function queueAfterFailure(replacement, replansUsed, maxReplans) {
    const limit = maxReplans == null ? MAX_REPLANS : maxReplans;
    if (Number(replansUsed || 0) >= limit) {
      return { queue: [], replanned: false, stop: true };
    }
    const queue = cleanPlanSteps(replacement);
    if (!queue.length) return { queue: [], replanned: false, stop: true };
    return { queue, replanned: true, stop: false };
  }

export {
MAX_EXEC_STEPS,
    MAX_REPLANS,
    MAX_SAME_STEP_RETRIES,
    isSubmitClick,
    isHardStop,
    shouldRetrySameStep,
    cleanPlanSteps,
    queueAfterFailure,
    parseApprovalQuery,
    classifyTaskHorizon,
    reminderNeedles,
    reminderMatched,
    approvalSettled,
    shouldResumeNow,
};
