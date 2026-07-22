import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import {
  selectListViewModel,
  type ListSortOption,
} from '../store/selectors';
import { EmptyState } from './EmptyState';
import { GenreBadge, RatingDisplay } from './WorkMetadata';

export interface ListViewProps {
  store: ArchiveStoreApi;
}

export function ListView({ store }: ListViewProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const selectedGenres = useStore(store, (state) => state.runtime.selectedGenres);
  const isDrawerOpen = useStore(store, (state) => state.runtime.isListDrawerOpen);
  const [sortBy, setSortBy] = useState<ListSortOption>('rating');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const desktopQuery = window.matchMedia('(min-width: 768px)');
    let wasDesktop = desktopQuery.matches;
    const preserveDesktopVisibility = (event: MediaQueryListEvent) => {
      if (wasDesktop && !event.matches) {
        store.getState().commands.setListDrawerOpen(true);
      }
      wasDesktop = event.matches;
    };
    desktopQuery.addEventListener('change', preserveDesktopVisibility);
    return () => desktopQuery.removeEventListener('change', preserveDesktopVisibility);
  }, [store]);
  const viewModel = useMemo(
    () => selectListViewModel(
      { persisted, runtime: store.getState().runtime },
      { sortBy, searchQuery, selectedGenres },
    ),
    [persisted, searchQuery, selectedGenres, sortBy, store],
  );

  return (
    <>
      <button
        className="drawer-toggle"
        type="button"
        aria-controls="archive-list-drawer"
        aria-expanded={isDrawerOpen}
        onClick={() => store.getState().commands.toggleListDrawer()}
      >
        {isDrawerOpen ? '목록 닫기' : '목록 열기'}
      </button>
      <aside
        id="archive-list-drawer"
        className={`list-view glass-panel${isDrawerOpen ? ' is-open' : ''}`}
        data-drawer-state={isDrawerOpen ? 'open' : 'closed'}
        aria-labelledby="list-view-heading"
      >
        <h2 id="list-view-heading">작품 목록</h2>
        <div className="list-controls">
          <label htmlFor="work-search">검색</label>
          <input
            id="work-search"
            type="search"
            placeholder="제목 또는 감독"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <label htmlFor="work-sort">정렬</label>
          <select
            id="work-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ListSortOption)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setSortBy(event.key === 'ArrowDown' ? 'latest' : 'rating');
            }}
          >
            <option value="rating">별점 높은 순</option>
            <option value="latest">최신 등록 순</option>
          </select>
        </div>

        <section aria-labelledby="active-work-heading">
          <h3 id="active-work-heading">활성 작품 ({viewModel.activeWorkCount})</h3>
          {viewModel.activeWorksEmptyMessage !== null ? (
            <EmptyState role="status" title={viewModel.activeWorksEmptyMessage} variant="archive" />
          ) : (
            <ul className="work-list">
              {viewModel.activeWorks.map((work, index) => (
                <li className="stagger-in" key={work.id} style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}>
                  <button
                    type="button"
                    onClick={() => store.getState().commands.requestCameraFocus({
                      type: 'star',
                      starId: work.id,
                    })}
                  >
                    <span className="work-title">{work.title}</span>
                    <GenreBadge genre={work.genre} />
                    <RatingDisplay rating={work.rating} />
                    <span>{work.director}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="constellation-list-heading">
          <h3 id="constellation-list-heading">활성 별자리</h3>
          {viewModel.activeConstellations.length === 0 ? (
            <EmptyState title="활성 별자리가 없습니다" variant="constellation" />
          ) : (
            <ul className="constellation-list">
              {viewModel.activeConstellations.map((constellation, index) => (
                <li className="stagger-in" key={constellation.id} style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}>
                  <button
                    type="button"
                    onClick={() => store.getState().commands.requestCameraFocus({
                      type: 'constellation',
                      constellationId: constellation.id,
                    })}
                  >
                    <span
                      className="constellation-swatch"
                      style={{ backgroundColor: constellation.color }}
                      aria-hidden="true"
                    />
                    {constellation.name} ({constellation.activeStarCount})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="archive-list-heading">
          <h3 id="archive-list-heading">블랙홀 보관함</h3>
          {viewModel.archiveEmptyMessage !== null ? (
            <EmptyState role="status" title={viewModel.archiveEmptyMessage} variant="blackhole" />
          ) : (
            <ul className="compact-archive-list">
              {viewModel.archivedWorks.map((work, index) => (
                <li className="stagger-in" key={work.id} style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}>
                  <strong>{work.title}</strong>
                  <span>{work.director}</span>
                  <p>{work.review || '감상평 없음'}</p>
                  <time dateTime={work.discardedAt}>{work.discardedAt}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}
