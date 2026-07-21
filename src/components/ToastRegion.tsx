import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';

export interface ToastRegionProps {
  store: ArchiveStoreApi;
}

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
  isUnlock: boolean;
} {
  if (event.type === 'achievement-unlocked') {
    const name = stringPayload(event.payload, 'name') ?? '업적';
    return {
      title: `업적 해금: ${name}`,
      message: stringPayload(event.payload, 'description') ?? '새 업적을 달성했습니다.',
      isUnlock: true,
    };
  }

  if (event.type === 'milestone-unlocked') {
    const target = event.payload.target;
    const targetLabel = typeof target === 'number' ? `${target}편` : '작품 수';
    const rewardType = event.payload.rewardType === 'planet' ? '행성' : '보상 은하';
    return {
      title: `${targetLabel} 마일스톤 해금`,
      message: `${rewardType} 보상이 우주에 나타났습니다.`,
      isUnlock: true,
    };
  }

  if (event.type === 'gentle-note') {
    return {
      title: stringPayload(event.payload, 'title') ?? '알림',
      message: stringPayload(event.payload, 'message') ?? '',
      isUnlock: true,
    };
  }

  return {
    title: event.type === 'user-save-failed' ? '저장 실패' : '작업 실패',
    message: stringPayload(event.payload, 'message')
      ?? '작업을 저장하지 못했습니다. 다시 시도해 주세요.',
    isUnlock: false,
  };
}

export function ToastRegion({ store }: ToastRegionProps) {
  const toastEvents = useStore(store, (state) => state.runtime.toastEvents);

  return (
    <section className="toast-region" aria-label="저장 알림" aria-live="polite" aria-relevant="additions">
      {toastEvents.map((event) => {
        const content = toastContent(event);
        return (
          <div className={content.isUnlock ? 'toast toast-unlock' : 'toast'} key={event.id}>
            <div>
              <strong>{content.title}</strong>
              <p>{content.message}</p>
            </div>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => store.getState().commands.consumeToastEvent(event.id)}
            >
              닫기
            </button>
          </div>
        );
      })}
    </section>
  );
}
