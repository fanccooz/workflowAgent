// @ts-nocheck

  // 多字客套话按从长到短去掉，避免短词先截断长词。
  const MULTI_FILLERS = ['填一张', '帮忙', '我想', '想要', '我要', '打开', '发起', '新建', '填写', '一下', '这个', '帮我'];
  const SITE_PREFIX = 'https://test.warom-lighting.com/v2_debug_ouyang/';
  const OPEN_HASH = '#/workflow/workflow-base/agent';

  function stripFillers(text) {
    let value = String(text || '').replace(/\s+/g, '');
    let changed = true;
    while (changed && value) {
      changed = false;
      if (value.startsWith('请')) {
        const rest = value.slice(1);
        const followedByFiller = MULTI_FILLERS.some((filler) => rest.startsWith(filler));
        if (followedByFiller || rest.length === 0) {
          value = rest;
          changed = true;
          continue;
        }
      }
      for (const filler of MULTI_FILLERS) {
        if (value.startsWith(filler) || (value.endsWith(filler) && value.length > filler.length)) {
          value = value.startsWith(filler)
            ? value.slice(filler.length)
            : value.slice(0, -filler.length);
          changed = true;
          break;
        }
      }
    }
    return value;
  }

  function buildCandidates(utterance) {
    // 去掉空白和中文标点，避免「请假，明天」整句对不上「请假申请」
    const original = String(utterance || '').replace(/\s+/g, '');
    const compact = original.replace(/[，,。！？、；：""''（）()]/g, '');
    const stripped = stripFillers(compact);
    if (!stripped && !compact) return [];
    const candidates = [];
    const push = (item) => {
      if (item && !candidates.includes(item)) candidates.push(item);
    };
    push(original);
    push(compact);
    push(stripped);
    if (stripped.endsWith('流程') && stripped.length > 2) {
      push(stripped.slice(0, -2));
    }
    // 长句里只要出现「请假」，单独作为候选，便于命中「请假申请」等名称
    if (compact.includes('请假')) push('请假');
    return candidates;
  }

  function normalizeCode(code) {
    const raw = String(code ?? '').trim();
    if (!raw) return '';
    const stripped = raw.replace(/^0+/, '');
    return stripped || '0';
  }

  function codesMatch(leftValue, rightValue) {
    const left = String(leftValue ?? '').trim();
    const right = String(rightValue ?? '').trim();
    if (!left || !right) return false;
    return left.toLowerCase() === right.toLowerCase() || normalizeCode(left) === normalizeCode(right);
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, '').toLowerCase();
  }

  function rowMatches(row, candidate) {
    const name = normalizeText(row.name);
    const theme = normalizeText(row.theme);
    const word = normalizeText(candidate);
    if (!word) return false;
    if (name && (name === word || name.includes(word))) return true;
    if (name.length >= 2 && word.includes(name)) return true;
    if (codesMatch(row.code, candidate)) return true;
    if (theme && theme === word) return true;
    return false;
  }

  function isDisabled(row) {
    return Number(row.DisableStatus) === 1;
  }

  const MENU_FILLERS = ['打开', '进入', '发起', '新建', '帮忙', '帮我', '我想', '想要', '我要', '一下', '这个', '菜单', '模块', '页面', '导航', '去'];

  function stripMenuFillers(text) {
    let value = String(text || '').replace(/\s+/g, '').replace(/[，,。！？、；：""''（）()]/g, '');
    let changed = true;
    while (changed && value) {
      changed = false;
      if (value.startsWith('请')) {
        value = value.slice(1);
        changed = true;
        continue;
      }
      for (const filler of MENU_FILLERS) {
        if (value.startsWith(filler)) {
          value = value.slice(filler.length);
          changed = true;
          break;
        }
        if (value.endsWith(filler) && value.length > filler.length) {
          value = value.slice(0, -filler.length);
          changed = true;
          break;
        }
      }
    }
    return value;
  }

  function scoreMenuHit(query, title, pathText) {
    const q = normalizeText(query);
    const t = normalizeText(title);
    const p = normalizeText(pathText || '');
    if (!q || !t) return 0;
    if (t === q) return 100;
    if (t.startsWith(q) || q.startsWith(t)) return 92;
    if (t.includes(q)) return 84;
    if (q.includes(t) && t.length >= 2) return 76;
    if (p.includes(q)) return 68;
    // 顺序子序列：请假 ≈ 请假申请 / 人事请假
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i += 1) {
      if (t[i] === q[qi]) qi += 1;
    }
    if (qi === q.length && q.length >= 2) return 58;
    // 共享字数
    const setT = new Set(t.split(''));
    let shared = 0;
    for (const ch of q) {
      if (setT.has(ch)) shared += 1;
    }
    if (q.length >= 2 && shared / q.length >= 0.7) return Math.round(40 + 20 * (shared / q.length));
    return 0;
  }

  /** 模糊匹配菜单：不知道在哪个目录下也能按名称搜 */
  function matchMenus(utterance, menus) {
    const list = Array.isArray(menus) ? menus : [];
    const query = stripMenuFillers(utterance);
    const names = list.map((item) => String(item.title || '')).filter(Boolean);
    if (!query) {
      return { status: 'ask', matches: [], names };
    }
    const scored = [];
    for (const item of list) {
      const title = String(item.title || '');
      const pathText = Array.isArray(item.path)
        ? item.path.join('/')
        : String(item.subtitle || item.pathText || '');
      const score = scoreMenuHit(query, title, pathText);
      if (score <= 0) continue;
      scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || String(a.item.title).length - String(b.item.title).length);
    const top = scored.filter((row) => row.score >= 40).slice(0, 12);
    if (!top.length) return { status: 'none', matches: [], names };
    const best = top[0];
    const close = top.filter((row) => row.score >= best.score - 12);
    // 唯一高分，或明显领先第二名
    if (
      close.length === 1
      || (top.length > 1 && best.score >= 76 && best.score - top[1].score >= 16)
      || (best.score >= 92 && close.every((row) => row.item.title === best.item.title))
    ) {
      return { status: 'open', matches: [best.item], names };
    }
    // 去重标题后给用户选
    const seen = new Set();
    const matches = [];
    for (const row of close) {
      const key = String(row.item.id || row.item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(row.item);
    }
    if (matches.length === 1) return { status: 'open', matches, names };
    return { status: 'choose', matches, names };
  }

  function matchWorkflows(utterance, rows) {
    const list = Array.isArray(rows) ? rows : [];
    const names = list.map((row) => String(row.name || '')).filter(Boolean);
    const compact = String(utterance || '').replace(/\s+/g, '').replace(/[，,。！？、；：""''（）()]/g, '');
    // 只剩客套话时请用户说明要开哪条流程
    if (!stripFillers(compact)) {
      return { status: 'ask', matches: [], disabledMatches: [], names };
    }
    const candidates = buildCandidates(utterance);
    if (candidates.length === 0) {
      return { status: 'ask', matches: [], disabledMatches: [], names };
    }
    const matched = [];
    const seen = new Set();
    for (const row of list) {
      const key = `${row.code}\0${row.name}`;
      if (seen.has(key)) continue;
      if (!candidates.some((candidate) => rowMatches(row, candidate))) continue;
      seen.add(key);
      matched.push(row);
    }
    const matches = matched.filter((row) => !isDisabled(row));
    const disabledMatches = matched.filter((row) => isDisabled(row));
    let status = 'none';
    if (matches.length === 1) status = 'open';
    else if (matches.length > 1) status = 'choose';
    else if (disabledMatches.length > 0) status = 'disabled';
    return { status, matches, disabledMatches, names };
  }

  function flattenSolutions(solutions) {
    if (Array.isArray(solutions)) return solutions;
    if (!solutions || typeof solutions !== 'object') return [];
    for (const key of ['data', 'List', 'list', 'rows', 'Records']) {
      if (Array.isArray(solutions[key])) return solutions[key];
    }
    return [];
  }

  function selectSolution(solutions, solutionCode) {
    const target = String(solutionCode);
    return flattenSolutions(solutions).find((item) => {
      if (!item) return false;
      const code = String(item.Code ?? item.code ?? item.SolutionCode ?? item.solutionCode ?? '');
      return code === target;
    }) || null;
  }

  function solutionId(solution) {
    if (!solution) return null;
    if (solution.ID != null) return solution.ID;
    if (solution.Id != null) return solution.Id;
    if (solution.id != null) return solution.id;
    return null;
  }

  function columnField(columns, header) {
    const list = Array.isArray(columns) ? columns : [];
    const hit = list.find((column) => {
      const title = String(column.headerName ?? column.header ?? column.title ?? column.caption ?? column.Caption ?? '');
      return title === header;
    });
    if (!hit) return '';
    return hit.field || hit.fieldName || hit.Field || hit.prop || '';
  }

  function readField(row, field, fallbacks) {
    if (field && row[field] != null) return row[field];
    for (const key of fallbacks) {
      if (row[key] != null) return row[key];
    }
    return '';
  }

  function projectRows(rawRows, columns) {
    const nameField = columnField(columns, '名称');
    const codeField = columnField(columns, '代码');
    const themeField = columnField(columns, '主视图');
    return (Array.isArray(rawRows) ? rawRows : []).map((row) => ({
      name: String(readField(row, nameField, ['Name', 'name'])),
      code: String(readField(row, codeField, ['Code', 'code'])),
      theme: String(readField(row, themeField, ['Theme', 'theme', 'MainView'])),
      DisableStatus: row.DisableStatus ?? row.disableStatus ?? 0,
    }));
  }

  function columnFields(columns) {
    return (Array.isArray(columns) ? columns : [])
      .map((column) => column.field || column.fieldName || column.Field || column.prop || '')
      .filter(Boolean);
  }

  function buildQuery(solutionIdValue, fields, start, end) {
    return {
      solution: solutionIdValue,
      columns: fields,
      order: [],
      pagination: { start, end },
      where: [],
      keyword: '',
    };
  }

  function nextRange(rowCount, loadedCount, pageSize = 500) {
    if (loadedCount >= rowCount) return null;
    return {
      start: loadedCount + 1,
      end: Math.min(rowCount, loadedCount + pageSize),
    };
  }

  function openHash(code) {
    return `${OPEN_HASH}?code=${encodeURIComponent(code)}`;
  }

  function openUrl(code) {
    return `${SITE_PREFIX}${openHash(code)}`;
  }
export {buildCandidates,
    matchWorkflows,
    matchMenus,
    stripMenuFillers,
    scoreMenuHit,
    selectSolution,
    solutionId,
    projectRows,
    columnFields,
    buildQuery,
    nextRange,
    openHash,
    openUrl,};
