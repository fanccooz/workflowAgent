// @ts-nocheck

  function normalizeUserId(value) {
    return String(value || '').trim().slice(0, 64);
  }

  function readWaromUserIdFromPage() {
    const selectors = [
      '.user-name',
      '.username',
      '.el-dropdown .el-dropdown-link',
      '.header-user',
      '[class*="userName"]',
      '[class*="user-info"]',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      const node = document.querySelector(selectors[i]);
      const text = node && (node.getAttribute('title') || node.textContent || '');
      const cleaned = String(text).replace(/\s+/g, ' ').trim();
      // 常见：张三(10001) / 工号：10001
      const m = cleaned.match(/[（(]?\s*(\d{4,12})\s*[)）]?/) || cleaned.match(/工号[:：]?\s*(\w+)/);
      if (m) return normalizeUserId(m[1]);
      if (/^[\w.-]{3,32}$/.test(cleaned) && !/设置|刷新|提交/.test(cleaned)) {
        return normalizeUserId(cleaned);
      }
    }

    const storageKeys = ['userId', 'empId', 'employeeId', 'staffId', 'waromUserId', 'userCode'];
    for (let s = 0; s < 2; s += 1) {
      const store = s === 0 ? localStorage : sessionStorage;
      for (let k = 0; k < storageKeys.length; k += 1) {
        try {
          const raw = store.getItem(storageKeys[k]);
          if (raw && String(raw).trim()) return normalizeUserId(raw);
        } catch (error) {
          // 忽略
        }
      }
    }

    try {
      const candidates = [
        root.__USER__,
        root.userInfo,
        root.currentUser,
        root.__INITIAL_STATE__ && root.__INITIAL_STATE__.user,
      ];
      for (let i = 0; i < candidates.length; i += 1) {
        const u = candidates[i];
        if (!u || typeof u !== 'object') continue;
        const id = u.empId || u.employeeId || u.userId || u.id || u.code || u.account;
        if (id) return normalizeUserId(id);
      }
    } catch (error) {
      // 忽略
    }
    return '';
  }

  async function loadHabitSettings() {
    const defaults = {
      habitBackendUrl: 'http://localhost:3000',
      habitExtensionToken: 'warom-dev-token',
      waromUserId: '',
      habitEnabled: true,
    };
    try {
      const stored = await chrome.storage.local.get(defaults);
      return { ...defaults, ...stored };
    } catch (error) {
      return defaults;
    }
  }

  async function resolveWaromUserId() {
    const settings = await loadHabitSettings();
    if (settings.waromUserId) return normalizeUserId(settings.waromUserId);
    return readWaromUserIdFromPage();
  }

  async function apiFetch(pathname, options) {
    const settings = await loadHabitSettings();
    if (!settings.habitEnabled) {
      throw new Error('习惯建议语未启用');
    }
    const base = String(settings.habitBackendUrl || '').replace(/\/$/, '');
    if (!base) {
      throw new Error('未配置习惯后端地址');
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    };
    if (settings.habitExtensionToken) {
      headers['X-Extension-Token'] = settings.habitExtensionToken;
    }
    const response = await fetch(`${base}${pathname}`, {
      method: (options && options.method) || 'GET',
      headers,
      body: options && options.body ? options.body : undefined,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload && (payload.message || payload.error) ? String(payload.message || payload.error) : '';
      } catch (error) {
        // 忽略
      }
      throw new Error(detail || `习惯服务 ${response.status}`);
    }
    return response.json();
  }

  async function reportChat(content, role) {
    const userId = await resolveWaromUserId();
    if (!userId) return { ok: false, skipped: true, reason: 'no-user' };
    if (!String(content || '').trim()) return { ok: false, skipped: true };
    try {
      await apiFetch('/api/events/chat', {
        method: 'POST',
        body: JSON.stringify({
          waromUserId: userId,
          content: String(content).trim().slice(0, 2000),
          role: role === 'assistant' ? 'assistant' : 'user',
        }),
      });
      return { ok: true, userId };
    } catch (error) {
      return { ok: false, message: error.message || '上报失败' };
    }
  }

  async function fetchChatBoxSuggestion(refresh) {
    const userId = await resolveWaromUserId();
    if (!userId) return { suggestion: '', skipped: true, reason: 'no-user', message: '未识别到华荣工号，请到设置里填写' };
    try {
      const q = new URLSearchParams({
        waromUserId: userId,
        ...(refresh ? { refresh: '1' } : {}),
      });
      const data = await apiFetch(`/api/suggestions/chat-box?${q.toString()}`);
      return {
        suggestion: data && data.suggestion ? String(data.suggestion) : '',
        cached: Boolean(data && data.cached),
        source: data && data.source,
        message: data && data.message ? String(data.message) : '',
        userId,
      };
    } catch (error) {
      return { suggestion: '', error: error.message || '拉取失败', message: error.message || '拉取失败' };
    }
  }

  /** DeepSeek 拆步并落库 */
  async function planTask(utterance) {
    const userId = await resolveWaromUserId();
    if (!userId) {
      return { ok: false, skipped: true, reason: 'no-user', message: '未识别到工号，请到设置里填写' };
    }
    const data = await apiFetch('/api/tasks/plan', {
      method: 'POST',
      body: JSON.stringify({
        waromUserId: userId,
        utterance: String(utterance || '').trim().slice(0, 2000),
      }),
    });
    return {
      ok: true,
      runId: data.runId,
      reply: data.reply || '',
      steps: Array.isArray(data.steps) ? data.steps : [],
      userId,
    };
  }

  async function startTaskRun(runId) {
    if (!runId) return { ok: false };
    try {
      await apiFetch(`/api/tasks/${runId}/start`, { method: 'POST', body: '{}' });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  async function reportStep(runId, seq, status, resultMessage, finalizeRun) {
    if (!runId || seq == null) return { ok: false };
    try {
      await apiFetch(`/api/tasks/${runId}/steps/${seq}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          resultMessage: String(resultMessage || '').slice(0, 2000),
          finalizeRun: Boolean(finalizeRun),
        }),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  /** 步骤失败后再问 DeepSeek */
  async function actOnFailedStep(runId, seq, lastError, pageSummary) {
    if (!runId || seq == null) return null;
    try {
      return await apiFetch(`/api/tasks/${runId}/steps/${seq}/act`, {
        method: 'POST',
        body: JSON.stringify({
          lastError: String(lastError || '').slice(0, 1000),
          pageSummary: pageSummary || {},
        }),
      });
    } catch (error) {
      return { decision: 'ask_user', message: error.message || '补救建议失败' };
    }
  }

export {
resolveWaromUserId,
    readWaromUserIdFromPage,
    reportChat,
    fetchChatBoxSuggestion,
    planTask,
    startTaskRun,
    reportStep,
    actOnFailedStep,
    loadHabitSettings,
};
