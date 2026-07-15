import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Genre,
  type Rating,
  type RuntimeEvent,
  type Star,
  type Store,
} from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import {
  PersistenceService,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import {
  captureOperationSnapshot,
  createArchiveStore,
  type CommandResult,
} from '../../src/store/archiveStore';
import { FakeClock } from '../../src/test/providers';

type Operation =
  | 'addWork'
  | 'hardDelete'
  | 'softDelete'
  | 'restoreArchived'
  | 'createConstellation'
  | 'createGenreConstellations';
type FailurePoint = 'validation' | 'reducer' | 'serialization' | 'storage';

interface FailureCase {
  operation: Operation;
  failurePoint: FailurePoint;
}

interface SnapshotSeed {
  genre: Genre;
  rating: Rating;
  review: string;
  dayOffset: number;
  extraActiveCount: number;
  targetPosition: number;
  includeTargetReference: boolean;
}

const TARGET_ID = '51000000-0000-4000-8000-000000000001';
const NOW = '2031-02-03T04:05:06.000Z';
const EXISTING_COMPLETION: RuntimeEvent = {
  id: 'existing-completion',
  type: 'existing-completion',
  occurredAt: '2030-01-01T00:00:00.000Z',
  payload: { preserved: true },
};

const FAILURE_CASES: readonly FailureCase[] = [
  { operation: 'addWork', failurePoint: 'validation' },
  { operation: 'addWork', failurePoint: 'reducer' },
  { operation: 'addWork', failurePoint: 'serialization' },
  { operation: 'addWork', failurePoint: 'storage' },
  { operation: 'hardDelete', failurePoint: 'reducer' },
  { operation: 'hardDelete', failurePoint: 'storage' },
  { operation: 'softDelete', failurePoint: 'reducer' },
  { operation: 'softDelete', failurePoint: 'serialization' },
  { operation: 'softDelete', failurePoint: 'storage' },
  { operation: 'restoreArchived', failurePoint: 'reducer' },
  { operation: 'restoreArchived', failurePoint: 'serialization' },
  { operation: 'restoreArchived', failurePoint: 'storage' },
  { operation: 'createConstellation', failurePoint: 'validation' },
  { operation: 'createConstellation', failurePoint: 'reducer' },
  { operation: 'createConstellation', failurePoint: 'serialization' },
  { operation: 'createConstellation', failurePoint: 'storage' },
  { operation: 'createGenreConstellations', failurePoint: 'validation' },
  { operation: 'createGenreConstellations', failurePoint: 'reducer' },
  { operation: 'createGenreConstellations', failurePoint: 'serialization' },
  { operation: 'createGenreConstellations', failurePoint: 'storage' },
];

const snapshotSeedArbitrary: fc.Arbitrary<SnapshotSeed> = fc.record({
  genre: fc.constantFrom(...GENRES),
  rating: fc.constantFrom<Rating>(1, 2, 3, 4, 5),
  review: fc.string({ maxLength: 60 }),
  dayOffset: fc.integer({ min: 0, max: 3_000 }),
  extraActiveCount: fc.integer({ min: 0, max: 3 }),
  targetPosition: fc.nat(),
  includeTargetReference: fc.boolean(),
});

function uuid(namespace: number, value: number): string {
  return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;
}

function createStar(
  state: Store,
  seed: SnapshotSeed,
  id: string,
  index: number,
): Star {
  const galaxy = state.persisted.galaxies.find(
    (candidate) =>
      candidate.kind.type === 'genre' && candidate.kind.genre === seed.genre,
  );
  if (galaxy === undefined) throw new Error(`Missing galaxy for ${seed.genre}`);

  const watchedDate = new Date(Date.UTC(2020, 0, 1 + seed.dayOffset + index))
    .toISOString()
    .slice(0, 10);
  const title = `Atomic Work ${index}`;
  const director = `Atomic Director ${index}`;
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
    position: { ...galaxy.center },
    createdAt: `${watchedDate}T00:00:00.000Z`,
  };
}

