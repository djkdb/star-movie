import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultPersistedStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Genre,
  type PersistedStateV2,
  type Rating,
  type RuntimeEvent,
  type Star,
} from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import {
  AUTOSAVE_DEBOUNCE_MS,
  PersistenceService,
  type SaveResult,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import { FakeClock } from '../../src/test/providers';

interface StarSeed {
  titleSuffix: string;
  directorSuffix: string;
  review: string;
  genre: Genre;
  rating: Rating;
  dayOffset: number;
}

interface CommandAttempt {
  result: SaveResult;
  operationSnapshot: PersistedStateV2;
}

interface MemoryStore {
  persisted: PersistedStateV2;
  completionEvents: RuntimeEvent[];
}

class AlwaysFailingStorage implements StorageAdapter {
  writeAttempts = 0;

  getItem(): string | null {
    return null;
  }

  setItem(): void {
    this.writeAttempts += 1;
    throw new Error(`Injected write failure ${this.writeAttempts}`);
  }
}

const starSeedArbitrary: fc.Arbitrary<StarSeed> = fc.record({
  titleSuffix: fc.string({ maxLength: 30 }),
  directorSuffix: fc.string({ maxLength: 30 }),
  review: fc.string({ maxLength: 100 }),
  genre: fc.constantFrom(...GENRES),
  rating: fc.constantFrom<Rating>(1, 2, 3, 4, 5),
  dayOffset: fc.integer({ min: 0, max: 9_000 }),
});

const stateSeedArbitrary = fc.record({
  active: fc.array(starSeedArbitrary, { maxLength: 6 }),
  archived: fc.array(starSeedArbitrary, { maxLength: 6 }),
  achievementProgress: fc.integer({ min: 0, max: 200 }),
});

const makeUuid = (namespace: number, value: number): string =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;

function createStar(
  seed: StarSeed,
  id: string,
  galaxyCenters: ReadonlyMap<Genre, { x: number; y: number; z: number }>,
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

function createState(seed: {
  active: StarSeed[];
  archived: StarSeed[];
  achievementProgress: number;
}): PersistedStateV2 {
  const state = createDefaultPersistedStore();
  const galaxyCenters = new Map(
    state.galaxies.flatMap((galaxy) =>
      galaxy.kind.type === 'genre'
        ? [[galaxy.kind.genre, galaxy.center] as const]
        : [],
    ),
  );

  state.stars = seed.active.map((star, index) =>
    createStar(star, makeUuid(1, index + 1), galaxyCenters),
  );
  state.blackholeArchive = seed.archived.map((star, index) => ({
    ...createStar(star, makeUuid(2, index + 1), galaxyCenters),
    discardedAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
  }));
  state.constellations = state.stars.length === 0
    ? []
    : [
        {
          id: makeUuid(3, 1),
          name: 'Generated constellation',
          starIds: state.stars.map(({ id }) => id),
          color: '#abcdef',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ];
  state.achievements = state.achievements.map((achievement) => ({
    ...achievement,
    progress: seed.achievementProgress,
  }));
  return state;
}

function attemptUserCommand(
  memory: MemoryStore,
  candidate: PersistedStateV2,
  service: PersistenceService,
): CommandAttempt {
  const operationSnapshot = structuredClone(memory.persisted);
  const result = service.saveUserAction(candidate);

  if (result.ok) {
    memory.persisted = structuredClone(candidate);
    memory.completionEvents.push({
      id: 'unexpected-completion',
      type: 'command-completed',
      occurredAt: '2025-01-01T00:00:00.000Z',
      payload: {},
    });
  }

  return { result, operationSnapshot };
}

// Feature: space-movie-archive, Property 12: 저장 실패의 메모리 보존
// **Validates: Requirements 8.14, 8.18**
describe('Property 12: save failure memory preservation', () => {
  it('R8.14 R8.18 preserves memory and command snapshots across independent autosave and user-save failures without completion effects', () => {
    fc.assert(
      fc.property(stateSeedArbitrary, stateSeedArbitrary, (memorySeed, candidateSeed) => {
        const clock = new FakeClock();
        const storage = new AlwaysFailingStorage();
        const service = new PersistenceService({
          storage,
          scheduler: clock,
          nowIso: () => '2025-02-01T00:00:00.000Z',
        });
        const memory: MemoryStore = {
          persisted: createState(memorySeed),
          completionEvents: [],
        };
        const memoryBefore = structuredClone(memory);

        const autosaveSnapshot = structuredClone(memory.persisted);
        const autosaveSnapshotBefore = structuredClone(autosaveSnapshot);
        service.scheduleAutosave(autosaveSnapshot);
        expect(() => clock.advanceBy(AUTOSAVE_DEBOUNCE_MS)).not.toThrow();

        expect(memory).toEqual(memoryBefore);
        expect(autosaveSnapshot).toEqual(autosaveSnapshotBefore);
        expect(memory.completionEvents).toEqual([]);
        expect(service.getDiagnostics()).toEqual({
          lastAutosaveError: 'STORAGE_WRITE: Injected write failure 1',
          lastAutosaveErrorAt: '2025-02-01T00:00:00.000Z',
        });

        const candidate = createState(candidateSeed);
        const candidateBefore = structuredClone(candidate);
        const first = attemptUserCommand(memory, candidate, service);
        const firstSnapshotBefore = structuredClone(first.operationSnapshot);
        const second = attemptUserCommand(memory, candidate, service);
        const secondSnapshotBefore = structuredClone(second.operationSnapshot);

        expect(first.result).toMatchObject({
          ok: false,
          error: { code: 'STORAGE_WRITE', message: '저장 공간에 쓰지 못했습니다.' },
        });
        expect(second.result).toMatchObject({
          ok: false,
          error: { code: 'STORAGE_WRITE', message: '저장 공간에 쓰지 못했습니다.' },
        });
        expect(first.result).not.toBe(second.result);
        if (!first.result.ok && !second.result.ok) {
          expect(first.result.error).not.toBe(second.result.error);
          expect(first.result.error.cause).not.toBe(second.result.error.cause);
        }
        expect(storage.writeAttempts).toBe(3);
        expect(memory).toEqual(memoryBefore);
        expect(candidate).toEqual(candidateBefore);
        expect(first.operationSnapshot).toEqual(firstSnapshotBefore);
        expect(first.operationSnapshot).toEqual(memoryBefore.persisted);
        expect(second.operationSnapshot).toEqual(secondSnapshotBefore);
        expect(second.operationSnapshot).toEqual(memoryBefore.persisted);
        expect(first.operationSnapshot).not.toBe(second.operationSnapshot);
        expect(memory.completionEvents).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
