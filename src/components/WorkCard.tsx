import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useStore } from 'zustand';

import type { Rating } from '../domain/models';
import { posterUrl } from '../services/tmdbClient';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { ConfirmDialog } from './ConfirmDialog';
import {
  calculateCardViewportLayout,
  type CardAnchor,
} from './cardViewportLayout';
import { useModalFocusTrap } from './useModalFocusTrap';
import { GenreBadge, RatingDisplay } from './WorkMetadata';

const RATING_GLOW_COLORS: Record<Rating, string> = {
  1: '#6a7290',
  2: '#9aa8d0',
  3: '#cfe0ff',
  4: '#ffe9b8',
  5: '#fff8e0',
};

type DeleteMode = 'hard' | 'soft';

interface PendingDelete {
  mode: DeleteMode;
  affectedConstellationNames: string[];
}

export interface WorkCardProps {
  store: ArchiveStoreApi;
  anchor?: CardAnchor;
}

function clearSelection(store: ArchiveStoreApi, starId: string): void {
  store.setState((state) => ({
    runtime: {
      ...state.runtime,
      selectedStarId:
        state.runtime.selectedStarId === starId ? null : state.runtime.selectedStarId,
    },
  }));
}

export function WorkCard({ store, anchor }: WorkCardProps) {
  const selectedStarId = useStore(store, (state) => state.runtime.selectedStarId);
  const star = useStore(store, (state) =>
    state.persisted.stars.find(({ id }) => id === state.runtime.selectedStarId),
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [viewportStyle, setViewportStyle] = useState<CSSProperties>({});
  const closeCard = () => {
    if (star !== undefined) clearSelection(store, star.id);
  };
  const focusTrap = useModalFocusTrap<HTMLElement>(star !== undefined, closeCard, closeRef);

  useLayoutEffect(() => {
    if (star === undefined) return;

    const card = focusTrap.containerRef.current;
    if (card === null) return;

    const updateLayout = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const bounds = card.getBoundingClientRect();
      const layout = calculateCardViewportLayout(
        viewport,
        {
          width: bounds.width,
          height: Math.max(bounds.height, card.scrollHeight),
        },
        anchor ?? { x: viewport.width, y: viewport.height },
      );
      setViewportStyle({
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        right: 'auto',
        bottom: 'auto',
        maxWidth: `${layout.maxWidth}px`,
        maxHeight: `${layout.maxHeight}px`,
        overflowY: layout.overflowY,
      });
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateLayout);
    resizeObserver?.observe(card);

    return () => {
      window.removeEventListener('resize', updateLayout);
      resizeObserver?.disconnect();
    };
  }, [anchor?.x, anchor?.y, focusTrap.containerRef, star]);

  useEffect(() => {
    if (star === undefined) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !focusTrap.containerRef.current?.contains(event.target)) {
        setPendingDelete(null);
        clearSelection(store, star.id);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pendingDelete === null) {
        event.preventDefault();
        clearSelection(store, star.id);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusTrap.containerRef, pendingDelete, star, store]);

  if (star === undefined || selectedStarId === null) return null;

  const openDeleteConfirmation = (mode: DeleteMode) => {
    setPendingDelete({
      mode,
      affectedConstellationNames:
        store.getState().commands.getAffectedConstellationNames(star.id),
    });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    const result = pendingDelete.mode === 'hard'
      ? store.getState().commands.hardDelete(star.id)
      : store.getState().commands.softDelete(star.id);
    if (result.ok) setPendingDelete(null);
  };

  const glowStyle = {
    '--work-glow-color': RATING_GLOW_COLORS[star.rating],
  } as CSSProperties;

  const poster = posterUrl(star.posterPath, 'w342');

  return (
    <aside
      aria-labelledby="work-card-title"
      className="work-card"
      onKeyDown={(event) => {
        if (pendingDelete === null) focusTrap.onKeyDown(event);
      }}
      ref={focusTrap.containerRef}
      style={{ ...glowStyle, ...viewportStyle }}
      tabIndex={-1}
    >
      <button
        aria-label="작품 카드 닫기"
        className="card-close-button"
        onClick={closeCard}
        ref={closeRef}
        type="button"
      >
        닫기
      </button>
      <p className="eyebrow">SELECTED STAR</p>
      <div className={poster !== null ? 'work-card-heading has-poster' : 'work-card-heading'}>
        {poster !== null && (
          <img
            alt={`${star.title} 포스터`}
            className="work-card-poster"
            loading="lazy"
            src={poster}
          />
        )}
        <div className="work-card-heading-text">
          <h2 id="work-card-title">{star.title}</h2>
          <div className="work-card-summary">
            <GenreBadge genre={star.genre} />
            <RatingDisplay rating={star.rating} />
          </div>
        </div>
      </div>
      <dl className="work-card-details">
        <div>
          <dt>감독</dt>
          <dd>{star.director}</dd>
        </div>
        <div>
          <dt>감상일</dt>
          <dd><time dateTime={star.watchedDate}>{star.watchedDate}</time></dd>
        </div>
        {star.watchedWith !== undefined && (
          <div>
            <dt>함께 본 사람</dt>
            <dd>{star.watchedWith}</dd>
          </div>
        )}
        {star.emotion !== undefined && (
          <div>
            <dt>그날의 감정</dt>
            <dd>{star.emotion}</dd>
          </div>
        )}
        <div className="work-card-review">
          <dt>감상평</dt>
          <dd>{star.review.length === 0 ? '작성된 감상평이 없습니다.' : star.review}</dd>
        </div>
      </dl>
      <div className="work-card-actions">
        <button
          className="primary-action"
          onClick={() => store.getState().commands.startConstellationDraft(star.id)}
          type="button"
        >
          별자리에 묶기
        </button>
        <button
          className="secondary-action"
          onClick={() => store.getState().commands.markRewatched(star.id)}
          type="button"
        >
          {(star.rewatchCount ?? 0) > 0
            ? `다시 봤어요 ✨ ${star.rewatchCount}회`
            : '다시 봤어요'}
        </button>
        <button
          className="secondary-action"
          onClick={() => openDeleteConfirmation('soft')}
          type="button"
        >
          블랙홀로 이동
        </button>
        <button
          className="danger-action"
          onClick={() => openDeleteConfirmation('hard')}
          type="button"
        >
          작품 영구 삭제
        </button>
      </div>

      {pendingDelete !== null && (
        <ConfirmDialog
          affectedConstellationNames={pendingDelete.affectedConstellationNames}
          confirmLabel={pendingDelete.mode === 'hard' ? '영구 삭제 실행' : '블랙홀 이동 실행'}
          description={pendingDelete.mode === 'hard'
            ? '이 작품은 복원할 수 없도록 영구 삭제되며 블랙홀 아카이브에 보관되지 않습니다.'
            : '이 작품을 블랙홀 아카이브로 이동하고 별자리 연결에서 제거합니다.'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          title={pendingDelete.mode === 'hard' ? '영구 삭제 확인' : '블랙홀 이동 확인'}
        />
      )}
    </aside>
  );
}
