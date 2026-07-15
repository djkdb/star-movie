import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { PersistedStateV2, Star, Store } from '../domain/models';
import { normalizeDisplayText, normalizeText } from '../domain/normalization';
import { decodePersistedV2 } from '../persistence/persistedStateCodec';
import { PersistenceService, type LoadResult } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import {
  createArchiveStore,
  createArchiveStoreFromLoadResult,
} from './archiveStore';
import {
  reconcileProgressAfterMutation,
  reconcileRestoredProgress,
} from './progressReconciler';

const NOW = '2025-06-01T00:00:00.000Z';
const LATER = '2025-07-01T00:00:00.000Z';

function uuid(index: number): string {
  return `40000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createStar(
  state: Pick<PersistedStateV2, 'galaxies'>,
  index: number,
  title = `Work ${index}`,
  director = 'Other Director',
): Star {
  const displayTitle = normalizeDisplayText(title);
  const displayDirector = normalizeDisplayText(director);
  const galaxy = state.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === 'SF',
  );
  if (galaxy === undefined) throw new Error('Missing SF galaxy');
  return {
    id: uuid(index),
    title: displayTitle,
    normalizedTitle: normalizeText(displayTitle),
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate: '2025-05-01',
    director: displayDirector,
    normalizedDirector: normalizeText(displayDirector),
    position: { ...galaxy.center },
    createdAt: NOW,
  };
}

function nolanStars(state: PersistedStateV2, count: number): Star[] {
  return Array.from({ length: count }, (_, index) =>
    createStar(state, index + 1, `Nolan Work ${index + 1}`, 'Christopher Nolan'),
  );
}

function reconcile(
  previous: PersistedStateV2,
  candidate: PersistedStateV2,
  rewardIds: readonly string[],
  nowIso = NOW,
) {
  let rewardIndex = 0;
  return reconcileProgressAfterMutation(previous, candidate, {
    nowIso,
    nextRewardId: () => {
      const rewardId = rewardIds[rewardIndex];
      if (rewardId === undefined) throw new Error('Unexpected reward allocation');
      rewardIndex += 1;
      return rewardId;
    },
  });
}

function persistence(failWrites = false): PersistenceService {
  return new PersistenceService({
    storage: new FakeLocalStorageAdapter({ failWrites }),
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
}

describe('milestone progress reconciliation', () => {
  it('R16.1-R16.14 unlocks 50 then 100 exactly once and preserves sticky rewards after decrease and re-crossing', () => {
    const initial = createDefaultStore(true).persisted;
    const crossing = structuredClone(initial);
    crossing.stars = Array.from({ length: 100 }, (_, index) =>
      createStar(crossing, index + 1),
    );

    const first = reconcile(initial, crossing, [uuid(901), uuid(902)]);

    expect(first.completionEvents.map(({ type, payload }) => [type, payload.target])).toEqual([
      ['milestone-unlocked', 50],
      ['milestone-unlocked', 100],
    ]);
    expect(first.candidate.milestoneUnlocks).toEqual({
      fifty: {
        target: 50,
        unlocked: true,
        unlockedAt: NOW,
        rewardId: uuid(901),
      },
      hundred: {
        target: 100,
        unlocked: true,
        unlockedAt: NOW,
        rewardId: uuid(902),
      },
    });
    expect(
      first.candidate.galaxies.filter((galaxy) => galaxy.kind.type === 'reward'),
    ).toEqual([
      expect.objectContaining({
        id: uuid(902),
        kind: { type: 'reward', rewardType: 'milestone-100' },
        unlocked: true,
      }),
    ]);
    expect(decodePersistedV2(first.candidate)).toEqual(first.candidate);

    const decreased = structuredClone(first.candidate);
    decreased.stars = decreased.stars.slice(0, 10);
    const afterDecrease = reconcile(first.candidate, decreased, [], LATER);
    expect(afterDecrease.completionEvents).toEqual([]);
    expect(afterDecrease.candidate.milestoneUnlocks).toEqual(
      first.candidate.milestoneUnlocks,
    );

    const reCrossing = structuredClone(afterDecrease.candidate);
    reCrossing.stars = [...first.candidate.stars];
    const afterReCrossing = reconcile(afterDecrease.candidate, reCrossing, [], LATER);
    expect(afterReCrossing.completionEvents).toEqual([]);
    expect(afterReCrossing.candidate.milestoneUnlocks).toEqual(
      first.candidate.milestoneUnlocks,
    );
    expect(
      afterReCrossing.candidate.galaxies.filter(
        (galaxy) => galaxy.kind.type === 'reward' && galaxy.id === uuid(902),
      ),
    ).toHaveLength(1);
  });
});

describe('achievement progress reconciliation', () => {
  it('R17.1-R17.10 counts exact normalized Nolan Unique Work Keys and emits only the first unlock event', () => {
    const initial = createDefaultStore(true).persisted;
    initial.stars = nolanStars(initial, 9);
    const crossing = structuredClone(initial);
    crossing.stars.push(
      createStar(crossing, 10, 'Nolan Work 10', 'Christopher Nolan'),
      createStar(crossing, 11, '  NOLAN WORK 1  ', '  CHRISTOPHER NOLAN  '),
      createStar(crossing, 12, 'Nolan Work 11', 'Christopher Nolan Jr'),
    );

    const first = reconcile(initial, crossing, []);
    const achievement = first.candidate.achievements[0]!;
    expect(achievement).toMatchObject({
      id: 'nolan-master',
      progress: 10,
      target: 10,
      unlocked: true,
      unlockedAt: NOW,
    });
    expect(first.completionEvents).toEqual([
      expect.objectContaining({
        type: 'achievement-unlocked',
        payload: expect.objectContaining({
          achievementId: 'nolan-master',
          name: '놀란 마스터',
        }),
      }),
    ]);

    const decreased = structuredClone(first.candidate);
    decreased.stars = [decreased.stars[0]!];
    const afterDecrease = reconcile(first.candidate, decreased, [], LATER);
    expect(afterDecrease.candidate.achievements[0]).toMatchObject({
      progress: 1,
      unlocked: true,
      unlockedAt: NOW,
    });
    expect(afterDecrease.completionEvents).toEqual([]);

    const reAdded = structuredClone(afterDecrease.candidate);
    reAdded.stars = [...first.candidate.stars];
    const afterReAdd = reconcile(afterDecrease.candidate, reAdded, [], LATER);
    expect(afterReAdd.candidate.achievements[0]).toMatchObject({
      progress: 10,
      unlocked: true,
      unlockedAt: NOW,
    });
    expect(afterReAdd.completionEvents).toEqual([]);
  });
});

describe('archive store progress integration', () => {
  it('R16.1 R16.6 R16.8 reconciles add and hard delete in the existing atomic command flow', () => {
    const initial: Store = createDefaultStore(true);
    initial.persisted.stars = Array.from({ length: 49 }, (_, index) =>
      createStar(initial.persisted, index + 1),
    );
    const generatedIds = [uuid(800), uuid(801)];
    let generatedIndex = 0;
    const store = createArchiveStore({
      persistence: persistence(),
      initialState: initial,
      providers: {
        nextUuid: () => generatedIds[generatedIndex++]!,
        nowIso: () => NOW,
      },
    });

    const added = store.getState().commands.addWork({
      title: 'Threshold Work',
      genre: 'SF',
      rating: 5,
      review: '',
      watchedDate: '2025-05-31',
      director: 'Other Director',
    });
    expect(added.ok).toBe(true);
    expect(added.ok && added.completionEvents.map(({ type }) => type)).toEqual([
      'work-added',
      'milestone-unlocked',
    ]);
    const milestoneEvent = store.getState().runtime.completionEvents.find(
      ({ type }) => type === 'milestone-unlocked',
    );
    expect(milestoneEvent).toBeDefined();
    expect(store.getState().runtime.toastEvents).toEqual([milestoneEvent]);
    const firstUnlock = structuredClone(
      store.getState().persisted.milestoneUnlocks.fifty,
    );

    const deleted = store.getState().commands.hardDelete(uuid(800));
    expect(deleted.ok).toBe(true);
    expect(deleted.ok && deleted.completionEvents.map(({ type }) => type)).toEqual([
      'work-hard-deleted',
    ]);
    expect(store.getState().persisted.stars).toHaveLength(49);
    expect(store.getState().persisted.milestoneUnlocks.fifty).toEqual(firstUnlock);
    expect(store.getState().persisted.constellations).toEqual([]);
  });

  it('R17.3-R17.5 routes the first achievement unlock to effects and toast queues exactly once', () => {
    const initial: Store = createDefaultStore(true);
    initial.persisted.stars = nolanStars(initial.persisted, 9);
    const store = createArchiveStore({
      persistence: persistence(),
      initialState: initial,
      providers: {
        nextUuid: () => uuid(800),
        nowIso: () => NOW,
      },
    });

    const result = store.getState().commands.addWork({
      title: 'Nolan Work 10',
      genre: 'SF',
      rating: 5,
      review: '',
      watchedDate: '2025-05-31',
      director: 'Christopher Nolan',
    });

    expect(result.ok).toBe(true);
    expect(store.getState().persisted.achievements[0]).toMatchObject({
      progress: 10,
      unlocked: true,
      unlockedAt: NOW,
    });
    const achievementEvents = store.getState().runtime.completionEvents.filter(
      ({ type }) => type === 'achievement-unlocked',
    );
    expect(achievementEvents).toHaveLength(1);
    expect(store.getState().runtime.toastEvents).toEqual(achievementEvents);

    store.getState().commands.consumeToastEvent(achievementEvents[0]!.id);
    expect(store.getState().runtime.toastEvents).toEqual([]);
    expect(store.getState().runtime.completionEvents).toContainEqual(
      achievementEvents[0],
    );
  });

  it('R16.10 R17.11-R17.13 silently reconciles restored progress and reward duplicates without unlock events', () => {
    const restored = createDefaultStore(true).persisted;
    restored.stars = nolanStars(restored, 10);
    restored.achievements[0] = {
      ...restored.achievements[0]!,
      progress: 0,
      unlocked: true,
      unlockedAt: NOW,
    };
    restored.milestoneUnlocks.hundred = {
      target: 100,
      unlocked: true,
      unlockedAt: NOW,
      rewardId: uuid(950),
    };
    restored.galaxies.push(
      {
        id: uuid(950),
        kind: { type: 'reward', rewardType: 'milestone-100' },
        center: { x: 0, y: 0, z: 90 },
        placementRadius: 18,
        themeId: 'milestone-100-reward',
        primaryColor: '#8B5CF6',
        unlocked: true,
      },
      {
        id: uuid(951),
        kind: { type: 'reward', rewardType: 'milestone-100' },
        center: { x: 0, y: 0, z: 120 },
        placementRadius: 18,
        themeId: 'milestone-100-reward',
        primaryColor: '#8B5CF6',
        unlocked: true,
      },
    );

    const silentlyReconciled = reconcileRestoredProgress(restored);
    expect(silentlyReconciled.achievements[0]).toMatchObject({
      progress: 10,
      unlocked: true,
      unlockedAt: NOW,
    });
    expect(
      silentlyReconciled.galaxies.filter((galaxy) => galaxy.kind.type === 'reward'),
    ).toHaveLength(1);

    const loadResult: LoadResult = {
      ok: true,
      state: restored,
      source: 'storage',
      hasPersistedRegistration: true,
    };
    const store = createArchiveStoreFromLoadResult(loadResult, persistence());
    expect(store.getState().persisted.achievements[0]).toMatchObject({
      progress: 10,
      unlocked: true,
      unlockedAt: NOW,
    });
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toEqual([]);
  });

  it('R2.15 R16.1 R17.3 suppresses all reconcile state and events when persistence fails', () => {
    const initial: Store = createDefaultStore(true);
    initial.persisted.stars = Array.from({ length: 49 }, (_, index) =>
      createStar(initial.persisted, index + 1),
    );
    const before = structuredClone(initial.persisted);
    const generatedIds = [uuid(800), uuid(801)];
    let generatedIndex = 0;
    const store = createArchiveStore({
      persistence: persistence(true),
      initialState: initial,
      providers: {
        nextUuid: () => generatedIds[generatedIndex++]!,
        nowIso: () => NOW,
      },
    });

    const result = store.getState().commands.addWork({
      title: 'Failed Threshold Work',
      genre: 'SF',
      rating: 4,
      review: '',
      watchedDate: '2025-05-31',
      director: 'Other Director',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.completionEvents).toEqual([]);
  });
});
