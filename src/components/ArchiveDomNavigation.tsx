import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { BlackholeArchive } from './BlackholeArchive';
import { GenreBadge, RatingDisplay } from './WorkMetadata';

export interface ArchiveDomNavigationProps {
  store: ArchiveStoreApi;
}

export function ArchiveDomNavigation({ store }: ArchiveDomNavigationProps) {
  const stars = useStore(store, (state) => state.persisted.stars);
  const constellations = useStore(store, (state) => state.persisted.constellations);
  const draft = useStore(store, (state) => state.runtime.constellationDraft);
  const activeStarIds = new Set(stars.map(({ id }) => id));

  const activateWork = (starId: string) => {
    if (draft.active && draft.phase === 'selecting') {
      store.getState().commands.selectConstellationStar(starId);
      return;
    }
    store.setState((state) => ({
      runtime: {
        ...state.runtime,
        selectedStarId: starId,
        pendingCameraRequest: { type: 'star', starId },
      },
    }));
  };

  const focusConstellation = (constellationId: string) => {
    store.setState((state) => ({
      runtime: {
        ...state.runtime,
        pendingCameraRequest: { type: 'constellation', constellationId },
      },
    }));
  };

  return (
    <div className="archive-dom-navigation" id="archive-dom-navigation" tabIndex={-1}>
      <section aria-labelledby="active-work-navigation-heading" className="navigation-panel">
        <h2 id="active-work-navigation-heading">작품 DOM 탐색</h2>
        <p className="navigation-description" id="active-work-navigation-description">
          3D Canvas 없이도 작품을 선택하고 상세 보기, 별자리 연결, 삭제 및 블랙홀 이동을 실행할 수 있습니다.
        </p>
        {draft.active && (
          <p aria-live="polite" className="constellation-operation-status">
            {draft.phase === 'selecting'
              ? `별자리 연결 순서 선택 중: ${draft.starIds.length}/200개`
              : '별자리 이름을 입력하는 동안 작품 선택이 잠겼습니다.'}
          </p>
        )}
        {stars.length === 0 ? (
          <p className="empty-state">등록된 작품이 없습니다</p>
        ) : (
          <ul aria-describedby="active-work-navigation-description" className="navigation-list">
            {stars.map((star) => {
              const selectedForDraft = draft.starIds.includes(star.id);
              const selecting = draft.active && draft.phase === 'selecting';
              return (
                <li key={star.id}>
                  <span className="navigation-work-metadata">
                    <strong>{star.title}</strong>
                    <GenreBadge genre={star.genre} />
                    <RatingDisplay rating={star.rating} />
                  </span>
                  <button
                    aria-pressed={selecting ? selectedForDraft : undefined}
                    disabled={draft.active && (draft.phase !== 'selecting' || selectedForDraft)}
                    onClick={() => activateWork(star.id)}
                    type="button"
                  >
                    {selecting
                      ? `${star.title} 별자리 노드로 ${selectedForDraft ? '선택됨' : '선택'}`
                      : `${star.title} 상세 및 관리`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="constellation-navigation-heading" className="navigation-panel">
        <h2 id="constellation-navigation-heading">별자리 DOM 탐색</h2>
        {constellations.length === 0 ? (
          <p className="empty-state">등록된 별자리가 없습니다</p>
        ) : (
          <ul className="navigation-list">
            {constellations.map((constellation) => {
              const activeCount = constellation.starIds.filter((id) => activeStarIds.has(id)).length;
              const reasonId = `constellation-${constellation.id}-disabled-reason`;
              const disabled = activeCount < 2;
              return (
                <li key={constellation.id}>
                  <button
                    aria-describedby={disabled ? reasonId : undefined}
                    disabled={disabled}
                    onClick={() => focusConstellation(constellation.id)}
                    type="button"
                  >
                    {constellation.name} ({activeCount}개 작품)
                  </button>
                  {disabled && (
                    <span className="disabled-reason" id={reasonId}>
                      활성 작품이 2개 이상 필요합니다
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BlackholeArchive store={store} />
    </div>
  );
}
