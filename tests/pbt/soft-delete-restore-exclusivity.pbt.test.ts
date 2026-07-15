import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Genre,
  type PersistedStateV2,
  type Rating,
  type Star,
  type Store,
} from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import { decodePersistedV2 } from '../../src/persistence/persistedStateCodec';
import {
  PersistenceService,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock } from '../../src/test/providers';

interface WorkSeed {
  titleSuffix: string;
  directorSuffix: string;
  review: string;
  genre: Genre;
  rating: Rating;
  dayOffset: number;
}

interface StateSeed {
  target: WorkSeed;
  activeOthers: WorkSeed[];
  archivedOthers: WorkSeed[];
  duplicateCount: number;
}

type Operation = 'softDelete' | 'restoreArchived';

const TARGET_ID = '16000000-0000-4000-8000-000000000001';
const DISCARDED_AT = '2029-06-07T08:09:10.000Z';
const OPERATION_AT = '2030-07-08T09:10:11.000Z';

const workSeedArbitrary: fc.Arbitrary<WorkSeed> = fc.record({
  titleSuffix: fc.string({ maxLength: 30 }),
  directorSuffix: fc.string({ maxLength: 30 }),
  review: fc.string({ maxLength: 100 }),
  genre: fc.constantFrom(...GENRES),
  rating: fc.constantFrom<Rating>(1, 2, 3, 4, 5),
  dayOffset: fc.integer({ min: 0, max: 9_000 }),
});

const stateSeedArbitrary: fc.Arbitrary<StateSeed> = fc.record({
  target: workSeedArbitrary,
  activeOthers: fc.array(workSeedArbitrary, { maxLength: 4 }),
  archivedOthers: fc.array(workSeedArbitrary, { maxLength: 4 }),
  duplicateCount: fc.integer({ min: 1, max: 3 }),
});

const makeUuid = (namespace: number, value: number): string =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;

function createStar(
  seed: WorkSeed,
  id: string,
  galaxyCenters: ReadonlyMap<Genre, Star['position']>,
): Star {
  const title = normalizeDisplayText(`Title ${seed.titleSuffix}`);
  const director = normalizeDisplayText(`Director ${seed.directorSuffix}`);
  const watchedDate = new Date(Date.UTC(2000, 0, 1 + seed.dayOffset))
    .toISOString()
    .slice(0, 10);
  const position = galaxyCenters.get(seed.genre);
  if (position === undefined) throw new Error(`Missing galaxy center for ${seed.genre}`);

  return {
    id,
    title,
    normalizedTitle: normalizeText(title),
    genre: seed.genre,
    rating: seed.rating,
    review: seed.review,
    watchedDate,
    director,
    normalizedDirector: normalizeText(director),
    position: { ...position },
    createdAt: `${watchedDate}T00:00:00.000Z`,
  };
}

function createInitialState(
  seed: StateSeed,
  operation: Operation,
  withOppositeCollectionDuplicates: boolean,
): Store {
  const state = createDefaultStore(true);
  const galaxyCenters = new Map(
    state.persisted.galaxies.flatMap((galaxy) =>
      galaxy.kind.type === 'genre'
        ? [[galaxy.kind.genre, galaxy.center] as const]
        : [],
    ),
  );
  const target = createStar(seed.target, TARGET_ID, galaxyCenters);

  state.persisted.stars = seed.activeOthers.map((work, index) =>
    createStar(work, makeUuid(2, index + 1), galaxyCenters),
  );
  state.persisted.blackholeArchive = seed.archivedOthers.map((work, index) => ({
    ...createStar(work, makeUuid(3, index + 1), galaxyCenters),
    discardedAt: DISCARDED_AT,
  }));

  if (operation === 'softDelete') {
    state.persisted.stars.push(target);
    if (withOppositeCollectionDuplicates) {
      for (let index = 0; index < seed.duplicateCount; index += 1) {
        state.persisted.blackholeArchive.push({
          ...structuredClone(target),
          discardedAt: DISCARDED_AT,
        });
      }
    }
  } else {
    state.persisted.blackholeArchive.push({
      ...structuredClone(target),
      discardedAt: DISCARDED_AT,
    });
    if (withOppositeCollectionDuplicates) {
      for (let index = 0; index < seed.duplicateCount; index += 1) {
        state.persisted.stars.push(structuredClone(target));
      }
    }
  }

  return state;
}

class CapturingStorage implements StorageAdapter {
  readonly attemptedValues: string[] = [];

  constructor(private readonly failWrites: boolean) {}

  getItem(): string | null {
    return null;
  }

