import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createDefaultRuntimeStore,
  createDefaultStore,
} from '../../src/domain/defaultState';
import type {
  PersistedStateV2,
  RuntimeEvent,
  Star,
  Store,
} from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import {
  PersistenceService,
  type LoadResult,
} from '../../src/persistence/persistenceService';
import {
  createArchiveStore,
  createArchiveStoreFromLoadResult,
} from '../../src/store/archiveStore';
import {
  reconcileProgressAfterMutation,
} from '../../src/store/progressReconciler';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

type ScenarioAction =
  | { kind: 'mutation'; progress: number }
  | { kind: 'restore'; progress: number; staleProgress: number }
  | { kind: 'reopen-panel' };

const TARGET = 10;
const PANEL_REOPEN: ScenarioAction = { kind: 'reopen-panel' };

const belowTargetMutationArbitrary: fc.Arbitrary<ScenarioAction> = fc
  .integer({ min: 0, max: TARGET - 1 })
  .map((progress) => ({ kind: 'mutation', progress }));

const crossingMutationArbitrary: fc.Arbitrary<ScenarioAction> = fc
  .integer({ min: TARGET, max: TARGET + 5 })
  .map((progress) => ({ kind: 'mutation', progress }));

const restoreArbitrary: fc.Arbitrary<ScenarioAction> = fc.record({
  kind: fc.constant<'restore'>('restore'),
  progress: fc.integer({ min: 0, max: TARGET + 5 }),
  staleProgress: fc.integer({ min: 0, max: TARGET + 5 }),
});

const anyActionArbitrary: fc.Arbitrary<ScenarioAction> = fc.oneof(
  fc.integer({ min: 0, max: TARGET + 5 }).map((progress) => ({
    kind: 'mutation' as const,
    progress,
  })),
  restoreArbitrary,
  fc.constant(PANEL_REOPEN),
);

const scenarioArbitrary: fc.Arbitrary<ScenarioAction[]> = fc
  .tuple(
    fc.array(
      fc.oneof(belowTargetMutationArbitrary, restoreArbitrary, fc.constant(PANEL_REOPEN)),
      { maxLength: 5 },
    ),
    crossingMutationArbitrary,
    belowTargetMutationArbitrary,
    restoreArbitrary,
    fc.shuffledSubarray(['decrease', 'restore', 'panel'] as const, {
      minLength: 3,
      maxLength: 3,
    }),
    fc.array(anyActionArbitrary, { maxLength: 8 }),
  )
  .map(([prelude, crossing, decrease, restore, requiredOrder, tail]) => {
    const required = requiredOrder.map((kind): ScenarioAction => {
      if (kind === 'decrease') return decrease;
      if (kind === 'restore') return restore;
      return PANEL_REOPEN;
    });
    return [...prelude, crossing, ...required, ...tail];
  });

