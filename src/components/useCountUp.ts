import { useLayoutEffect, useRef, type RefObject } from 'react';

const COUNT_UP_DURATION_MS = 800;

const formatter = new Intl.NumberFormat('ko-KR');

/** Formats a stat the same way the count-up animation does. */
export function formatCount(value: number): string {
  return formatter.format(value);
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animates a numeric stat counting up to `value` inside the referenced
 * element. Counting implies accumulation — the emotional register of an
 * archive — so the number ticks up when its shell panel opens and whenever
 * the value grows while visible.
 *
 * The element's React-rendered text is always the final value; the hook
 * only drives intermediate frames via textContent, so the DOM settles
 * exactly where React put it. Snaps instantly under prefers-reduced-motion
 * and in layoutless environments (jsdom reports 0-width rects).
 */
export function useCountUp<T extends HTMLElement>(value: number): RefObject<T> {
  const ref = useRef<T>(null);
  const displayedRef = useRef(value);
  const frameRef = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;

    const setText = (next: number) => {
      // Mutate the existing text node instead of replacing it, so React's
      // managed text child keeps its identity across our frames.
      const text = formatter.format(next);
      const node = element.firstChild;
      if (node !== null && node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
      else element.textContent = text;
      displayedRef.current = next;
    };

    const canAnimate = () =>
      !prefersReducedMotion()
      && typeof window.requestAnimationFrame === 'function'
      && element.getBoundingClientRect().width > 0;

    const animateTo = (target: number, from: number) => {
      window.cancelAnimationFrame(frameRef.current);
      if (target === from || !canAnimate()) {
        setText(target);
        return;
      }
      setText(from);
      let start: number | null = null;
      const step = (now: number) => {
        if (start === null) start = now;
        const progress = easeOutExpo((now - start) / COUNT_UP_DURATION_MS);
        setText(Math.round(from + (target - from) * progress));
        if (progress < 1) frameRef.current = window.requestAnimationFrame(step);
      };
      frameRef.current = window.requestAnimationFrame(step);
    };

    // Value changed while mounted: tick up from what was displayed.
    // Shrinking values (deleting a work) snap — celebration is for growth.
    animateTo(value, Math.min(displayedRef.current, value));

    // Shell panels stay mounted while closed; replay the count when the
    // surrounding panel opens so the tick is actually seen.
    const panel = element.closest('.shell-panel');
    if (panel === null) return () => window.cancelAnimationFrame(frameRef.current);
    const observer = new MutationObserver(() => {
      if (panel.getAttribute('data-open') === 'true') animateTo(value, 0);
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['data-open'] });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [value]);

  return ref;
}
