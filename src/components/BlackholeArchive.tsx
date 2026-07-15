import { useState } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { ConfirmDialog } from './ConfirmDialog';

interface PendingArchiveDelete {
  starId: string;
  title: string;
  affectedConstellationNames: string[];
}

export interface BlackholeArchiveProps {
  store: ArchiveStoreApi;
  headingId?: string;
}

export function BlackholeArchive({
  store,
  headingId = 'blackhole-archive-heading',
}: BlackholeArchiveProps) {
  const archivedWorks = useStore(
    store,
    (state) => state.persisted.blackholeArchive,
  );
  const [pendingDelete, setPendingDelete] = useState<PendingArchiveDelete | null>(null);

  const openPermanentDelete = (starId: string, title: string) => {
    setPendingDelete({
      starId,
      title,
      affectedConstellationNames:
        store.getState().commands.getAffectedConstellationNames(starId),
    });
  };

  const confirmPermanentDelete = () => {
    if (pendingDelete === null) return;
    const result = store.getState().commands.hardDelete(pendingDelete.starId);
    if (result.ok) setPendingDelete(null);
  };

  return (
    <section aria-labelledby={headingId} className="archive-panel">
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">BLACKHOLE ARCHIVE</p>
          <h2 id={headingId}>블랙홀 아카이브</h2>
        </div>
        <span className="archive-count" aria-label={`보관 작품 ${archivedWorks.length}개`}>
          {archivedWorks.length}
        </span>
      </div>

      {archivedWorks.length === 0 ? (
        <p className="empty-state" aria-live="polite">보관된 작품이 없습니다</p>
      ) : (
        <ul className="archive-list">
          {archivedWorks.map((work) => (
            <li className="archive-list-item" key={work.id}>
              <h3>{work.title}</h3>
              <dl>
                <div>
                  <dt>감독</dt>
                  <dd>{work.director}</dd>
                </div>
                <div>
                  <dt>보관일</dt>
                  <dd><time dateTime={work.discardedAt}>{work.discardedAt}</time></dd>
                </div>
                <div>
                  <dt>감상평</dt>
                  <dd>{work.review.length === 0 ? '작성된 감상평이 없습니다.' : work.review}</dd>
                </div>
              </dl>
              <div className="archive-actions">
                <button
                  className="primary-action"
                  onClick={() => store.getState().commands.restoreArchived(work.id)}
                  type="button"
                >
                  {work.title} 복원
                </button>
                <button
                  className="danger-action"
                  onClick={() => openPermanentDelete(work.id, work.title)}
                  type="button"
                >
                  {work.title} 영구 삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          affectedConstellationNames={pendingDelete.affectedConstellationNames}
          confirmLabel="영구 삭제 실행"
          description={`${pendingDelete.title} 작품을 블랙홀 아카이브에서도 영구 삭제합니다.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmPermanentDelete}
          title="보관 작품 영구 삭제 확인"
        />
      )}
    </section>
  );
}
