import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { ArchivedStar, Genre, Rating, Star } from '../domain/models';
import { normalizeText } from '../domain/normalization';
import {
  calculateAverageRating,
  calculateTopGenres,
  compareActiveWorks,
  matchesActiveWorkListPredicate,
  roundHalfAwayFromZero,
  selectAchievementPanelViewModel,
  selectAchievementViewModels,
  selectActiveConstellations,
  selectHudViewModel,
  selectListViewModel,
  selectPlanetCodexViewModel,
} from './selectors';
import { PLANET_RARITIES } from '../domain/planetCatalog';

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createStar(
  index: number,
  overrides: Partial<Star> = {},
): Star {
  const title = overrides.title ?? `Work ${index}`;
  const director = overrides.director ?? 'Director';
  return {
    id: uuid(index),
    title,
    normalizedTitle: overrides.normalizedTitle ?? normalizeText(title),
    genre: overrides.genre ?? 'SF',
    rating: overrides.rating ?? 3,
    review: overrides.review ?? '',
    watchedDate: overrides.watchedDate ?? '2025-01-01',
    director,
    normalizedDirector: overrides.normalizedDirector ?? normalizeText(director),
    position: overrides.position ?? { x: 0, y: 0, z: 0 },
    createdAt: overrides.createdAt ?? `2025-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function createArchivedStar(index: number): ArchivedStar {
  return {
    ...createStar(index, { review: '기억할 장면', director: 'Archive Director' }),
    discardedAt: '2025-02-01T00:00:00.000Z',
  };
}

describe('HUD and achievement selectors', () => {
  it('R5.2 rounds exact half boundaries away from zero', () => {
    expect(roundHalfAwayFromZero(2.05, 1)).toBe(2.1);
    expect(roundHalfAwayFromZero(-2.05, 1)).toBe(-2.1);

    const ratings: Rating[] = [3, ...Array<Rating>(19).fill(2)];
    expect(calculateAverageRating(ratings.map((rating, index) => createStar(index + 1, { rating })))).toBe(2.1);
  });

  it('R5.1-R5.4 returns empty labels and every top-genre tie', () => {
    const state = createDefaultStore();
    expect(selectHudViewModel(state)).toMatchObject({
      activeWorkCount: 0,
      averageRating: null,
      averageRatingLabel: '—',
      topGenres: [],
      topGenreLabel: '없음',
    });

    const genres: Genre[] = ['SF', '드라마', 'SF', '드라마', '기타'];
    state.persisted.stars = genres.map((genre, index) => createStar(index + 1, { genre }));
    expect(calculateTopGenres(state.persisted.stars)).toEqual(['SF', '드라마']);
    expect(selectHudViewModel(state).topGenreLabel).toBe('SF, 드라마');
  });

  it('R5.7-R5.9 caps milestone progress and exposes achievement summary', () => {
    const state = createDefaultStore();
    state.persisted.stars = Array.from({ length: 105 }, (_, index) => createStar(index + 1));
    state.persisted.achievements[0] = {
      ...state.persisted.achievements[0]!,
      unlocked: true,
      unlockedAt: '2025-02-01T00:00:00.000Z',
    };

    const hud = selectHudViewModel(state);
    expect(hud.milestones.fifty.current).toBe(50);
    expect(hud.milestones.hundred.current).toBe(100);
    expect(hud.achievementSummary).toEqual({ unlockedCount: 1, totalCount: 1 });
  });

  it('R17.11 recalculates current achievement progress and preserves saved unlock metadata', () => {
    const state = createDefaultStore();
    state.persisted.achievements[0] = {
      ...state.persisted.achievements[0]!,
      progress: 99,
      unlocked: true,
      unlockedAt: '2025-02-01T00:00:00.000Z',
    };
    state.persisted.stars = [
      createStar(1, { title: 'Inception', director: 'Christopher Nolan' }),
      createStar(2, { title: ' inception ', director: 'CHRISTOPHER NOLAN' }),
      createStar(3, { title: 'Dunkirk', director: 'Christopher Nolan' }),
    ];

    expect(selectAchievementViewModels(state)[0]).toMatchObject({
      progress: 2,
      unlocked: true,
      unlockedAt: '2025-02-01T00:00:00.000Z',
    });

    state.runtime.isAchievementPanelOpen = true;
    expect(selectAchievementPanelViewModel(state)).toMatchObject({
      isOpen: true,
      achievements: [{ progress: 2, unlocked: true }],
    });
  });
});

describe('planet codex selector', () => {
  it('lists every species ordered by ascending rarity', () => {
    const state = createDefaultStore(true);
    const viewModel = selectPlanetCodexViewModel(state);

    expect(viewModel.entries).toHaveLength(viewModel.total);
    const ranks = viewModel.entries.map((entry) =>
      PLANET_RARITIES.indexOf(entry.species.rarity),
    );
    // Ranks must never decrease: common → rare → epic → legendary.
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
    expect(viewModel.entries[0]!.species.rarity).toBe('common');
    expect(viewModel.entries.at(-1)!.species.rarity).toBe('legendary');
  });
});

describe('ListView selectors', () => {
  it('R7.3-R7.5 applies rating and latest total-order tie breaks', () => {
    const earlier = createStar(1, {
      title: 'Zulu',
      rating: 5,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const alphaHigherId = createStar(3, {
      title: 'Alpha',
      rating: 5,
      createdAt: '2025-01-02T00:00:00.000Z',
    });
    const alphaLowerId = createStar(2, {
      title: 'Alpha',
      rating: 5,
      createdAt: '2025-01-02T00:00:00.000Z',
    });
    const latestLowRating = createStar(4, {
      title: 'Newest',
      rating: 1,
      createdAt: '2025-01-03T00:00:00.000Z',
    });
    const input = [earlier, alphaHigherId, latestLowRating, alphaLowerId];

    expect([...input].sort((left, right) => compareActiveWorks(left, right, 'rating')).map(({ id }) => id))
      .toEqual([alphaLowerId.id, alphaHigherId.id, earlier.id, latestLowRating.id]);
    expect([...input].sort((left, right) => compareActiveWorks(left, right, 'latest')).map(({ id }) => id))
      .toEqual([latestLowRating.id, alphaLowerId.id, alphaHigherId.id, earlier.id]);
  });

  it('R7.8-R7.10 uses normalized title/director search and selected Genre membership', () => {
    const romance = createStar(1, {
      title: '  INTERSTELLAR  ',
      director: 'Christopher Nolan',
      genre: '로맨스',
    });
    const selectedGenres = new Set<Genre>(['로맨스']);

    expect(matchesActiveWorkListPredicate(romance, ' interSTELLAR ', selectedGenres)).toBe(true);
    expect(matchesActiveWorkListPredicate(romance, ' NOLAN ', selectedGenres)).toBe(true);
    expect(matchesActiveWorkListPredicate(romance, '', new Set<Genre>(['SF']))).toBe(false);
  });

  it('R7.1-R7.3 and R7.9 builds active items with default rating sort and empty state', () => {
    const state = createDefaultStore();
    state.persisted.stars = [
      createStar(1, { rating: 2 }),
      createStar(2, { rating: 5 }),
    ];

    const list = selectListViewModel(state);
    expect(list.activeWorks.map(({ rating }) => rating)).toEqual([5, 2]);
    expect(list.activeWorks[0]).toMatchObject({
      title: 'Work 2',
      genre: 'SF',
      rating: 5,
      director: 'Director',
    });
    expect(list.activeWorksEmptyMessage).toBeNull();

    expect(selectListViewModel(state, { searchQuery: 'missing' })).toMatchObject({
      activeWorks: [],
      activeWorkCount: 0,
      activeWorksEmptyMessage: '조건에 맞는 작품이 없습니다',
    });
  });

  it('R10.6 keeps only constellations with two ordered active references', () => {
    const stars = [createStar(1), createStar(2), createStar(3)];
    const constellations = [
      {
        id: uuid(101),
        name: 'Active',
        starIds: [stars[2]!.id, uuid(999), stars[0]!.id],
        color: '#ffffff',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: uuid(102),
        name: 'Inactive',
        starIds: [stars[1]!.id, uuid(998)],
        color: '#000000',
        createdAt: '2025-01-02T00:00:00.000Z',
      },
    ];

    expect(selectActiveConstellations(constellations, stars)).toEqual([
      {
        id: uuid(101),
        name: 'Active',
        color: '#ffffff',
        createdAt: '2025-01-01T00:00:00.000Z',
        activeStarIds: [stars[2]!.id, stars[0]!.id],
        activeStarCount: 2,
      },
    ]);
  });

  it('R12.7 exposes archive section fields and empty-state text', () => {
    const state = createDefaultStore();
    expect(selectListViewModel(state).archiveEmptyMessage).toBe('보관된 작품이 없습니다');

    state.persisted.blackholeArchive = [createArchivedStar(1)];
    expect(selectListViewModel(state)).toMatchObject({
      archivedWorks: [{
        id: uuid(1),
        title: 'Work 1',
        review: '기억할 장면',
        director: 'Archive Director',
        discardedAt: '2025-02-01T00:00:00.000Z',
      }],
      archiveEmptyMessage: null,
    });
  });
});
