// 在页面脚本之前执行，刷新时先清掉 ?code=，避免自动打开发起弹窗。
(function () {
  const LIST_HASH = '#/workflow/workflow-base/agent';
  const hash = String(location.hash || '');
  if (!hash.startsWith(LIST_HASH)) return;
  if (!/[?&]code=/.test(hash)) return;
  const cleanUrl = `${location.pathname}${location.search}${LIST_HASH}`;
  history.replaceState(history.state, document.title || '', cleanUrl);
})();
