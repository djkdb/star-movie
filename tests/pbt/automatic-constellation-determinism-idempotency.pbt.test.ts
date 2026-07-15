import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import { GENRES, type Genre, type Star, type Store } from '../../src/domain/models';
import { decodePersistedV2 } from '../../src/persistence/persistedStateCodec';
import {
  PersistenceService,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock } from '../../src/test/providers';

const NOW = '2025-04-05T06:07:08.000Z';

interface Scenario {
  counts: number[];
  createdAtBuckets: number[];
  inputPriorities: number[];
  operationId: string;
}

const genreCountsArbitrary = fc.array(fc.integer({ min: 0, max: 4 }), {
  minLength: GENRES.length,
  maxLength: GENRES.length,
});

const operationIdArbitrary = fc.oneof(
  fc.uuid(),
  fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0),
);

const scenarioArbitrary: fc.Arbitrary<Scenario> = genreCountsArbitrary.chain(
  (counts) => {
    const totalStars = counts.reduce((sum, count) => sum + count, 0);
    return fc.record({
      counts: fc.constant(counts),
      createdAtBuckets: fc.oneof(
        fc.constant(Array.from({ length: totalStars }, () => 0)),
        fc.array(fc.integer({ min: 0, max: 3 }), {
          minLength: totalStars,
          maxLength: totalStars,
        }),
      ),
      inputPriorities: fc.array(fc.integer({ min: -100, max: 100 }), {
        minLength: totalStars,
        maxLength: totalStars,
      }),
      operationId: operationIdArbitrary,
    });
  },
);

