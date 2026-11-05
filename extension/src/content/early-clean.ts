import { LIST_HASH } from '@/shared/types';

const hash = String(location.hash || '');
if (hash.startsWith(LIST_HASH) && /[?&]code=/.test(hash)) {
  const cleanUrl = `${location.pathname}${location.search}${LIST_HASH}`;
  history.replaceState(history.state, document.title || '', cleanUrl);
}
