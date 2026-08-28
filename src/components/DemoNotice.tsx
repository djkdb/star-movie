import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { clearDemoMark, isShowingPlantedDemo } from '../domain/demoMark';
import { createDefaultPersistedStore } from '../domain/defaultState';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { useModalFocusTrap } from './useModalFocusTrap';

/** Deferring is remembered for this tab only, so the notice returns next visit. */
const DEFERRED_KEY = 'space-movie-archive:demo-notice-deferred';

function deferredThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(DEFERRED_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberDeferral(): void {
  try {
    window.sessionStorage.setItem(DEFERRED_KEY, 'true');
  } catch {
    // Best effort; the worst case is being asked again on the next load.
  }
}

export interface DemoNoticeProps {
  store: ArchiveStoreApi;
}

/**
 * Says out loud that the opening sky is a sample, and clears it on confirm.
 *
 * A first visit lands in a finished-looking universe so the idea reads in one
 * glance. Left unexplained, the visitor's first record joins fifteen films they
 * never watched — the archive would be wrong from its very first entry. So the
 * demo announces itself and then gets out of the way.
 *
 * Escape and 둘러보기 defer rather than clear: a keystroke must never be the
 * thing that wipes an archive. Deferring lasts the session, because until the
 * visitor actually answers, the sky on screen is still not theirs.
 */
export function DemoNotice({ store }: DemoNoticeProps) {
  const [visible, setVisible] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const starCount = useStore(store, (state) => state.persisted.stars.length);

  const defer = useCallback(() => {
    rememberDeferral();
    setVisible(false);
  }, []);

  const focusTrap = useModalFocusTrap<HTMLElement>(visible, defer, confirmRef);

  useEffect(() => {
    if (isShowingPlantedDemo() && !deferredThisSession()) setVisible(true);
  }, []);

  if (!visible) return null;

  const start = () => {
    // The whole document is replaced rather than deleted star by star, so the
    // constellation, the black hole archive and the planet codex go with it —
    // a half-cleared demo would be worse than leaving it whole.
    store.getState().commands.importArchive(createDefaultPersistedStore());
    clearDemoMark();
    setVisible(false);
    store.getState().commands.pushGentleToast(
      '빈 하늘에서 시작합니다',
      '첫 작품을 기록하면 이 하늘에 별이 하나 떠요.',
    );
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-describedby="demo-notice-body"
        aria-labelledby="demo-notice-title"
        aria-modal="true"
        className="demo-notice"
        onKeyDown={focusTrap.onKeyDown}
        ref={focusTrap.containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className="demo-notice-eyebrow">둘러보기</p>
        <h2 id="demo-notice-title">지금 보이는 별들은 예시예요</h2>
        <div id="demo-notice-body">
          <p className="demo-notice-body">
            Asteron이 어떤 모습인지 보여드리려고 영화 {starCount}편을 미리 담아 뒀어요.
            처음 한 번만 이렇게 보입니다.
          </p>
          <p className="demo-notice-body">
            확인을 누르면 예시가 모두 사라지고, 아무것도 없는 하늘에서 시작합니다.
          </p>
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={defer} type="button">
            먼저 둘러볼게요
          </button>
          <button className="primary-action" onClick={start} ref={confirmRef} type="button">
            확인, 내 하늘 만들기
          </button>
        </div>
      </section>
    </div>
  );
}