  setItem(_key: string, value: string): void {
    this.attemptedValues.push(value);
    if (this.failWrites) throw new Error('Injected persistence failure');
  }
}

function createHarness(initialState: Store, failWrites: boolean) {
  const storage = new CapturingStorage(failWrites);
  const persistence = new PersistenceService({
    storage,
    scheduler: new FakeClock(),
    nowIso: () => OPERATION_AT,
  });
  const store = createArchiveStore({
    persistence,
    initialState,
    providers: {
      nowIso: () => OPERATION_AT,
      nextUuid: () => '16000000-0000-4000-8000-000000000099',
    },
  });
  return { storage, store };
}

function assertExclusiveMembership(
  state: PersistedStateV2,
  expected: 'active' | 'archived',
  expectedDiscardedAt?: string,
): void {
  const active = state.stars.filter(({ id }) => id === TARGET_ID);
  const archived = state.blackholeArchive.filter(({ id }) => id === TARGET_ID);

  expect(active.length + archived.length).toBe(1);
  if (expected === 'active') {
    expect(active).toHaveLength(1);
    expect(archived).toHaveLength(0);
    expect(active[0]).not.toHaveProperty('discardedAt');
  } else {
    expect(active).toHaveLength(0);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toHaveProperty('discardedAt', expectedDiscardedAt);
  }
}

function executeCommand(operation: Operation, state: Store, failWrites: boolean) {
  const harness = createHarness(state, failWrites);
  const result = operation === 'softDelete'
    ? harness.store.getState().commands.softDelete(TARGET_ID)
    : harness.store.getState().commands.restoreArchived(TARGET_ID);
  return { ...harness, result };
}

// Feature: space-movie-archive, Property 16: Soft Delete와 Restore의 collection 상호배타성
// **Validates: Requirements 12.2, 12.3, 12.10, 12.11, 12.14**
describe('Property 16: Soft Delete and Restore collection exclusivity', () => {
  it('R12.2 R12.3 R12.10 R12.11 R12.14 preserves exactly one membership and the discardedAt contract across success, persistence failure, and duplicate recovery', () => {
    fc.assert(
      fc.property(stateSeedArbitrary, (seed) => {
        for (const operation of ['softDelete', 'restoreArchived'] as const) {
          const expectedDestination = operation === 'softDelete' ? 'archived' : 'active';

          const success = executeCommand(
            operation,
            createInitialState(seed, operation, false),
            false,
          );
          expect(success.result).toMatchObject({ ok: true });
          assertExclusiveMembership(
            success.store.getState().persisted,
            expectedDestination,
            operation === 'softDelete' ? OPERATION_AT : undefined,
          );
          expect(success.storage.attemptedValues).toHaveLength(1);
          expect(decodePersistedV2(success.storage.attemptedValues[0]!)).toEqual(
            success.store.getState().persisted,
          );
          success.store.dispose();

          const failedInitial = createInitialState(seed, operation, false);
          const failure = executeCommand(operation, failedInitial, true);
          const persistedReference = failure.store.getState().persisted;
          const snapshot = structuredClone(failedInitial.persisted);
          expect(failure.result).toMatchObject({
            ok: false,
            error: { code: 'STORAGE_WRITE' },
          });
          expect(failure.store.getState().persisted).toBe(persistedReference);
          expect(failure.store.getState().persisted).toEqual(snapshot);
          assertExclusiveMembership(
            failure.store.getState().persisted,
            operation === 'softDelete' ? 'active' : 'archived',
            operation === 'restoreArchived' ? DISCARDED_AT : undefined,
          );
          expect(failure.store.getState().runtime.completionEvents).toEqual([]);
          expect(failure.storage.attemptedValues).toHaveLength(1);
          assertExclusiveMembership(
            decodePersistedV2(failure.storage.attemptedValues[0]!),
            expectedDestination,
            operation === 'softDelete' ? OPERATION_AT : undefined,
          );
          failure.store.dispose();

          const duplicateInitial = createInitialState(seed, operation, true);
          const duplicateCountBefore =
            duplicateInitial.persisted.stars.filter(({ id }) => id === TARGET_ID).length +
            duplicateInitial.persisted.blackholeArchive.filter(
              ({ id }) => id === TARGET_ID,
            ).length;
          expect(duplicateCountBefore).toBeGreaterThan(1);

          const recovered = executeCommand(operation, duplicateInitial, false);
          expect(recovered.result).toMatchObject({ ok: true });
          assertExclusiveMembership(
            recovered.store.getState().persisted,
            expectedDestination,
            operation === 'softDelete' ? OPERATION_AT : undefined,
          );
          recovered.store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
