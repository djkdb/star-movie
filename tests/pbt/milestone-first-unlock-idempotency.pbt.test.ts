import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import type {
  Galaxy,
  PersistedStateV2,
  RuntimeEvent,
  Star,
} from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import {
  PersistenceService,
  type LoadResult,
} from '../../src/persistence/persistenceService';
import { createArchiveStoreFromLoadResult } from '../../src/store/archiveStore';
import { reconcileProgressAfterMutation } from '../../src/store/progressReconciler';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

interface MilestoneSequence {
  belowFifty: number;
  firstFiftyCrossing: number;
  decreasedBelowFifty: number;
  firstHundredCrossing: number;
  decreasedBelowHundred: number;
  hundredRecrossing: number;
  afterRefreshCount: number;
  zeroToHundredCrossing: number;
  rewardNumbers: number[];
}

const sequenceArbitrary: fc.Arbitrary<MilestoneSequence> = fc.record({
  belowFifty: fc.integer({ min: 0, max: 49 }),
  firstFiftyCrossing: fc.integer({ min: 50, max: 99 }),
  decreasedBelowFifty: fc.integer({ min: 0, max: 49 }),
  firstHundredCrossing: fc.integer({ min: 100, max: 130 }),
  decreasedBelowHundred: fc.integer({ min: 0, max: 99 }),
  hundredRecrossing: fc.integer({ min: 100, max: 130 }),
  afterRefreshCount: fc.integer({ min: 0, max: 130 }),
  zeroToHundredCrossing: fc.integer({ min: 100, max: 130 }),
  rewardNumbers: fc.uniqueArray(fc.integer({ min: 1_000, max: 999_999 }), {
    minLength: 4,
    maxLength: 4,
  }),
});

const FIRST_UNLOCKED_AT = '2028-01-02T03:04:05.000Z';
const SECOND_UNLOCKED_AT = '2029-02-03T04:05:06.000Z';
const LATER_AT = '2030-03-04T05:06:07.000Z';

function uuid(namespace: number, value: number): string {
  return `${namespace.toString().padStart(8, '0')}-0000-4000-8000-${value
    .toString()
    .padStart(12, '0')}`;
}

function createStar(state: PersistedStateV2, index: number): Star {
  const galaxy = state.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === 'SF',
  );
  if (galaxy === undefined) throw new Error('Missing SF galaxy');

  const title = `Milestone Work ${index}`;
  const director = 'Milestone Director';
  return {
    id: uuid(24, index + 1),
    title,
    normalizedTitle: normalizeText(title),
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2028-01-01',
    director,
    normalizedDirector: normalizeText(director),
    position: { ...galaxy.center },
    createdAt: '2028-01-01T00:00:00.000Z',
  };
}

function withActiveCount(state: PersistedStateV2, count: number): PersistedStateV2 {
  const candidate = structuredClone(state);
  candidate.stars = Array.from({ length: count }, (_, index) =>
    createStar(candidate, index),
  );
  return candidate;
}

function reconcile(
  previous: PersistedStateV2,
  nextCount: number,
  nowIso: string,
  rewardIds: readonly string[],
) {
  let allocations = 0;
  const result = reconcileProgressAfterMutation(
    previous,
    withActiveCount(previous, nextCount),
    {
      nowIso,
      nextRewardId: () => {
        const rewardId = rewardIds[allocations];
        if (rewardId === undefined) {
          throw new Error('Unexpected milestone reward allocation');
        }
        allocations += 1;
        return rewardId;
      },
    },
  );
  return { ...result, allocations };
}

function milestoneEvents(events: readonly RuntimeEvent[]) {
  return events.filter((event) => event.type === 'milestone-unlocked');
}

function rewardGalaxies(state: PersistedStateV2): Galaxy[] {
  return state.galaxies.filter((galaxy) => galaxy.kind.type === 'reward');
}

function genreGalaxies(state: PersistedStateV2): Galaxy[] {
  return state.galaxies.filter((galaxy) => galaxy.kind.type === 'genre');
}

function duplicateRewardGalaxy(state: PersistedStateV2, id: string): Galaxy {
  const existing = rewardGalaxies(state)[0];
  if (existing === undefined) throw new Error('Missing milestone reward galaxy');
  return { ...structuredClone(existing), id };
}