function uuid(index: number): string {
  return `26000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createNolanStars(state: PersistedStateV2, count: number): Star[] {
  const galaxy = state.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === 'SF',
  );
  if (galaxy === undefined) throw new Error('Missing SF galaxy');

  return Array.from({ length: count }, (_, index) => {
    const title = `Nolan Work ${index + 1}`;
    const director = 'Christopher Nolan';
    return {
      id: uuid(index + 1),
      title,
      normalizedTitle: normalizeText(title),
      genre: 'SF',
      rating: 4,
      review: '',
      watchedDate: '2030-01-01',
      director,
      normalizedDirector: normalizeText(director),
      position: { ...galaxy.center },
      createdAt: '2030-01-01T00:00:00.000Z',
    };
  });
}

function createPersistence(): PersistenceService {
  return new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
    nowIso: () => '2030-01-01T00:00:00.000Z',
  });
}

function achievementEvents(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  return events.filter(({ type }) => type === 'achievement-unlocked');
}

function restoreWithoutNotifications(
  current: PersistedStateV2,
  progress: number,
  staleProgress: number,
): PersistedStateV2 {
  const restored = structuredClone(current);
  restored.stars = createNolanStars(restored, progress);
  restored.achievements[0] = {
    ...restored.achievements[0]!,
    progress: staleProgress,
  };
  const loadResult: LoadResult = {
    ok: true,
    state: restored,
    source: 'storage',
    hasPersistedRegistration: true,
  };
  const store = createArchiveStoreFromLoadResult(loadResult, createPersistence());

  expect(store.getState().runtime.completionEvents).toEqual([]);
  expect(store.getState().runtime.toastEvents).toEqual([]);
  expect(store.getState().persisted.achievements[0]?.progress).toBe(progress);

  const result = structuredClone(store.getState().persisted);
  store.dispose();
  return result;
}

function reopenPanelWithoutNotifications(current: PersistedStateV2): PersistedStateV2 {
  const initialState: Store = {
    persisted: structuredClone(current),
    runtime: createDefaultRuntimeStore(true),
  };
  const store = createArchiveStore({
    persistence: createPersistence(),
    initialState,
  });
  const persistedBefore = structuredClone(store.getState().persisted);

  store.setState((state) => ({
    runtime: { ...state.runtime, isAchievementPanelOpen: true },
  }));
  store.setState((state) => ({
    runtime: { ...state.runtime, isAchievementPanelOpen: false },
  }));
  store.setState((state) => ({
    runtime: { ...state.runtime, isAchievementPanelOpen: true },
  }));

  expect(store.getState().persisted).toEqual(persistedBefore);
  expect(store.getState().runtime.completionEvents).toEqual([]);
  expect(store.getState().runtime.toastEvents).toEqual([]);

  const result = structuredClone(store.getState().persisted);
  store.dispose();
  return result;
}

// Feature: space-movie-archive, Property 26: Achievement 해금의 단조성과 이벤트 단일성
// **Validates: Requirements 17.3, 17.4, 17.5, 17.6, 17.11, 17.12, 17.13**
describe('Property 26: Achievement unlock monotonicity and event uniqueness', () => {
  it('R17.3 R17.4 R17.5 R17.6 R17.11 R17.12 R17.13 preserves sticky unlock metadata and emits one notification across mutations, decreases, restores, and panel reopenings', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (actions) => {
        let current = createDefaultStore(true).persisted;
        let unlockNotificationCount = 0;
        let firstUnlockedAt: string | null = null;

        actions.forEach((action, index) => {
          const before = current.achievements[0]!;
          const stickyUnlockedAt = before.unlockedAt;

          if (action.kind === 'mutation') {
            const candidate = structuredClone(current);
            candidate.stars = createNolanStars(candidate, action.progress);
            const nowIso = new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString();
            const result = reconcileProgressAfterMutation(current, candidate, {
              nowIso,
              nextRewardId: () => {
                throw new Error('Achievement-only scenario must not allocate rewards');
              },
            });
            const notifications = achievementEvents(result.completionEvents);
            const shouldUnlock = !before.unlocked && action.progress >= TARGET;

            expect(notifications).toHaveLength(shouldUnlock ? 1 : 0);
            if (shouldUnlock) {
              unlockNotificationCount += notifications.length;
              firstUnlockedAt = nowIso;
              expect(notifications[0]).toMatchObject({
                type: 'achievement-unlocked',
                occurredAt: nowIso,
                payload: {
                  achievementId: 'nolan-master',
                  name: '놀란 마스터',
                  description: before.description,
                },
              });
            }

            current = result.candidate;
          } else if (action.kind === 'restore') {
            current = restoreWithoutNotifications(
              current,
              action.progress,
              action.staleProgress,
            );
          } else {
            current = reopenPanelWithoutNotifications(current);
          }

          const after = current.achievements[0]!;
          const expectedProgress = action.kind === 'reopen-panel'
            ? before.progress
            : action.progress;
          expect(after.progress).toBe(expectedProgress);

          if (before.unlocked) {
            expect(after.unlocked).toBe(true);
            expect(after.unlockedAt).toBe(stickyUnlockedAt);
          }
          if (firstUnlockedAt !== null) {
            expect(after.unlocked).toBe(true);
            expect(after.unlockedAt).toBe(firstUnlockedAt);
          }
        });

        expect(unlockNotificationCount).toBe(1);
        expect(current.achievements[0]).toMatchObject({
          unlocked: true,
          unlockedAt: firstUnlockedAt,
        });
      }),
      { numRuns: 100 },
    );
  });
});
