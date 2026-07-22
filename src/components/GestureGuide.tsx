import { useState } from 'react';
import { useStore } from 'zustand';

import { useCoarsePointer } from '../scene/useCoarsePointer';
import type { ArchiveStoreApi } from '../store/archiveStore';

const STORAGE_KEY = 'space-movie-archive:gesture-guide-dismissed';

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return true;
  }
}

/**
 * A one-time welcome note: how to move through the sky, and — while the
 * universe is still empty — where the first star is born. Dismissed once,
 * it never returns.
 */
export function GestureGuide({ store }: { store: ArchiveStoreApi }) {
  const [dismissed, setDismissed] = useState(wasDismissed);
  const coarsePointer = useCoarsePointer();
  const starCount = useStore(store, (state) => state.persisted.stars.length);
  const hasRegistration = useStore(
    store,
    (state) => state.runtime.hasPersistedRegistration,
  );

  if (dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Storage may be unavailable; the guide simply won't stay dismissed.
    }
    setDismissed(true);
  };

  return (
    <section aria-label="시작 안내" className="gesture-guide">
      <p className="gesture-guide-moves">
        {coarsePointer
          ? '한 손가락으로 회전 · 두 손가락으로 확대와 이동 · 별을 눌러 이야기 보기'
          : '드래그로 회전 · 휠로 확대 · 별을 클릭해 이야기 보기'}
      </p>
      {(!hasRegistration || starCount === 0) && (
        <>
          <p className="gesture-guide-cta">첫 작품을 기록하면 하늘에 별 하나가 떠올라요.</p>
          <button
            className="primary-action gesture-guide-primary"
            onClick={() => store.getState().commands.requestPanelOpen('add')}
            type="button"
          >
            첫 작품 기록하기
          </button>
        </>
      )}
      <button className="secondary-action" onClick={dismiss} type="button">
        알겠어요
      </button>
    </section>
  );
}
