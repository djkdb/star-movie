import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { ArchivedStar, Star, Store } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore } from './archiveStore';
import {
  getAffectedConstellationNames,
  reduceHardDelete,
  reduceRestoreArchived,
  reduceSoftDelete,
} from './workCollectionReducers';

const TARGET_ID = '20000000-0000-4000-8000-000000000001';
const FIRST_ID = '20000000-0000-4000-8000-000000000002';
const SECOND_ID = '20000000-0000-4000-8000-000000000003';
const ARCHIVED_ID = '20000000-0000-4000-8000-000000000004';
const NOW = '2025-05-06T07:08:09.000Z';

function createStar(id: string, title: string): Star {
  return {
    id,
    title,
    normalizedTitle: title.toLocaleLowerCase('und'),
    genre: 'SF',
    rating: 4,
    review: `${title} review`,
    watchedDate: '2025-05-01',
    director: 'Denis Villeneuve',
    normalizedDirector: 'denis villeneuve',
    position: { x: -45, y: 0, z: -45 },
    createdAt: '2025-05-02T00:00:00.000Z',
  };
}

function toArchived(star: Star, discardedAt = '2025-05-03T00:00:00.000Z'): ArchivedStar {
  return { ...structuredClone(star), discardedAt };
}

function createInitialState(): Store {
  const state = createDefaultStore(true);
  state.persisted.stars = [
    createStar(FIRST_ID, 'Arrival'),
    createStar(TARGET_ID, 'Dune'),
    createStar(SECOND_ID, 'Blade Runner'),
  ];
  state.persisted.blackholeArchive = [
    toArchived(createStar(ARCHIVED_ID, 'Enemy')),
  ];
  state.persisted.constellations = [
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Desert Worlds',
      starIds: [FIRST_ID, TARGET_ID, SECOND_ID],
      color: '#112233',
      createdAt: '2025-05-04T00:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Future Visions',
      starIds: [TARGET_ID, SECOND_ID],
      color: '#445566',
      createdAt: '2025-05-04T00:00:01.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Unaffected',
      starIds: [FIRST_ID, SECOND_ID],
      color: '#778899',
      createdAt: '2025-05-04T00:00:02.000Z',
    },
  ];
  state.runtime.selectedStarId = TARGET_ID;
  return state;
}

function createHarness(initialState: Store, failWrites = false) {
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter({ failWrites }),
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  return createArchiveStore({
    persistence,
    initialState,
    providers: { nowIso: () => NOW },
  });
}

describe('work collection reducers', () => {
  it('R4.6 R10.9 R10.14 lists affected names and removes every reference without reordering survivors', () => {
    const snapshot = createInitialState().persisted;
    snapshot.constellations[0]!.starIds = [
      FIRST_ID,
      TARGET_ID,
      SECOND_ID,
      TARGET_ID,
    ];

    expect(getAffectedConstellationNames(snapshot, TARGET_ID)).toEqual([
      'Desert Worlds',
      'Future Visions',
    ]);

    const result = reduceHardDelete(snapshot, TARGET_ID);

    expect(result.candidate.stars.map(({ id }) => id)).toEqual([
      FIRST_ID,
      SECOND_ID,
    ]);
    expect(result.candidate.constellations.map(({ starIds }) => starIds)).toEqual([
      [FIRST_ID, SECOND_ID],
      [SECOND_ID],
      [FIRST_ID, SECOND_ID],
    ]);
  });

  it('R12.2-R12.3 R12.10-R12.11 moves atomically with the discardedAt contract and restores no references', () => {
    const snapshot = createInitialState().persisted;

    const softDeleted = reduceSoftDelete(snapshot, TARGET_ID, NOW);
    expect(softDeleted.candidate.stars.some(({ id }) => id === TARGET_ID)).toBe(false);
    expect(
      softDeleted.candidate.blackholeArchive.filter(({ id }) => id === TARGET_ID),
    ).toEqual([{ ...createStar(TARGET_ID, 'Dune'), discardedAt: NOW }]);
    expect(
      softDeleted.candidate.constellations.some(({ starIds }) =>
        starIds.includes(TARGET_ID),
      ),
    ).toBe(false);

    const restored = reduceRestoreArchived(softDeleted.candidate, TARGET_ID);
    expect(restored.candidate.stars.at(-1)).toEqual(createStar(TARGET_ID, 'Dune'));
    expect(
      restored.candidate.blackholeArchive.some(({ id }) => id === TARGET_ID),
    ).toBe(false);
    expect(
      restored.candidate.constellations.some(({ starIds }) =>
        starIds.includes(TARGET_ID),
      ),
    ).toBe(false);
    expect(restored.candidate.stars.at(-1)).not.toHaveProperty('discardedAt');
  });
});

