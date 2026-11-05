(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WaromLeaveSkill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 第一期必填：与真实请假弹窗对齐前先用常见三项；后续只改这里。
  const REQUIRED_FIELDS = ['startDate', 'endDate', 'reason'];

  const FIELD_LABELS = {
    startDate: ['开始日期', '开始时间', '请假开始', '开始', '起始日期', '请假时间'],
    endDate: ['结束日期', '结束时间', '请假结束', '结束', '截止日期'],
    reason: ['事由', '请假事由', '请假原因', '原因说明', '申请事由'],
    leaveType: ['请假类型', '假种', '类型'],
  };

  const FIELD_TITLES = {
    startDate: '开始日期',
    endDate: '结束日期',
    reason: '事由',
    leaveType: '请假类型',
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(base, days) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  function parseRelativeDate(text, now) {
    const base = now instanceof Date ? now : new Date();
    if (/今天|今日/.test(text)) return formatDate(base);
    if (/明天|明日/.test(text)) return formatDate(addDays(base, 1));
    if (/后天/.test(text)) return formatDate(addDays(base, 2));
    if (/大后天/.test(text)) return formatDate(addDays(base, 3));
    const m = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    const m2 = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (m2) {
      return `${base.getFullYear()}-${pad(m2[1])}-${pad(m2[2])}`;
    }
    return '';
  }

  function extractReason(utterance) {
    const text = String(utterance || '');
    const m = text.match(/(?:事由|原因|因为|为了)[:：\s]*([^\s，,。]{1,40})/);
    if (m) return m[1].trim();
    const m2 = text.match(/，\s*([^，,]{2,40})$/);
    if (m2 && !/(明天|后天|今天|请假|打开)/.test(m2[1])) return m2[1].trim();
    return '';
  }

  /**
   * 从原话抽槽；抽不到则空字符串。不追问。
   * 支持：「明天到后天」「明天～后天」「从明天到后天」
   */
  function extractSlots(utterance, now) {
    const text = String(utterance || '').replace(/\s+/g, '');
    const slots = {
      startDate: '',
      endDate: '',
      reason: '',
      leaveType: '',
    };

    const range = text.match(/(今天|今日|明天|明日|后天|大后天|.+?)(?:到|至|~|～|-|—)(今天|今日|明天|明日|后天|大后天|\d{1,2}月\d{1,2}日|\d{4}[年/-]\d{1,2}[月/-]\d{1,2})/);
    if (range) {
      slots.startDate = parseRelativeDate(range[1], now) || parseRelativeDate(range[0], now);
      slots.endDate = parseRelativeDate(range[2], now);
    } else {
      const one = parseRelativeDate(text, now);
      if (one) {
        slots.startDate = one;
        slots.endDate = one;
      }
    }

    // 「明天到后天」：range 的 group1 可能是「明天」
    if (/明天到后天|明天至后天|明天~后天|明天～后天/.test(text)) {
      const base = now instanceof Date ? now : new Date();
      slots.startDate = formatDate(addDays(base, 1));
      slots.endDate = formatDate(addDays(base, 2));
    }

    slots.reason = extractReason(utterance);
    if (!slots.reason && /开会/.test(text)) slots.reason = '开会';

    return slots;
  }

  function labelsFor(field) {
    return FIELD_LABELS[field] || [];
  }

  function isReady(filled) {
    const missing = REQUIRED_FIELDS.filter((key) => !filled || !String(filled[key] || '').trim());
    return { ready: missing.length === 0, missing };
  }

  function missingTitles(missing) {
    return (missing || []).map((key) => FIELD_TITLES[key] || key);
  }

  function looksLikeLeaveTask(utterance) {
    const text = String(utterance || '');
    if (!/请假/.test(text)) return false;
    return /明天|后天|今天|事由|开会|到|至|\d+月\d+日/.test(text) || /帮我请假|请个假|请假，/.test(text);
  }

  return {
    REQUIRED_FIELDS,
    FIELD_LABELS,
    FIELD_TITLES,
    extractSlots,
    labelsFor,
    isReady,
    missingTitles,
    looksLikeLeaveTask,
    formatDate,
  };
});
