import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Constellation,
  type Genre,
  type Rating,
  type Star,
  type Store,
} from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import { PersistenceService } from '../../src/persistence/persistenceService';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

const TARGET_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2025-06-01T00:00:00.000Z';

interface StarSeed {
  genre: Genre;
  rating: Rating;
  dayOffset: number;
}

interface ConstellationSeed {
  includeTarget: boolean;
  targetPosition: number;
  survivorIndexes: number[];
}

interface StateSeed {
  target: StarSeed;
  survivors: StarSeed[];
  archived: StarSeed[];
  targetPosition: number;
  constellations: ConstellationSeed[];
}

const starSeedArbitrary: fc.Arbitrary<StarSeed> = fc.record({
  genre: fc.constantFrom(...GENRES),
  rating: fc.constantFrom<Rating>(1, 2, 3, 4, 5),
  dayOffset: fc.integer({ min: 0, max: 365 }),
});

const stateSeedArbitrary: fc.Arbitrary<StateSeed> = fc.record({
  target: starSeedArbitrary,
  survivors: fc.array(starSeedArbitrary, { maxLength: 10 }),
  archived: fc.array(starSeedArbitrary, { maxLength: 8 }),
  targetPosition: fc.nat(),
  constellations: fc.array(
    fc.record({
      includeTarget: fc.boolean(),
      targetPosition: fc.nat(),
      survivorIndexes: fc.uniqueArray(fc.integer({ min: 0, max: 9 }), {
        maxLength: 10,
      }),
    }),
    { maxLength: 12 },
  ),
});

function makeUuid(namespace: number, value: number): string {
  return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;
}

function createStar(
  seed: StarSeed,
  id: string,
  label: string,
  state: Store,
): Star {
  const galaxy = state.persisted.galaxies.find(
    (candidate) =>
      candidate.kind.type === 'genre' && candidate.kind.genre === seed.genre,
  );
  if (galaxy === undefined) throw new Error(`Missing galaxy for ${seed.genre}`);

  const watchedDate = new Date(Date.UTC(2024, 0, 1 + seed.dayOffset))
    .toISOString()
    .slice(0, 10);
  const title = `${label} Title`;
  const director = `${label} Director`;
  return {
    id,
    title,
    normalizedTitle: normalizeText(title),
    genre: seed.genre,
    rating: seed.rating,
    review: `${label} review`,
    watchedDate,
    director,
    normalizedDirector: normalizeText(director),
    position: { ...galaxy.center },
    createdAt: `${watchedDate}T00:00:00.000Z`,
  };
}

function createInitialState(seed: StateSeed): Store {
  const state = createDefaultStore(true);
  const survivors = seed.survivors.map((starSeed, index) =>
    createStar(starSeed, makeUuid(0x11000000, index + 1), `Active ${index + 1}`, state),
  );
  const target = createStar(seed.target, TARGET_ID, 'Target', state);
  const targetPosition = seed.targetPosition % (survivors.length + 1);
  state.persisted.stars = [
    ...survivors.slice(0, targetPosition),
    target,
    ...survivors.slice(targetPosition),
  ];
  state.persisted.blackholeArchive = seed.archived.map((starSeed, index) => ({
    ...createStar(
      starSeed,
      makeUuid(0x22000000, index + 1),
      `Archived ${index + 1}`,
      state,
    ),
    discardedAt: `2025-05-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

  const survivorIds = survivors.map(({ id }) => id);
  state.persisted.constellations = seed.constellations.map(
    (constellationSeed, index): Constellation => {
      const starIds = constellationSeed.survivorIndexes
        .filter((survivorIndex) => survivorIndex < survivorIds.length)
        .map((survivorIndex) => survivorIds[survivorIndex]!);
      if (constellationSeed.includeTarget) {
        const insertionIndex = constellationSeed.targetPosition % (starIds.length + 1);
        starIds.splice(insertionIndex, 0, TARGET_ID);
      }
      return {
        id: makeUuid(0x33000000, index + 1),
        name: `Constellation ${index + 1}`,
        starIds,
        color: `#${(index + 1).toString(16).padStart(6, '0')}`,
        createdAt: `2025-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      };
    },
  );
  state.runtime.selectedStarId = TARGET_ID;
  return state;
}

// Feature: space-movie-archive, Property 6: Hard Delete의 영구 제거
// **Validates: Requirements 4.5, 4.6, 4.8, 4.9, 10.9, 12.9, 12.13**
describe('Property 6: Hard Delete의 영구 제거', () => {
  it('R4.5 R4.6 R4.8 R4.9 R10.9 R12.9 R12.13 reports the exact impact set and permanently removes the target while preserving survivors', () => {
    fc.assert(
      fc.property(stateSeedArbitrary, (seed) => {
        const initialState = createInitialState(seed);
        const initialPersisted = structuredClone(initialState.persisted);
        const expectedAffectedNames = new Set(
          initialPersisted.constellations
            .filter(({ starIds }) => starIds.includes(TARGET_ID))
            .map(({ name }) => name),
        );
        const expectedConstellations = initialPersisted.constellations.map(
          ({ id, name, starIds }) => ({
            id,
            name,
            starIds: starIds.filter((starId) => starId !== TARGET_ID),
          }),
        );
        const nonTargetArchive = structuredClone(initialPersisted.blackholeArchive);
        const store = createArchiveStore({
          persistence: new PersistenceService({
            storage: new FakeLocalStorageAdapter(),
            scheduler: new FakeClock(),
            nowIso: () => NOW,
          }),
          initialState,
          providers: { nowIso: () => NOW },
        });

        expect(
          new Set(store.getState().commands.getAffectedConstellationNames(TARGET_ID)),
        ).toEqual(expectedAffectedNames);

        const result = store.getState().commands.hardDelete(TARGET_ID);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`Hard Delete failed: ${result.error.message}`);
        expect(new Set(result.value.affectedConstellationNames)).toEqual(
          expectedAffectedNames,
        );

        const persisted = store.getState().persisted;
        expect(persisted.stars.map(({ id }) => id)).toEqual(
          initialPersisted.stars
            .filter(({ id }) => id !== TARGET_ID)
            .map(({ id }) => id),
        );
        expect(persisted.stars.some(({ id }) => id === TARGET_ID)).toBe(false);
        expect(
          persisted.blackholeArchive.some(({ id }) => id === TARGET_ID),
        ).toBe(false);
        expect(persisted.blackholeArchive).toEqual(nonTargetArchive);
        expect(
          persisted.constellations.map(({ id, name, starIds }) => ({
            id,
            name,
            starIds,
          })),
        ).toEqual(expectedConstellations);
        expect(
          persisted.constellations.every(
            ({ starIds }) => !starIds.includes(TARGET_ID),
          ),
        ).toBe(true);

        store.dispose();
      }),
      { numRuns: 100 },
    );
  });
});
