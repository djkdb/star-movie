import { useRef, type CSSProperties } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';

// A small, deterministic burst — an unlock earns a spark of celebration
// without a confetti dependency. Eight radial motes, staggered.
const UNLOCK_SPARKS = Array.from({ length: 8 }, (_, index) => {
  const angle = (index / 8) * Math.PI * 2;
  return {
    dx: Math.round(Math.cos(angle) * 34),
    dy: Math.round(Math.sin(angle) * 34),
    delay: (index % 4) * 45,
  };
});

export interface ToastRegionProps {
  store: ArchiveStoreApi;
}

type ToastVariant = 'neutral' | 'unlock' | 'danger';

const VARIANT_CLASS: Record<ToastVariant, string> = {
  neutral: 'toast',
  unlock: 'toast toast-unlock',
  danger: 'toast toast-danger',
};

function stringPayload(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function toastContent(event: Readonly<{ type: string; payload: Readonly<Record<string, unknown>> }>): {
  title: string;
  message: string;
  variant: ToastVariant;
} {
  if (event.type === 'achievement-unlocked') {
    const name = stringPayload(event.payload, 'name') ?? '업적';
    return {
      title: `업적 해금: ${name}`,
      message: stringPayload(event.payload, 'description') ?? '새 업적을 달성했습니다.',
      variant: 'unlock',
    };
  }

  if (event.type === 'milestone-unlocked') {
    const target = event.payload.target;
    const targetLabel = typeof target === 'number' ? `${target}편` : '작품 수';
    const rewardType = event.payload.rewardType === 'planet' ? '행성' : '보상 은하';
    return {
      title: `${targetLabel} 마일스톤 해금`,
      message: `${rewardType} 보상이 우주에 나타났습니다.`,
      variant: 'unlock',
    };
  }

  if (event.type === 'gentle-note') {
    return {
      title: stringPayload(event.payload, 'title') ?? '알림',
      message: stringPayload(event.payload, 'message') ?? '',
      variant: 'neutral',
    };
  }

  if (event.type === 'user-save-failed' || event.type === 'command-failed') {
    return {
      title: event.type === 'user-save-failed' ? '저장 실패' : '작업 실패',
      message: stringPayload(event.payload, 'message')
        ?? '작업을 저장하지 못했습니다. 다시 시도해 주세요.',
      variant: 'danger',
    };
  }

  // Unknown event types render as calm notes — a future event flow must
  // not silently ship dressed as a red failure toast.
  return {
    title: '알림',
    message: stringPayload(event.payload, 'message') ?? '',
    variant: 'neutral',
  };
}

interface ToastItemProps {
  event: Readonly<{ id: string; type: string; payload: Readonly<Record<string, unknown>> }>;
  onDismiss(eventId: string): void;
}

function ToastItem({ event, onDismiss }: ToastItemProps) {
  const content = toastContent(event);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(false);

  const dismiss = () => {
    if (leavingRef.current) return;
    const surface = surfaceRef.current;

    // Keyboard focus was on this toast's close button, which is about to
    // vanish. Move focus to a stable anchor now — the next (or previous)
    // toast's close button — so it never rests on an invisible control and
    // never resets to the top of the document mid-exit.
    const button = surface?.querySelector('button') ?? null;
    if (button !== null && document.activeElement === button) {
      const buttons = Array.from(
        surface?.parentElement?.querySelectorAll<HTMLButtonElement>('.toast button') ?? [],
      );
      const index = buttons.indexOf(button);
      const next = buttons[index + 1] ?? buttons[index - 1] ?? null;
      if (next !== null) next.focus();
      else button.blur();
    }

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Slide out before consuming; fall back to an instant dismiss when the
    // Web Animations API is unavailable (jsdom) or motion is reduced.
    if (surface === null || reducedMotion || typeof surface.animate !== 'function') {
      onDismiss(event.id);
      return;
    }
    leavingRef.current = true;
    const exit = surface.animate(
      [
        { opacity: 1, translate: '0 0' },
        { opacity: 0, translate: '0 -8px' },
      ],
      { duration: 160, easing: 'ease-in', fill: 'forwards' },
    );
    const finish = () => onDismiss(event.id);
    exit.addEventListener('finish', finish);
    exit.addEventListener('cancel', finish);
  };

  return (
    <div className={VARIANT_CLASS[content.variant]} ref={surfaceRef}>
      {content.variant === 'unlock' && (
        <>
          <span aria-hidden="true" className="toast-badge">✦</span>
          <span aria-hidden="true" className="toast-sparkles">
            {UNLOCK_SPARKS.map((spark, index) => (
              <span
                className="toast-spark"
                key={index}
                style={{ '--dx': `${spark.dx}px`, '--dy': `${spark.dy}px`, '--d': `${spark.delay}ms` } as CSSProperties}
              />
            ))}
          </span>
        </>
      )}
      <div>
        <strong>{content.title}</strong>
        <p>{content.message}</p>
      </div>
      <button
        type="button"
        aria-label="알림 닫기"
        onClick={dismiss}
      >
        닫기
      </button>
    </div>
  );
}

export function ToastRegion({ store }: ToastRegionProps) {
  const toastEvents = useStore(store, (state) => state.runtime.toastEvents);

  return (
    <section className="toast-region" aria-label="저장 알림" aria-live="polite" aria-relevant="additions">
      {toastEvents.map((event) => (
        <ToastItem
          event={event}
          key={event.id}
          onDismiss={(eventId) => store.getState().commands.consumeToastEvent(eventId)}
        />
      ))}
    </section>
  );
}