function uuid(namespace: number, index: number): string {
  return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`;
}

function genreGalaxyCenter(state: Store, genre: Genre): Star['position'] {
  const galaxy = state.persisted.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === genre,
  );
  if (galaxy === undefined) throw new Error(`Missing ${genre} galaxy`);
  return galaxy.center;
}

function createState(scenario: Scenario): Store {
  const state = createDefaultStore(true);
  const entries: Array<{ inputIndex: number; star: Star }> = [];
  let inputIndex = 0;

  for (const [genreIndex, genre] of GENRES.entries()) {
    for (let localIndex = 0; localIndex < scenario.counts[genreIndex]!; localIndex += 1) {
      const id = uuid(0x14000000, inputIndex + 1);
      const createdAt = new Date(
        Date.UTC(2025, 0, 1, 0, 0, scenario.createdAtBuckets[inputIndex]!),
      ).toISOString();
      entries.push({
        inputIndex,
        star: {
          id,
          title: `Work ${inputIndex + 1}`,
          normalizedTitle: `work ${inputIndex + 1}`,
          genre,
          rating: 3,
          review: '',
          watchedDate: '2025-01-01',
          director: `Director ${inputIndex + 1}`,
          normalizedDirector: `director ${inputIndex + 1}`,
          position: { ...genreGalaxyCenter(state, genre) },
          createdAt,
        },
      });
      inputIndex += 1;
    }
  }

  entries.sort(
    (left, right) =>
      scenario.inputPriorities[left.inputIndex]! -
        scenario.inputPriorities[right.inputIndex]! ||
      right.inputIndex - left.inputIndex,
  );
  state.persisted.stars = entries.map(({ star }) => star);
  return state;
}

class CapturingStorage implements StorageAdapter {
  readonly values: string[] = [];

  getItem(): string | null {
    return null;
  }

  setItem(_key: string, value: string): void {
    this.values.push(value);
  }
}

// Feature: space-movie-archive, Property 14: 자동 별자리의 결정론과 멱등성
// **Validates: Requirements 9.10, 9.11, 9.13, 9.16, 9.18**
describe('Property 14: automatic constellation determinism and idempotency', () => {
  it('R9.10 R9.11 R9.13 R9.16 R9.18 creates each eligible Genre target in deterministic order atomically and ignores the repeated operationId', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const initialState = createState(scenario);
        const eligibleGenres = GENRES.filter(
          (_genre, index) => scenario.counts[index]! >= 2,
        );
        const generatedIds = eligibleGenres.map((_genre, index) =>
          uuid(0x14000001, index + 1),
        );
        let generatedIdIndex = 0;
        const storage = new CapturingStorage();
        const persistence = new PersistenceService({
          storage,
          scheduler: new FakeClock(),
          nowIso: () => NOW,
        });
        const store = createArchiveStore({
          persistence,
          initialState,
          providers: {
            nextUuid: () => {
              const id = generatedIds[generatedIdIndex];
              if (id === undefined) throw new Error('UUID sequence exhausted');
              generatedIdIndex += 1;
              return id;
            },
            nowIso: () => NOW,
          },
        });

        try {
          let notifications = 0;
          const unsubscribe = store.subscribe(() => {
            notifications += 1;
          });

          const first = store
            .getState()
            .commands.createGenreConstellations(scenario.operationId);
          expect(first).toEqual({
            ok: true,
            value: { constellationIds: generatedIds },
            completionEvents:
              eligibleGenres.length === 0 ? [] : [expect.any(Object)],
          });

          const afterFirstPersisted = structuredClone(store.getState().persisted);
          const afterFirstEvents = structuredClone(
            store.getState().runtime.completionEvents,
          );
          const writesAfterFirst = storage.values.length;
          const notificationsAfterFirst = notifications;

          const second = store
            .getState()
            .commands.createGenreConstellations(scenario.operationId);
          unsubscribe();

          expect(second).toEqual({
            ok: true,
            value: { constellationIds: generatedIds },
            completionEvents: [],
          });
          expect(store.getState().persisted).toEqual(afterFirstPersisted);
          expect(store.getState().runtime.completionEvents).toEqual(afterFirstEvents);
          expect(storage.values).toHaveLength(writesAfterFirst);
          expect(notifications).toBe(notificationsAfterFirst);

          const created = store.getState().persisted.constellations;
          expect(created).toHaveLength(eligibleGenres.length);
          expect(created.map(({ name }) => name)).toEqual(
            eligibleGenres.map((genre) => `${genre} 별자리`),
          );

          for (const [index, genre] of eligibleGenres.entries()) {
            const expectedStars = initialState.persisted.stars
              .filter((star) => star.genre === genre)
              .sort(
                (left, right) =>
                  left.createdAt.localeCompare(right.createdAt) ||
                  left.id.localeCompare(right.id),
              );
            const constellation = created[index]!;
            expect(new Set(constellation.starIds)).toEqual(
              new Set(expectedStars.map(({ id }) => id)),
            );
            expect(constellation.starIds).toEqual(expectedStars.map(({ id }) => id));

            for (let starIndex = 1; starIndex < expectedStars.length; starIndex += 1) {
              const previous = expectedStars[starIndex - 1]!;
              const current = expectedStars[starIndex]!;
              if (previous.createdAt === current.createdAt) {
                expect(previous.id.localeCompare(current.id)).toBeLessThan(0);
              } else {
                expect(previous.createdAt.localeCompare(current.createdAt)).toBeLessThan(0);
              }
            }
          }

          if (eligibleGenres.length === 0) {
            expect(storage.values).toHaveLength(0);
            expect(notificationsAfterFirst).toBe(0);
            expect(store.getState().runtime.completionEvents).toEqual([]);
          } else {
            expect(storage.values).toHaveLength(1);
            expect(notificationsAfterFirst).toBe(1);
            expect(decodePersistedV2(storage.values[0]!)).toEqual(
              store.getState().persisted,
            );
            expect(store.getState().runtime.completionEvents).toHaveLength(1);
            expect(store.getState().runtime.completionEvents[0]).toMatchObject({
              type: 'genre-constellations-created',
              payload: {
                operationId: scenario.operationId,
                constellationIds: generatedIds,
              },
            });
          }
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
