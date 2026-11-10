// @ts-nocheck

  const MAX_EXEC_STEPS = 12;
  const MAX_REPLANS = 1;

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

  /**
   * 失败后是否换成新计划。同一轮只重规划一次；新计划里丢掉提交点击。
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
    isSubmitClick,
    cleanPlanSteps,
    queueAfterFailure,
};
