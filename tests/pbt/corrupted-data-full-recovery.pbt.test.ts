import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultPersistedStore } from '../../src/domain/defaultState';
import type { PersistedStateV2, Star } from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import { encodePersistedV2 } from '../../src/persistence/persistedStateCodec';
import {
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
  type LoadResult,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

interface RecoverySeed {
  firstTitle: string;
  secondTitle: string;
  firstReview: string;
  secondReview: string;
}

const recoverySeedArbitrary: fc.Arbitrary<RecoverySeed> = fc.record({
  firstTitle: fc.string({ maxLength: 40 }).map((suffix) => `First ${suffix}`.normalize('NFC').trim()),
  secondTitle: fc.string({ maxLength: 40 }).map((suffix) => `Second ${suffix}`.normalize('NFC').trim()),
  firstReview: fc.string({ maxLength: 100 }),
  secondReview: fc.string({ maxLength: 100 }),
});

const unparsableJsonArbitrary = fc
  .string({ maxLength: 80 })
  .map((value) => `{"unterminated":${JSON.stringify(value)}`);

const schemaViolationArbitrary: fc.Arbitrary<(state: PersistedStateV2) => unknown> =
  fc.constantFrom(
    (state: PersistedStateV2) => ({ ...state, schemaVersion: 1 }),
    (state: PersistedStateV2) => ({ ...state, galaxies: state.galaxies.slice(1) }),
    (state: PersistedStateV2) => ({ ...state, stars: [{ id: 'not-a-uuid' }] }),
    (state: PersistedStateV2) => ({ ...state, unexpectedPartialField: true }),
  );

function createStar(
  id: string,
  title: string,
  review: string,
  createdAt: string,
): Star {
  return {
    id,
    title,
    normalizedTitle: normalizeText(title),
    genre: 'SF',
    rating: 5,
    review,
    watchedDate: '2025-01-01',
    director: 'Christopher Nolan',
    normalizedDirector: 'christopher nolan',
    position: { x: -45, y: 0, z: -45 },
    createdAt,
  };
}

function createPopulatedState(seed: RecoverySeed): PersistedStateV2 {
  const state = createDefaultPersistedStore();
  state.stars = [
    createStar(
      '10000000-0000-4000-8000-000000000001',
      seed.firstTitle,
      seed.firstReview,
      '2025-01-01T00:00:00.000Z',
    ),
    createStar(
      '10000000-0000-4000-8000-000000000002',
      seed.secondTitle,
      seed.secondReview,
      '2025-01-02T00:00:00.000Z',
    ),
  ];
  return state;
}

function loadFrom(storage: StorageAdapter): LoadResult {
  return new PersistenceService({ storage, scheduler: new FakeClock() }).load();
}

function expectFullDefaultRecovery(result: LoadResult): void {
  const expected = createDefaultPersistedStore();

  expect(result).toMatchObject({
    ok: false,
    source: 'recovered-default',
    hasPersistedRegistration: false,
  });
  expect(result.state).toEqual(expected);
  expect(result.state.stars).toEqual([]);
  expect(result.state.constellations).toEqual([]);
  expect(result.state.blackholeArchive).toEqual([]);
  expect(result.state.galaxies).toEqual(expected.galaxies);
  expect(result.state.milestoneUnlocks).toEqual(expected.milestoneUnlocks);
  expect(result.state.achievements).toEqual(expected.achievements);
}

// Feature: space-movie-archive, Property 11: 손상 데이터의 전체 복구
// **Validates: Requirements 8.11, 8.12, 8.17**
describe('Property 11: corrupted data full recovery', () => {
  it('R8.11 R8.12 R8.17 recovers the complete deterministic default without partial restoration', () => {
    fc.assert(
      fc.property(
        recoverySeedArbitrary,
        unparsableJsonArbitrary,
        schemaViolationArbitrary,
        (seed, unparsableJson, violateSchema) => {
          const populated = createPopulatedState(seed);
          const encoded = encodePersistedV2(populated);

          const readExceptionStorage: StorageAdapter = {
            getItem: () => {
              throw new Error(`Injected read failure for ${seed.firstTitle}`);
            },
            setItem: () => undefined,
          };
          expectFullDefaultRecovery(loadFrom(readExceptionStorage));

          expectFullDefaultRecovery(
            loadFrom(
              new FakeLocalStorageAdapter({
                initial: { [PERSISTENCE_STORAGE_KEY]: unparsableJson },
              }),
            ),
          );

          expectFullDefaultRecovery(
            loadFrom(
              new FakeLocalStorageAdapter({
                initial: {
                  [PERSISTENCE_STORAGE_KEY]: JSON.stringify(violateSchema(populated)),
                },
              }),
            ),
          );

          const originalParse = JSON.parse.bind(JSON) as typeof JSON.parse;
          const parseSpy = vi.spyOn(JSON, 'parse');
          parseSpy
            .mockImplementationOnce(originalParse)
            .mockImplementationOnce((text: string) => {
              const roundTripped = originalParse(text) as PersistedStateV2;
              roundTripped.stars.reverse();
              return roundTripped;
            });

          try {
            expectFullDefaultRecovery(
              loadFrom(
                new FakeLocalStorageAdapter({
                  initial: { [PERSISTENCE_STORAGE_KEY]: encoded },
                }),
              ),
            );
          } finally {
            parseSpy.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
