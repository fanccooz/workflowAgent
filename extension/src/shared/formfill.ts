// @ts-nocheck

/**
 * 通用表单关键词：从用户原话 / 对话 summary 抽出可回填值。
 * 不依赖具体流程；真正写入时再按页面 label 对齐。
 */

  function isPureOpenRequest(utterance) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (!text) return true;
    return /^(你好|您好)?(我)?(想要|想|要)?(请)?(帮我|帮忙)?(打开|进入|发起|新建).{0,24}(流程|申请|菜单|模块|页面|待办)?$/.test(text);
  }

  /** 原话里是否带了可填内容（人名、事由、日期等），而不只是「打开某流程」 */
  function utteranceHasFillHints(utterance) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (!text || isPureOpenRequest(text)) return false;
    return /给.{1,12}(留言|发信|发消息)|留言给|接收人|收件人|发给|抄送|事由|原因|因为|标题|内容|说明|备注|明天|后天|今天|两天|三天|\d+天|开会/.test(text);
  }

  /** 从原话猜流程短名，供 open_workflow / form.open_fill 的 query */
  function inferWorkflowQuery(utterance) {
    const text = String(utterance || '').replace(/\s+/g, '');
    if (/内部留言|留言/.test(text)) return '内部留言';
    if (/请假/.test(text)) return '请假';
    if (/出差/.test(text)) return '出差';
    if (/用印/.test(text)) return '用印';
    if (/采购/.test(text)) return '采购';
    return '';
  }

  /** 本地规则抽常见槽位（模型失败时的种子） */
  function extractKeywordFills(utterance) {
    const text = String(utterance || '').trim();
    const fills = {};
    if (!text) return fills;

    const toPerson = text.match(/给\s*([^\s，,。；;的]{2,12})\s*(?:留言|发信|发消息|发个消息)/)
      || text.match(/(?:留言给|发给|接收人[:：]?)\s*([^\s，,。；;]{2,12})/);
    if (toPerson) {
      const name = toPerson[1].replace(/^(同事|朋友|领导)/, '');
      if (name) {
        fills['接收人'] = name;
        fills['收件人'] = name;
        fills['留言对象'] = name;
        fills['被留言人'] = name;
      }
    }

    const title = text.match(/(?:标题|主题)[:：\s]*([^\s，,。；;]{2,40})/);
    if (title) fills['标题'] = title[1];

    const content = text.match(/(?:内容|留言内容|正文)[:：\s]*([^\n]{2,80})/);
    if (content) {
      fills['内容'] = content[1].trim();
      fills['留言内容'] = content[1].trim();
    }

    return fills;
  }

  /** 对话 summary.form / fills / fields → 扁平 label→值 */
  function fillsFromSummary(summary) {
    const raw = summary && typeof summary === 'object' ? summary : {};
    const src = raw.form || raw.fills || raw.fields || null;
    const out = {};
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      Object.keys(src).forEach((key) => {
        const label = String(key || '').trim();
        const value = src[key];
        if (!label || value == null || String(value).trim() === '') return;
        out[label] = String(value).trim();
      });
    }
    // 常见别名摊平
    if (raw.receiver || raw.recipient || raw.to) {
      const name = String(raw.receiver || raw.recipient || raw.to).trim();
      if (name) {
        out['接收人'] = out['接收人'] || name;
        out['收件人'] = out['收件人'] || name;
      }
    }
    if (raw.content || raw.message) {
      const body = String(raw.content || raw.message).trim();
      if (body) {
        out['内容'] = out['内容'] || body;
        out['留言内容'] = out['留言内容'] || body;
      }
    }
    return out;
  }

  /** 合并种子：summary 优先，本地关键词补缺 */
  function mergeFillHints(utterance, summary) {
    const local = extractKeywordFills(utterance);
    const fromModel = fillsFromSummary(summary);
    return { ...local, ...fromModel };
  }

export {
  isPureOpenRequest,
  utteranceHasFillHints,
  inferWorkflowQuery,
  extractKeywordFills,
  fillsFromSummary,
  mergeFillHints,
};
