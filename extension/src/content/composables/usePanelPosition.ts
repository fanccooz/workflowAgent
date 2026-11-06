import { type Ref } from 'vue';

const POSITION_KEY = 'warom-agent-position-v2';

export function usePanelPosition(rootRef: Ref<HTMLElement | null>) {
  function hostEl(): HTMLElement | null {
    return (document.getElementById('wf-agent-host') as HTMLElement | null) || rootRef.value;
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function applyPosition(left: number, top: number) {
    const el = hostEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    el.style.left = `${clamp(left, 8, maxLeft)}px`;
    el.style.top = `${clamp(top, 8, maxTop)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function restorePosition() {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        applyPosition(pos.left, pos.top);
      }
    } catch {
      // ignore
    }
  }

  function savePosition() {
    const el = hostEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function enableDrag(handle: HTMLElement, options: { ignoreSelector?: string } = {}) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (options.ignoreSelector && (event.target as HTMLElement).closest(options.ignoreSelector)) {
        return;
      }
      const el = hostEl();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      moved = false;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      applyPosition(originLeft + dx, originTop + dy);
    });

    handle.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (moved) {
        savePosition();
        event.preventDefault();
        event.stopPropagation();
      }
      (handle as HTMLElement & { _wfDragMoved?: boolean })._wfDragMoved = moved;
    });

    handle.addEventListener('pointercancel', () => {
      dragging = false;
    });
  }

  return { restorePosition, enableDrag };
}