function restoreThroughApplication(restoredState: PersistedStateV2): PersistedStateV2 {
  const loadResult: LoadResult = {
    ok: true,
    state: restoredState,
    source: 'storage',
    hasPersistedRegistration: true,
  };
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
    nowIso: () => LATER_AT,
  });
  const store = createArchiveStoreFromLoadResult(loadResult, persistence);

  expect(store.getState().runtime.completionEvents).toEqual([]);
  expect(store.getState().runtime.toastEvents).toEqual([]);

  const restored = structuredClone(store.getState().persisted);
  store.dispose();
  return restored;
}

// Feature: space-movie-archive, Property 24: Milestone 최초 해금과 멱등성
// **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14**
describe('Property 24: Milestone first unlock and idempotency', () => {
  it('R16.1-R16.14 unlocks each reward once, keeps metadata across decrease, recrossing and refresh, and orders a 0-to-100+ transition', () => {
    fc.assert(
      fc.property(sequenceArbitrary, (sequence) => {
        const [fiftyRewardId, hundredRewardId, jumpFiftyId, jumpHundredId] =
          sequence.rewardNumbers.map((value) => uuid(25, value));
        const defaultState = createDefaultStore(true).persisted;
        const originalGenreGalaxies = structuredClone(genreGalaxies(defaultState));
        const belowFifty = withActiveCount(defaultState, sequence.belowFifty);

        const fiftyCrossing = reconcile(
          belowFifty,
          sequence.firstFiftyCrossing,
          FIRST_UNLOCKED_AT,
          [fiftyRewardId!],
        );
        expect(fiftyCrossing.allocations).toBe(1);
        expect(milestoneEvents(fiftyCrossing.completionEvents)).toEqual([
          expect.objectContaining({
            type: 'milestone-unlocked',
            payload: {
              target: 50,
              rewardId: fiftyRewardId,
              rewardType: 'planet',
            },
          }),
        ]);
        expect(fiftyCrossing.candidate.milestoneUnlocks.fifty).toEqual({
          target: 50,
          unlocked: true,
          unlockedAt: FIRST_UNLOCKED_AT,
          rewardId: fiftyRewardId,
        });
        expect(fiftyCrossing.candidate.milestoneUnlocks.hundred.unlocked).toBe(false);
        expect(rewardGalaxies(fiftyCrossing.candidate)).toEqual([]);
        expect(genreGalaxies(fiftyCrossing.candidate)).toEqual(originalGenreGalaxies);

        const decreased = reconcile(
          fiftyCrossing.candidate,
          sequence.decreasedBelowFifty,
          LATER_AT,
          [],
        );
        expect(decreased.allocations).toBe(0);
        expect(milestoneEvents(decreased.completionEvents)).toEqual([]);
        expect(decreased.candidate.milestoneUnlocks.fifty).toEqual(
          fiftyCrossing.candidate.milestoneUnlocks.fifty,
        );

        const fiftyRecrossing = reconcile(
          decreased.candidate,
          sequence.firstFiftyCrossing,
          LATER_AT,
          [],
        );
        expect(fiftyRecrossing.allocations).toBe(0);
        expect(milestoneEvents(fiftyRecrossing.completionEvents)).toEqual([]);
        expect(fiftyRecrossing.candidate.milestoneUnlocks.fifty).toEqual(
          fiftyCrossing.candidate.milestoneUnlocks.fifty,
        );

        const hundredCrossing = reconcile(
          fiftyRecrossing.candidate,
          sequence.firstHundredCrossing,
          SECOND_UNLOCKED_AT,
          [hundredRewardId!],
        );
        expect(hundredCrossing.allocations).toBe(1);
        expect(milestoneEvents(hundredCrossing.completionEvents)).toEqual([
          expect.objectContaining({
            type: 'milestone-unlocked',
            payload: {
              target: 100,
              rewardId: hundredRewardId,
              rewardType: 'galaxy',
            },
          }),
        ]);
        expect(hundredCrossing.candidate.milestoneUnlocks.fifty).toEqual(
          fiftyCrossing.candidate.milestoneUnlocks.fifty,
        );
        expect(hundredCrossing.candidate.milestoneUnlocks.hundred).toEqual({
          target: 100,
          unlocked: true,
          unlockedAt: SECOND_UNLOCKED_AT,
          rewardId: hundredRewardId,
        });
        expect(rewardGalaxies(hundredCrossing.candidate)).toEqual([
          expect.objectContaining({
            id: hundredRewardId,
            kind: { type: 'reward', rewardType: 'milestone-100' },
            unlocked: true,
          }),
        ]);
        expect(genreGalaxies(hundredCrossing.candidate)).toEqual(originalGenreGalaxies);

        const belowHundred = reconcile(
          hundredCrossing.candidate,
          sequence.decreasedBelowHundred,
          LATER_AT,
          [],
        );
        expect(belowHundred.allocations).toBe(0);
        expect(milestoneEvents(belowHundred.completionEvents)).toEqual([]);
        expect(belowHundred.candidate.milestoneUnlocks).toEqual(
          hundredCrossing.candidate.milestoneUnlocks,
        );

        const candidateWithDuplicateRewards = withActiveCount(
          belowHundred.candidate,
          sequence.hundredRecrossing,
        );
        candidateWithDuplicateRewards.galaxies.push(
          duplicateRewardGalaxy(candidateWithDuplicateRewards, hundredRewardId!),
          duplicateRewardGalaxy(candidateWithDuplicateRewards, uuid(26, 1)),
        );
        const hundredRecrossing = reconcileProgressAfterMutation(
          belowHundred.candidate,
          candidateWithDuplicateRewards,
          {
            nowIso: LATER_AT,
            nextRewardId: () => {
              throw new Error('Re-crossing must not allocate another reward');
            },
          },
        );
        expect(milestoneEvents(hundredRecrossing.completionEvents)).toEqual([]);
        expect(hundredRecrossing.candidate.milestoneUnlocks).toEqual(
          hundredCrossing.candidate.milestoneUnlocks,
        );
        expect(rewardGalaxies(hundredRecrossing.candidate)).toHaveLength(1);
        expect(rewardGalaxies(hundredRecrossing.candidate)[0]!.id).toBe(hundredRewardId);

        const restoredInput = structuredClone(hundredRecrossing.candidate);
        restoredInput.galaxies.push(
          duplicateRewardGalaxy(restoredInput, hundredRewardId!),
          duplicateRewardGalaxy(restoredInput, uuid(26, 2)),
        );
        const restored = restoreThroughApplication(restoredInput);
        expect(restored.milestoneUnlocks).toEqual(
          hundredCrossing.candidate.milestoneUnlocks,
        );
        expect(rewardGalaxies(restored)).toHaveLength(1);
        expect(rewardGalaxies(restored)[0]!.id).toBe(hundredRewardId);
        expect(genreGalaxies(restored)).toEqual(originalGenreGalaxies);

        const afterRefresh = reconcile(
          restored,
          sequence.afterRefreshCount,
          LATER_AT,
          [],
        );
        expect(afterRefresh.allocations).toBe(0);
        expect(milestoneEvents(afterRefresh.completionEvents)).toEqual([]);
        expect(afterRefresh.candidate.milestoneUnlocks).toEqual(restored.milestoneUnlocks);
        expect(rewardGalaxies(afterRefresh.candidate)).toHaveLength(1);

        const exactlyHundred = reconcile(afterRefresh.candidate, 100, LATER_AT, []);
        expect(exactlyHundred.allocations).toBe(0);
        expect(milestoneEvents(exactlyHundred.completionEvents)).toEqual([]);
        expect(exactlyHundred.candidate.milestoneUnlocks).toEqual(
          restored.milestoneUnlocks,
        );

        const zero = withActiveCount(defaultState, 0);
        const jump = reconcile(
          zero,
          sequence.zeroToHundredCrossing,
          FIRST_UNLOCKED_AT,
          [jumpFiftyId!, jumpHundredId!],
        );
        expect(jump.allocations).toBe(2);
        expect(
          milestoneEvents(jump.completionEvents).map((event) => [
            event.payload.target,
            event.payload.rewardId,
          ]),
        ).toEqual([
          [50, jumpFiftyId],
          [100, jumpHundredId],
        ]);
        expect(jump.candidate.milestoneUnlocks.fifty.rewardId).toBe(jumpFiftyId);
        expect(jump.candidate.milestoneUnlocks.hundred.rewardId).toBe(jumpHundredId);
        expect(rewardGalaxies(jump.candidate)).toHaveLength(1);
        expect(rewardGalaxies(jump.candidate)[0]!.id).toBe(jumpHundredId);
        expect(genreGalaxies(jump.candidate)).toEqual(originalGenreGalaxies);
      }),
      { numRuns: 100 },
    );
  });
});
