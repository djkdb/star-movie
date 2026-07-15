import { useMemo, useRef } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { selectAchievementPanelViewModel } from '../store/selectors';
import { useModalFocusTrap } from './useModalFocusTrap';

export interface AchievementPanelProps {
  store: ArchiveStoreApi;
}

export function AchievementPanel({ store }: AchievementPanelProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const runtime = useStore(store, (state) => state.runtime);
  const viewModel = useMemo(
    () => selectAchievementPanelViewModel({ persisted, runtime }),
    [persisted, runtime],
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => store.getState().commands.setAchievementPanelOpen(false);
  const focusTrap = useModalFocusTrap<HTMLElement>(viewModel.isOpen, close, closeRef);

  if (!viewModel.isOpen) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="achievement-heading"
        aria-modal="true"
        className="achievement-panel glass-panel"
        onKeyDown={focusTrap.onKeyDown}
        ref={focusTrap.containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="panel-heading-row">
          <h2 id="achievement-heading">업적</h2>
          <button
            aria-label="업적 패널 닫기"
            onClick={close}
            ref={closeRef}
            type="button"
          >
            닫기
          </button>
        </header>
        <ul className="achievement-list">
          {viewModel.achievements.map((achievement) => (
            <li key={achievement.id} className={achievement.unlocked ? 'is-unlocked' : 'is-locked'}>
              <div>
                <strong>{achievement.name}</strong>
                <span className="status-badge">{achievement.unlocked ? '해금' : '잠금'}</span>
              </div>
              <p>{achievement.description}</p>
              <progress
                aria-label={`${achievement.name} 진행률`}
                max={achievement.target}
                value={Math.min(achievement.progress, achievement.target)}
              />
              <span>{achievement.progress}/{achievement.target}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