describe('transactional work collection commands', () => {
  it('R4.5-R4.11 R12.13 hard-deletes from both collections and commits the collision effect only after save', () => {
    const initial = createInitialState();
    initial.persisted.blackholeArchive.push(
      toArchived(createStar(TARGET_ID, 'Dune')),
    );
    const store = createHarness(initial);

    expect(store.getState().commands.getAffectedConstellationNames(TARGET_ID)).toEqual([
      'Desert Worlds',
      'Future Visions',
    ]);

    const result = store.getState().commands.hardDelete(TARGET_ID);

    expect(result).toMatchObject({
      ok: true,
      value: {
        starId: TARGET_ID,
        affectedConstellationNames: ['Desert Worlds', 'Future Visions'],
      },
    });
    const state = store.getState();
    expect(state.persisted.stars.some(({ id }) => id === TARGET_ID)).toBe(false);
    expect(
      state.persisted.blackholeArchive.some(({ id }) => id === TARGET_ID),
    ).toBe(false);
    expect(state.persisted.blackholeArchive.map(({ id }) => id)).toEqual([
      ARCHIVED_ID,
    ]);
    expect(state.runtime.selectedStarId).toBeNull();
    expect(state.runtime.completionEvents).toEqual([
      expect.objectContaining({
        type: 'work-hard-deleted',
        payload: expect.objectContaining({
          starId: TARGET_ID,
          affectedConstellationNames: ['Desert Worlds', 'Future Visions'],
          particleEffects: ['asteroid-impact'],
        }),
      }),
    ]);
  });

  it('R10.10 R12.2-R12.5 soft-deletes to exactly one archive record and emits only its completion effect', () => {
    const store = createHarness(createInitialState());

    const result = store.getState().commands.softDelete(TARGET_ID);

    expect(result).toMatchObject({
      ok: true,
      value: {
        starId: TARGET_ID,
        affectedConstellationNames: ['Desert Worlds', 'Future Visions'],
      },
    });
    const state = store.getState();
    expect(state.persisted.stars.some(({ id }) => id === TARGET_ID)).toBe(false);
    expect(
      state.persisted.blackholeArchive.filter(({ id }) => id === TARGET_ID),
    ).toEqual([{ ...createStar(TARGET_ID, 'Dune'), discardedAt: NOW }]);
    expect(state.persisted.constellations.map(({ starIds }) => starIds)).toEqual([
      [FIRST_ID, SECOND_ID],
      [SECOND_ID],
      [FIRST_ID, SECOND_ID],
    ]);
    expect(state.runtime.selectedStarId).toBeNull();
    expect(state.runtime.completionEvents).toEqual([
      expect.objectContaining({
        type: 'work-soft-deleted',
        payload: expect.objectContaining({
          starId: TARGET_ID,
          particleEffects: ['blackhole-spiral'],
        }),
      }),
    ]);
  });

  it('R10.11 R12.10-R12.12 restores to exactly one active record without discardedAt or old references', () => {
    const initial = createInitialState();
    initial.persisted = reduceSoftDelete(initial.persisted, TARGET_ID, NOW).candidate;
    initial.runtime.selectedStarId = null;
    const store = createHarness(initial);

    const result = store.getState().commands.restoreArchived(TARGET_ID);

    expect(result).toMatchObject({ ok: true, value: { starId: TARGET_ID } });
    const state = store.getState();
    expect(state.persisted.stars.filter(({ id }) => id === TARGET_ID)).toHaveLength(1);
    expect(state.persisted.stars.at(-1)).not.toHaveProperty('discardedAt');
    expect(
      state.persisted.blackholeArchive.some(({ id }) => id === TARGET_ID),
    ).toBe(false);
    expect(
      state.persisted.constellations.some(({ starIds }) =>
        starIds.includes(TARGET_ID),
      ),
    ).toBe(false);
    expect(state.runtime.completionEvents).toEqual([
      expect.objectContaining({
        type: 'work-restored',
        payload: expect.objectContaining({
          starId: TARGET_ID,
          particleEffects: [],
        }),
      }),
    ]);
  });

  it('R4.14 R12.4 R12.12-R12.14 preserves snapshot membership and suppresses all completion effects on persistence failure', () => {
    const activeSnapshot = createInitialState();
    const activeStore = createHarness(activeSnapshot, true);
    const activePersistedReference = activeStore.getState().persisted;

    const hardResult = activeStore.getState().commands.hardDelete(TARGET_ID);
    const softResult = activeStore.getState().commands.softDelete(TARGET_ID);

    expect(hardResult).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_WRITE' },
    });
    expect(softResult).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_WRITE' },
    });
    expect(activeStore.getState().persisted).toBe(activePersistedReference);
    expect(activeStore.getState().persisted).toEqual(activeSnapshot.persisted);
    expect(
      activeStore.getState().persisted.stars.filter(({ id }) => id === TARGET_ID),
    ).toHaveLength(1);
    expect(
      activeStore.getState().persisted.blackholeArchive.some(
        ({ id }) => id === TARGET_ID,
      ),
    ).toBe(false);
    expect(activeStore.getState().runtime.selectedStarId).toBe(TARGET_ID);
    expect(activeStore.getState().runtime.completionEvents).toEqual([]);

    const archivedSnapshot = createInitialState();
    archivedSnapshot.persisted = reduceSoftDelete(
      archivedSnapshot.persisted,
      TARGET_ID,
      NOW,
    ).candidate;
    archivedSnapshot.runtime.selectedStarId = null;
    const archivedStore = createHarness(archivedSnapshot, true);
    const archivedPersistedReference = archivedStore.getState().persisted;

    const restoreResult = archivedStore.getState().commands.restoreArchived(TARGET_ID);

    expect(restoreResult).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_WRITE' },
    });
    expect(archivedStore.getState().persisted).toBe(archivedPersistedReference);
    expect(archivedStore.getState().persisted).toEqual(archivedSnapshot.persisted);
    expect(
      archivedStore.getState().persisted.stars.some(({ id }) => id === TARGET_ID),
    ).toBe(false);
    expect(
      archivedStore.getState().persisted.blackholeArchive.filter(
        ({ id }) => id === TARGET_ID,
      ),
    ).toHaveLength(1);
    expect(archivedStore.getState().runtime.completionEvents).toEqual([]);
  });
});