function createInitialState(seed: SnapshotSeed, scenario: FailureCase): Store {
  const state = createDefaultStore(true);
  const activeCount =
    scenario.operation === 'restoreArchived' && scenario.failurePoint === 'serialization'
      ? 50
      : 2 + seed.extraActiveCount;
  const active = Array.from({ length: activeCount }, (_, index) =>
    createStar(
      state,
      seed,
      index === 0 ? TARGET_ID : uuid(0x51000000, index + 1),
      index,
    ),
  );
  const target = active[0]!;

  if (scenario.operation === 'restoreArchived' && scenario.failurePoint !== 'reducer') {
    state.persisted.stars = active.slice(1);
    state.persisted.blackholeArchive = [
      { ...structuredClone(target), discardedAt: '2030-12-31T00:00:00.000Z' },
    ];
  } else if (
    scenario.failurePoint === 'reducer' &&
    (scenario.operation === 'hardDelete' || scenario.operation === 'softDelete')
  ) {
    state.persisted.stars = active.slice(1);
  } else {
    const insertionIndex = seed.targetPosition % active.length;
    const survivors = active.slice(1);
    state.persisted.stars = [
      ...survivors.slice(0, insertionIndex),
      target,
      ...survivors.slice(insertionIndex),
    ];
  }

  const activeIds = state.persisted.stars.map(({ id }) => id);
  const constellationIds = activeIds.slice(0, 2);
  if (
    seed.includeTargetReference &&
    state.persisted.stars.some(({ id }) => id === TARGET_ID) &&
    !constellationIds.includes(TARGET_ID)
  ) {
    constellationIds.splice(seed.targetPosition % (constellationIds.length + 1), 0, TARGET_ID);
  }
  state.persisted.constellations = [
    {
      id: uuid(0x53000000, 1),
      name: 'Atomic Snapshot',
      starIds: [...new Set(constellationIds)],
      color: '#123456',
      createdAt: '2030-01-02T00:00:00.000Z',
    },
  ];
  state.runtime.selectedStarId = state.persisted.stars.some(
    ({ id }) => id === TARGET_ID,
  )
    ? TARGET_ID
    : null;
  state.runtime.constellationDraft = {
    active: true,
    phase: 'naming',
    starIds: activeIds.slice(0, 2),
    error: null,
  };
  state.runtime.completionEvents = [structuredClone(EXISTING_COMPLETION)];
  return state;
}

class FaultStorage implements StorageAdapter {
  writeAttempts = 0;

  constructor(private readonly failWrites: boolean) {}

  getItem(): string | null {
    return null;
  }

  setItem(): void {
    this.writeAttempts += 1;
    if (this.failWrites) throw new Error('Injected storage failure');
  }
}

