// Feature: space-movie-archive, Property 9: ListView의 결정론적 전순서와 조건 일치
// **Validates: Requirements 7.4, 7.5, 7.8, 7.10**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import { GENRES, type Genre, type Rating, type Star } from '../../src/domain/models';
import {
  selectListViewModel,
  type ListSortOption,
} from '../../src/store/selectors';

interface ExtraWorkSeed {
  title: string;
  director: string;
  genre: Genre;
  rating: Rating;
  createdAt: string;
}

type SearchKind = 'empty' | 'title' | 'director' | 'missing';

const titles = [
  'Nebula Archive',
  'Orbit Café',
  '별빛 여행',
  'Shared Memory',
  'Cosmic Drama',
] as const;
const directors = [
  'Ava Director',
  'Query Director',
  '봉준호',
  'Nolan Observer',
] as const;
const timestamps = [
  '2024-01-01T00:00:00.000Z',
  '2025-04-05T06:07:08.000Z',
  '2025-04-05T06:07:08.000Z',
  '2026-12-31T23:59:59.000Z',
] as const;

const genreArbitrary = fc.constantFrom(...GENRES);
const ratingArbitrary = fc.integer({ min: 1, max: 5 }).map((rating) => rating as Rating);
const extraWorkArbitrary: fc.Arbitrary<ExtraWorkSeed> = fc.record({
  title: fc.constantFrom(...titles),
  director: fc.constantFrom(...directors),
  genre: genreArbitrary,
  rating: ratingArbitrary,
  createdAt: fc.constantFrom(...timestamps),
});

const scenarioArbitrary = fc.record({
  extras: fc.array(extraWorkArbitrary, { minLength: 0, maxLength: 20 }),
  sortBy: fc.constantFrom<ListSortOption>('rating', 'latest'),
  searchKind: fc.constantFrom<SearchKind>('empty', 'title', 'director', 'missing'),
  selectedGenres: fc.uniqueArray(genreArbitrary, { minLength: 2, maxLength: GENRES.length }),
  incorrectCountDelta: fc.integer({ min: 1, max: 100 }),
  reverseInput: fc.boolean(),
});

function normalizeBySpecification(value: string): string {
  return value.trim().toLocaleLowerCase('und').normalize('NFC');
}

function makeUuid(index: number): string {
  return `90000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createStar(
  index: number,
  input: {
    title: string;
    director: string;
    genre: Genre;
    rating: Rating;
    createdAt: string;
  },
): Star {
  return {
    id: makeUuid(index),
    title: input.title,
    normalizedTitle: normalizeBySpecification(input.title),
    genre: input.genre,
    rating: input.rating,
    review: '',
    watchedDate: '2025-01-01',
    director: input.director,
    normalizedDirector: normalizeBySpecification(input.director),
    position: { x: 0, y: 0, z: 0 },
    createdAt: input.createdAt,
  };
}

function createTieBoundaryStars(selectedGenres: readonly Genre[]): Star[] {
  const firstGenre = selectedGenres[0];
  const secondGenre = selectedGenres[1];
  if (firstGenre === undefined || secondGenre === undefined) {
    throw new Error('Property generator must select at least two Genres');
  }

  return [
    createStar(1, {
      title: 'Shared Voyage',
      director: 'Query Director',
      genre: firstGenre,
      rating: 4,
      createdAt: '2025-06-01T00:00:00.000Z',
    }),
    createStar(2, {
      title: 'Shared Voyage',
      director: 'Query Director',
      genre: secondGenre,
      rating: 4,
      createdAt: '2025-06-01T00:00:00.000Z',
    }),
    createStar(3, {
      title: 'Shared Later',
      director: 'Query Director',
      genre: firstGenre,
      rating: 4,
      createdAt: '2025-07-01T00:00:00.000Z',
    }),
    createStar(4, {
      title: 'Shared Latest Low Rating',
      director: 'Query Director',
      genre: secondGenre,
      rating: 1,
      createdAt: '2025-08-01T00:00:00.000Z',
    }),
  ];
}

function queryFor(kind: SearchKind): string {
  switch (kind) {
    case 'empty':
      return '';
    case 'title':
      return '  SHARED  ';
    case 'director':
      return '\tquery DIRECTOR\n';
    case 'missing':
      return 'unfindable-search-token';
  }
}

function matchesBySpecification(
  star: Readonly<Star>,
  query: string,
  selectedGenres: ReadonlySet<Genre>,
): boolean {
  if (selectedGenres.size > 0 && !selectedGenres.has(star.genre)) return false;

  const normalizedQuery = normalizeBySpecification(query);
  return normalizedQuery.length === 0
    || star.normalizedTitle.includes(normalizedQuery)
    || star.normalizedDirector.includes(normalizedQuery);
}

function compareTextAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareBySpecification(
  left: Readonly<Star>,
  right: Readonly<Star>,
  sortBy: ListSortOption,
): number {
  if (sortBy === 'rating' && left.rating !== right.rating) {
    return right.rating - left.rating;
  }

  const timestampOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timestampOrder !== 0) return timestampOrder;

  const titleOrder = compareTextAscending(left.normalizedTitle, right.normalizedTitle);
  if (titleOrder !== 0) return titleOrder;
  return compareTextAscending(left.id, right.id);
}

describe('Property 9: ListView deterministic total order and predicate membership', () => {
  it('R7.4 R7.5 R7.8 R7.10 returns the exact predicate permutation in total order despite an incorrect separate count', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const selectedGenres = new Set(scenario.selectedGenres);
        const query = queryFor(scenario.searchKind);
        const generatedStars = [
          ...createTieBoundaryStars(scenario.selectedGenres),
          ...scenario.extras.map((extra, index) => createStar(index + 100, extra)),
        ];
        const inputStars = scenario.reverseInput
          ? [...generatedStars].reverse()
          : generatedStars;
        const expected = generatedStars
          .filter((star) => matchesBySpecification(star, query, selectedGenres))
          .sort((left, right) => compareBySpecification(left, right, scenario.sortBy));
        const deliberatelyIncorrectSeparateCount = expected.length + scenario.incorrectCountDelta;

        const store = createDefaultStore(true);
        store.persisted.stars = inputStars;
        const actual = selectListViewModel(store, {
          sortBy: scenario.sortBy,
          searchQuery: query,
          selectedGenres,
        });

        expect(actual.activeWorks.map(({ id }) => id)).toEqual(expected.map(({ id }) => id));
        expect(new Set(actual.activeWorks.map(({ id }) => id))).toEqual(
          new Set(expected.map(({ id }) => id)),
        );
        expect(actual.activeWorkCount).toBe(expected.length);
        expect(actual.activeWorkCount).not.toBe(deliberatelyIncorrectSeparateCount);

        const reorderedStore = createDefaultStore(true);
        reorderedStore.persisted.stars = [...inputStars].reverse();
        const reordered = selectListViewModel(reorderedStore, {
          sortBy: scenario.sortBy,
          searchQuery: query,
          selectedGenres,
        });
        expect(reordered.activeWorks.map(({ id }) => id)).toEqual(
          actual.activeWorks.map(({ id }) => id),
        );
      }),
      { numRuns: 200 },
    );
  });
});
