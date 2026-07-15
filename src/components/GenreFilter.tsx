import { useStore } from 'zustand';

import { GENRES } from '../domain/models';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { GENRE_ICONS } from './WorkMetadata';

export interface GenreFilterProps {
  store: ArchiveStoreApi;
}

export function GenreFilter({ store }: GenreFilterProps) {
  const selectedGenres = useStore(store, (state) => state.runtime.selectedGenres);

  return (
    <section className="genre-filter glass-panel" aria-labelledby="filter-heading">
      <h2 id="filter-heading">장르 필터</h2>
      <div className="filter-options" aria-label="장르 선택">
        {GENRES.map((genre) => {
          const selected = selectedGenres.has(genre);
          return (
            <button
              className={`filter-chip${selected ? ' is-selected' : ''}`}
              key={genre}
              type="button"
              aria-pressed={selected}
              onClick={() => store.getState().commands.toggleSelectedGenre(genre)}
            >
              <span aria-hidden="true" className="genre-icon">{GENRE_ICONS[genre]}</span>
              <span>{genre}</span>
            </button>
          );
        })}
      </div>
      <p className="filter-status" aria-live="polite">
        {selectedGenres.size === 0
          ? '모든 장르 표시'
          : `${selectedGenres.size}개 장르 선택됨`}
      </p>
    </section>
  );
}
