import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { GENRES } from '../domain/models';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { GenreBadge } from './WorkMetadata';

export interface WatchlistPanelProps {
  store: ArchiveStoreApi;
}

/**
 * Works the user wants to see, each drifting in the sky as a hazy nebula.
 * Promoting one hands its details to the add-work form, where finishing the
 * log condenses the nebula into a real star.
 */
export function WatchlistPanel({ store }: WatchlistPanelProps) {
  const watchlist = useStore(store, (state) => state.persisted.watchlist);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entries = useMemo(
    () => [...watchlist].sort((left, right) => right.addedAt.localeCompare(left.addedAt)),
    [watchlist],
  );

  const addEntry = () => {
    const result = store.getState().commands.addToWatchlist({ title, genre });
    if (!result.ok) {
      setError(result.error.message);
      setNotice(null);
      return;
    }
    setTitle('');
    setGenre('');
    setError(null);
    setNotice('성운이 떠올랐어요. 보고 나면 별로 만들어 주세요.');
  };

  const promote = (entryId: string) => {
    store.getState().commands.beginWatchlistPromotion(entryId);
    setNotice('작품 추가 패널에 채워 뒀어요 — 별점과 감상평만 남기면 별이 됩니다.');
    setError(null);
  };

  return (
    <section aria-labelledby="watchlist-heading" className="watchlist-panel">
      <h2 id="watchlist-heading">보고 싶은 작품</h2>
      <p className="watchlist-intro">
        아직 만나지 못한 이야기는 흐릿한 성운으로 하늘에 떠 있어요.
      </p>

      <div className="watchlist-form">
        <label htmlFor="watchlist-title">제목</label>
        <input
          id="watchlist-title"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="watchlist-genre">장르</label>
        <select
          id="watchlist-genre"
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
        >
          <option value="">장르 선택</option>
          {GENRES.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button className="primary-action" onClick={addEntry} type="button">
          성운으로 담기
        </button>
      </div>
      {error !== null && <p className="field-error" role="alert">{error}</p>}
      {notice !== null && <p className="watchlist-notice" role="status">{notice}</p>}

      <h3 className="watchlist-count">담아 둔 작품 ({entries.length})</h3>
      {entries.length === 0 ? (
        <p className="empty-state">아직 담아 둔 작품이 없어요.</p>
      ) : (
        <ul className="watchlist-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="work-title">{entry.title}</span>
              <GenreBadge genre={entry.genre} />
              <div className="watchlist-entry-actions">
                <button
                  className="secondary-action"
                  onClick={() => promote(entry.id)}
                  type="button"
                >
                  봤어요, 별로 만들기
                </button>
                <button
                  className="danger-action"
                  onClick={() => store.getState().commands.removeFromWatchlist(entry.id)}
                  type="button"
                >
                  제거
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
