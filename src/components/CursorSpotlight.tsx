import { useEffect } from 'react';

const SPOTLIGHT_SELECTOR = '.glass-panel, .work-card';

/**
 * Feeds the cursor position to whichever glass surface sits under the pointer,
 * so its ::after spotlight follows the cursor. One delegated, rAF-coalesced
 * document listener rather than a hook per panel; disabled where hover does not
 * exist (touch), matching the CSS `@media (hover: none)` opt-out.
 */
export function CursorSpotlight() {
  useEffect(() => {
    const canHover = typeof window.matchMedia !== 'function'
      || window.matchMedia('(hover: hover)').matches;
    if (!canHover) return undefined;

    let frame = 0;
    let pending: { target: HTMLElement; x: number; y: number } | null = null;
    let current: HTMLElement | null = null;

    const apply = () => {
      frame = 0;
      if (pending === null) return;
      const { target, x, y } = pending;
      if (current !== null && current !== target) {
        current.style.removeProperty('--spot-x');
        current.style.removeProperty('--spot-y');
      }
      target.style.setProperty('--spot-x', `${x}px`);
      target.style.setProperty('--spot-y', `${y}px`);
      current = target;
      pending = null;
    };

    const handleMove = (event: PointerEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(SPOTLIGHT_SELECTOR)
        : null;
      if (target === null) {
        if (current !== null) {
          current.style.removeProperty('--spot-x');
          current.style.removeProperty('--spot-y');
          current = null;
        }
        return;
      }
      const rect = target.getBoundingClientRect();
      pending = { target, x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };

    document.addEventListener('pointermove', handleMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', handleMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      current?.style.removeProperty('--spot-x');
      current?.style.removeProperty('--spot-y');
    };
  }, []);

  return null;
}
