// Feature: space-movie-archive, Property 8: Genre Filter 상태 전이와 멱등성
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GENRES, type Genre, type Star } from '../../src/domain/models';
import { PersistenceService } from '../../src/persistence/persistenceService';
import {
  createGenreFilterSceneViewModel,
  DEFAULT_GALAXY_INTENSITY,
  GENRE_FILTER_TWEEN_DURATION_SECONDS,
  SELECTED_GALAXY_INTENSITY,
  SELECTED_STAR_OPACITY,
  UNSELECTED_GALAXY_INTENSITY,
  UNSELECTED_STAR_OPACITY,
} from '../../src/scene/genreFilterViewModel';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

interface CurrentValueSeed {
  alreadyAtTarget: boolean;
  candidate: number;
}

const genreArbitrary = fc.constantFrom(...GENRES);
const currentValueSeedArbitrary: fc.Arbitrary<CurrentValueSeed> = fc.record({
  alreadyAtTarget: fc.boolean(),
  candidate: fc.constantFrom(-0.5, 0, 0.15, 0.25, 0.75, 1, 1.5, 2),
});

const scenarioArbitrary = fc.record({
  toggleSequence: fc.array(genreArbitrary, { minLength: 0, maxLength: 80 }),
  starCurrentValues: fc.array(currentValueSeedArbitrary, {
    minLength: GENRES.length,
    maxLength: GENRES.length,
  }),
  galaxyCurrentValues: fc.array(currentValueSeedArbitrary, {
    minLength: GENRES.length,
    maxLength: GENRES.length,
  }),
});

function createStar(genre: Genre, index: number): Star {
  return {
    id: `genre-filter-star-${index}`,
    title: genre,
    normalizedTitle: genre.toLocaleLowerCase('und'),
    genre,
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function resolveCurrentValue(target: number, seed: CurrentValueSeed): number {
  if (seed.alreadyAtTarget) return target;
  return Object.is(seed.candidate, target) ? target + 0.125 : seed.candidate;
}

function expectedStarOpacity(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): number {
  return selectedGenres.size === 0 || selectedGenres.has(genre)
    ? SELECTED_STAR_OPACITY
    : UNSELECTED_STAR_OPACITY;
}

function expectedGalaxyIntensity(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): number {
  if (selectedGenres.size === 0) return DEFAULT_GALAXY_INTENSITY;
  return selectedGenres.has(genre)
    ? SELECTED_GALAXY_INTENSITY
    : UNSELECTED_GALAXY_INTENSITY;
}

function createTestStore() {
  return createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
    }),
  });
}

describe('Property 8: Genre Filter state transitions and idempotency', () => {
  it('R6.1-R6.8 R6.10-R6.16 preserves Set toggle semantics and creates only necessary visual tweens', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const store = createTestStore();
        const expectedSelection = new Set<Genre>();

        try {
          for (const genre of scenario.toggleSequence) {
            const previousSelection = store.getState().runtime.selectedGenres;
            store.getState().commands.toggleSelectedGenre(genre);
            const actualSelection = store.getState().runtime.selectedGenres;

            if (expectedSelection.has(genre)) expectedSelection.delete(genre);
            else expectedSelection.add(genre);

            expect(actualSelection).toEqual(expectedSelection);
            expect(actualSelection).not.toBe(previousSelection);
          }

          const actualSelection = store.getState().runtime.selectedGenres;
          const stars = GENRES.map(createStar);
          const galaxies = store.getState().persisted.galaxies;
          const genreGalaxies = galaxies.filter(
            (galaxy) => galaxy.kind.type === 'genre',
          );

          expect(actualSelection).toEqual(expectedSelection);
          expect(genreGalaxies).toHaveLength(GENRES.length);

          const starOpacityById = new Map<string, number>();
          const galaxyIntensityById = new Map<string, number>();

          stars.forEach((star, index) => {
            const seed = scenario.starCurrentValues[index];
            if (seed === undefined) throw new Error('Missing Star current-value seed');
            starOpacityById.set(
              star.id,
              resolveCurrentValue(
                expectedStarOpacity(star.genre, expectedSelection),
                seed,
              ),
            );
          });

          genreGalaxies.forEach((galaxy, index) => {
            const seed = scenario.galaxyCurrentValues[index];
            if (seed === undefined) throw new Error('Missing Galaxy current-value seed');
            if (galaxy.kind.type !== 'genre') {
              throw new Error('Expected only Genre galaxies');
            }
            galaxyIntensityById.set(
              galaxy.id,
              resolveCurrentValue(
                expectedGalaxyIntensity(galaxy.kind.genre, expectedSelection),
                seed,
              ),
            );
          });

          const viewModel = createGenreFilterSceneViewModel(
            stars,
            galaxies,
            actualSelection,
            { starOpacityById, galaxyIntensityById },
          );

          expect(viewModel.stars).toHaveLength(GENRES.length);
          expect(viewModel.galaxies).toHaveLength(GENRES.length);
          expect(new Set(viewModel.stars.map(({ genre }) => genre))).toEqual(
            new Set(GENRES),
          );
          expect(new Set(viewModel.galaxies.map(({ genre }) => genre))).toEqual(
            new Set(GENRES),
          );

          for (const star of viewModel.stars) {
            const current = starOpacityById.get(star.id);
            if (current === undefined) {
              throw new Error(`Missing current opacity: ${star.id}`);
            }
            const target = expectedStarOpacity(star.genre, expectedSelection);

            expect(star.target).toBe(target);
            expect(star.tween).toEqual(
              Object.is(current, target)
                ? null
                : {
                    from: current,
                    to: target,
                    durationSeconds: GENRE_FILTER_TWEEN_DURATION_SECONDS,
                  },
            );
          }

          for (const galaxy of viewModel.galaxies) {
            const current = galaxyIntensityById.get(galaxy.id);
            if (current === undefined) {
              throw new Error(`Missing current intensity: ${galaxy.id}`);
            }
            const target = expectedGalaxyIntensity(
              galaxy.genre,
              expectedSelection,
            );

            expect(galaxy.target).toBe(target);
            expect(galaxy.tween).toEqual(
              Object.is(current, target)
                ? null
                : {
                    from: current,
                    to: target,
                    durationSeconds: GENRE_FILTER_TWEEN_DURATION_SECONDS,
                  },
            );
          }
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 200 },
    );
  });
});
