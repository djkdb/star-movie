// Feature: space-movie-archive, Property 7: HUD 통계의 정확성
// **Validates: Requirements 5.1, 5.2, 5.4, 5.8**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import { GENRES, type Genre, type Rating, type Star } from '../../src/domain/models';
import { selectHudViewModel } from '../../src/store/selectors';

interface StarDescriptor {
  genre: Genre;
  rating: Rating;
}

interface HudCaseBundle {
  collections: StarDescriptor[][];
  exactHalfBoundaryRatings: Rating[];
  expectedTiedGenres: Genre[];
}

const genreArbitrary = fc.constantFrom(...GENRES);
const ratingArbitrary = fc.constantFrom<Rating>(1, 2, 3, 4, 5);

function ratingsWithSum(count: number, sum: number): Rating[] {
  const ratings = Array<Rating>(count).fill(1);
  let remaining = sum - count;

  for (let index = 0; index < ratings.length && remaining > 0; index += 1) {
    const increment = Math.min(4, remaining);
    ratings[index] = (ratings[index]! + increment) as Rating;
    remaining -= increment;
  }

  if (remaining !== 0) throw new Error('Requested rating sum is outside the valid range');
  return ratings;
}

function makeStar(index: number, descriptor: StarDescriptor): Star {
  return {
    id: `70000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    title: `HUD Work ${index}`,
    normalizedTitle: `hud work ${index}`,
    genre: descriptor.genre,
    rating: descriptor.rating,
    review: '',
    watchedDate: '2032-01-01',
    director: 'HUD Director',
    normalizedDirector: 'hud director',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2032-01-01T00:00:00.000Z',
  };
}

function expectedRoundedAverage(stars: readonly Star[]): number | null {
  if (stars.length === 0) return null;
  const ratingSum = stars.reduce((sum, star) => sum + star.rating, 0);
  const roundedTenths = Math.floor(
    (ratingSum * 20 + stars.length) / (stars.length * 2),
  );
  return roundedTenths / 10;
}

function expectedTopGenres(stars: readonly Star[]): Genre[] {
  if (stars.length === 0) return [];

  const counts = new Map<Genre, number>(GENRES.map((genre) => [genre, 0]));
  for (const star of stars) counts.set(star.genre, counts.get(star.genre)! + 1);
  const maximum = Math.max(...counts.values());
  return GENRES.filter((genre) => counts.get(genre) === maximum);
}

const hudCaseBundleArbitrary: fc.Arbitrary<HudCaseBundle> = fc.record({
  exactHalfBoundarySum: fc.integer({ min: 21, max: 99 }).filter((sum) => sum % 2 === 1),
  halfBoundaryGenre: genreArbitrary,
  tiedGenres: fc.uniqueArray(genreArbitrary, {
    minLength: 2,
    maxLength: GENRES.length,
  }),
  tiedMaximum: fc.integer({ min: 1, max: 8 }),
  milestoneCount: fc.integer({ min: 101, max: 130 }),
  milestoneGenre: genreArbitrary,
  milestoneRating: ratingArbitrary,
  randomCollection: fc.array(
    fc.record({ genre: genreArbitrary, rating: ratingArbitrary }),
    { minLength: 0, maxLength: 130 },
  ),
}).map((generated) => {
  const exactHalfBoundaryRatings = ratingsWithSum(20, generated.exactHalfBoundarySum);
  const halfBoundaryCollection = exactHalfBoundaryRatings.map((rating) => ({
    genre: generated.halfBoundaryGenre,
    rating,
  }));

  const tiedGenreSet = new Set(generated.tiedGenres);
  const tiedCollection = GENRES.flatMap((genre, genreIndex) => {
    const count = tiedGenreSet.has(genre)
      ? generated.tiedMaximum
      : genreIndex % generated.tiedMaximum;
    return Array.from({ length: count }, (_, index) => ({
      genre,
      rating: ((index % 5) + 1) as Rating,
    }));
  });

  const milestoneCollection = Array.from({ length: generated.milestoneCount }, () => ({
    genre: generated.milestoneGenre,
    rating: generated.milestoneRating,
  }));

  return {
    collections: [
      [],
      halfBoundaryCollection,
      tiedCollection,
      milestoneCollection,
      generated.randomCollection,
    ],
    exactHalfBoundaryRatings,
    expectedTiedGenres: GENRES.filter((genre) => tiedGenreSet.has(genre)),
  };
});

describe('Property 7: HUD statistics accuracy', () => {
  it('R5.1 R5.2 R5.4 R5.8 derives exact count, rounded average, tied Genres, and capped milestone progress', () => {
    fc.assert(
      fc.property(hudCaseBundleArbitrary, ({
        collections,
        exactHalfBoundaryRatings,
        expectedTiedGenres,
      }) => {
        const halfBoundarySum = exactHalfBoundaryRatings.reduce((sum, rating) => sum + rating, 0);
        expect(halfBoundarySum % 2).toBe(1);
        expect(exactHalfBoundaryRatings).toHaveLength(20);

        for (const [collectionIndex, descriptors] of collections.entries()) {
          const state = createDefaultStore(true);
          state.persisted.stars = descriptors.map((descriptor, index) => (
            makeStar(collectionIndex * 1_000 + index, descriptor)
          ));

          const hud = selectHudViewModel(state);
          const expectedAverage = expectedRoundedAverage(state.persisted.stars);
          const topGenres = expectedTopGenres(state.persisted.stars);

          expect(hud.activeWorkCount).toBe(state.persisted.stars.length);
          expect(hud.averageRating).toBe(expectedAverage);
          expect(hud.averageRatingLabel).toBe(
            expectedAverage === null ? '—' : expectedAverage.toFixed(1),
          );
          expect(new Set(hud.topGenres)).toEqual(new Set(topGenres));
          expect(hud.topGenreLabel).toBe(topGenres.length === 0 ? '없음' : topGenres.join(', '));
          expect(hud.milestones.fifty.current).toBe(Math.min(state.persisted.stars.length, 50));
          expect(hud.milestones.hundred.current).toBe(Math.min(state.persisted.stars.length, 100));
        }

        expect(new Set(selectTopGenresFromDescriptors(collections[2]!)))
          .toEqual(new Set(expectedTiedGenres));
        expect(collections[3]!.length).toBeGreaterThan(100);
      }),
      { numRuns: 200 },
    );
  });
});

function selectTopGenresFromDescriptors(descriptors: readonly StarDescriptor[]): Genre[] {
  const stars = descriptors.map((descriptor, index) => makeStar(index, descriptor));
  return expectedTopGenres(stars);
}