function executeFailureCase(seed: SnapshotSeed, scenario: FailureCase): {
  result: CommandResult<unknown>;
  store: ReturnType<typeof createArchiveStore>;
  storage: FaultStorage;
  persistedReference: Store['persisted'];
  snapshot: Store['persisted'];
  completionBefore: RuntimeEvent[];
  draftStarIdsBefore: string[];
  selectedStarIdBefore: string | null;
} {
  const initialState = createInitialState(seed, scenario);
  const storage = new FaultStorage(scenario.failurePoint === 'storage');
  const persistence = new PersistenceService({
    storage,
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  let generatedId = 0;
  const generatedIdFailure =
    scenario.failurePoint === 'reducer' &&
    (scenario.operation === 'addWork' ||
      scenario.operation === 'createConstellation' ||
      scenario.operation === 'createGenreConstellations');
  const invalidGeneratedId =
    scenario.failurePoint === 'serialization' &&
    scenario.operation !== 'softDelete';
  const store = createArchiveStore({
    persistence,
    initialState,
    providers: {
      nowIso: () =>
        scenario.failurePoint === 'serialization' && scenario.operation === 'softDelete'
          ? 'invalid-timestamp'
          : NOW,
      nextUuid: () => {
        if (generatedIdFailure) throw new Error('Injected reducer failure');
        generatedId += 1;
        return invalidGeneratedId
          ? 'invalid-uuid'
          : uuid(0x59000000, generatedId);
      },
    },
  });
  const commands = store.getState().commands;
  const persistedReference = store.getState().persisted;
  const snapshot = captureOperationSnapshot(store.getState());
  const completionBefore = structuredClone(
    store.getState().runtime.completionEvents,
  );
  const draftStarIdsBefore = [
    ...store.getState().runtime.constellationDraft.starIds,
  ];
  const selectedStarIdBefore = store.getState().runtime.selectedStarId;
  let result: CommandResult<unknown>;

  switch (scenario.operation) {
    case 'addWork':
      result = commands.addWork({
        title: scenario.failurePoint === 'validation' ? '   ' : 'Atomic Addition',
        genre: seed.genre,
        rating: seed.rating,
        review: seed.review,
        watchedDate: '2031-02-01',
        director: 'Atomic Director',
      });
      break;
    case 'hardDelete':
      result = commands.hardDelete(TARGET_ID);
      break;
    case 'softDelete':
      result = commands.softDelete(TARGET_ID);
      break;
    case 'restoreArchived':
      result = commands.restoreArchived(TARGET_ID);
      break;
    case 'createConstellation':
      result = commands.createConstellation(
        scenario.failurePoint === 'validation' ? '   ' : 'Atomic Constellation',
      );
      break;
    case 'createGenreConstellations':
      result = commands.createGenreConstellations(
        scenario.failurePoint === 'validation' ? '   ' : 'atomic-operation',
      );
      break;
  }

  return {
    result,
    store,
    storage,
    persistedReference,
    snapshot,
    completionBefore,
    draftStarIdsBefore,
    selectedStarIdBefore,
  };
}

function expectedErrorCode(failurePoint: FailurePoint): string {
  switch (failurePoint) {
    case 'validation':
      return 'VALIDATION';
    case 'reducer':
      return 'INVARIANT';
    case 'serialization':
      return 'SERIALIZATION';
    case 'storage':
      return 'STORAGE_WRITE';
  }
}

// Feature: space-movie-archive, Property 5: 사용자 command의 원자성
// **Validates: Requirements 2.15, 4.14, 8.18, 9.15, 9.17, 12.4, 12.12**
describe('Property 5: 사용자 command의 원자성', () => {
  it('R2.15 R4.14 R8.18 R9.15 R9.17 R12.4 R12.12 preserves the operation snapshot and suppresses completion events at every injectable failure point', () => {
    fc.assert(
      fc.property(snapshotSeedArbitrary, (seed) => {
        for (const scenario of FAILURE_CASES) {
          const {
            result,
            store,
            storage,
            persistedReference,
            snapshot,
            completionBefore,
            draftStarIdsBefore,
            selectedStarIdBefore,
          } = executeFailureCase(seed, scenario);
          try {
            expect(result).toMatchObject({
              ok: false,
              error: { code: expectedErrorCode(scenario.failurePoint) },
            });
            expect(store.getState().persisted).toBe(persistedReference);
            expect(store.getState().persisted).toEqual(snapshot);
            expect(store.getState().runtime.completionEvents).toEqual(completionBefore);
            expect(
              store.getState().runtime.completionEvents.filter(
                ({ id }) => id !== EXISTING_COMPLETION.id,
              ),
            ).toEqual([]);
            expect(storage.writeAttempts).toBe(
              scenario.failurePoint === 'storage' ? 1 : 0,
            );

            if (scenario.operation === 'createConstellation') {
              expect(store.getState().runtime.constellationDraft.starIds).toEqual(
                draftStarIdsBefore,
              );
              expect(store.getState().runtime.constellationDraft.active).toBe(true);
            }
            if (
              scenario.operation === 'hardDelete' ||
              scenario.operation === 'softDelete'
            ) {
              expect(store.getState().runtime.selectedStarId).toBe(
                selectedStarIdBefore,
              );
            }
          } finally {
            store.dispose();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
