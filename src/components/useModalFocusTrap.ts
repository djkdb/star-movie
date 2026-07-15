import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ModalFocusTrap<T extends HTMLElement> {
  containerRef: RefObject<T>;
  onKeyDown(event: KeyboardEvent<T>): void;
}

/** Keeps keyboard focus inside an open modal and restores its invoking control. */
export function useModalFocusTrap<T extends HTMLElement>(
  active: boolean,
  onDismiss: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
  restoreFallbackRef?: RefObject<HTMLElement>,
): ModalFocusTrap<T> {
  const containerRef = useRef<T>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const container = containerRef.current;
    const initial = initialFocusRef?.current
      ?? container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? container;
    initial?.focus();

    return () => {
      const previous = restoreFocusRef.current;
      const target = previous?.isConnected ? previous : restoreFallbackRef?.current;
      if (target?.isConnected) target.focus();
    };
  }, [active, initialFocusRef, restoreFallbackRef]);

  return {
    containerRef,
    onKeyDown(event) {
      if (!active) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }

      if (event.shiftKey && (document.activeElement === first || !containerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        event.stopPropagation();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      }
    },
  };
}
