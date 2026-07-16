import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { Genre } from '../domain/models';
import {
  AUTOSAVE_DEBOUNCE_MS,
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
  type StorageAdapter,
} from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import {
  archiveSelectors,
  captureOperationSnapshot,
  createArchiveStore,
  createArchiveStoreFromLoadResult,
} from './archiveStore';
import {
  createDeterministicStarPosition,
  STAR_FIELD_CENTER,
  STAR_FIELD_RADII,
} from './deterministicPlacement';

const STAR_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2025-04-05T06:07:08.000Z';

const validInput = {
  title: '  Interstellar  ',
  genre: 'SF',
  rating: 5,
  review: 'Space',
  watchedDate: '2025-04-01',
  director: '  Christopher Nolan  ',
} as const;

function createHarness(options: { failWrites?: boolean } = {}) {
  const clock = new FakeClock();
  const storage = new FakeLocalStorageAdapter(options);
  const persistence = new PersistenceService({
    storage,
    scheduler: clock,
    nowIso: () => NOW,
  });
  const store = createArchiveStore({
    persistence,
    providers: { nextUuid: () => STAR_ID, nowIso: () => NOW },
  });
  return { clock, storage, persistence, store };
}

describe('deterministic star placement', () => {
  it('R2.9-R2.10 returns the same bounded 3D position for the same UUID and genre', () => {
    const first = createDeterministicStarPosition(STAR_ID, 'SF');
    const second = createDeterministicStarPosition(STAR_ID, 'SF');
    const otherGenre = createDeterministicStarPosition(STAR_ID, '기타' as Genre);

    expect(first).toEqual(second);
    expect(first).not.toEqual(otherGenre);
    // Stars are scattered across the shared field ellipsoid, not clustered by
    // genre, so the position sits within the field bounds around the origin.
    const normalized = Math.hypot(
      (first.x - STAR_FIELD_CENTER.x) / STAR_FIELD_RADII.x,
      (first.y - STAR_FIELD_CENTER.y) / STAR_FIELD_RADII.y,
      (first.z - STAR_FIELD_CENTER.z) / STAR_FIELD_RADII.z,
    );
    expect(normalized).toBeLessThanOrEqual(1.0001);
  });
});

describe('archive Zustand store', () => {
  it('R2.9-R2.19 validates, persists, and atomically commits addWork with one success event', () => {
    let persistedAtCommit: string | null = null;
    const { storage, store } = createHarness();
    const initialPersisted = store.getState().persisted;
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
      persistedAtCommit = storage.getItem(PERSISTENCE_STORAGE_KEY);
    });

    const result = store.getState().commands.addWork(validInput);

    expect(result).toMatchObject({ ok: true, value: { starId: STAR_ID } });
    expect(notifications).toBe(1);
    expect(persistedAtCommit).not.toBeNull();
    const state = store.getState();
    expect(state.persisted).not.toBe(initialPersisted);
    expect(state.persisted.stars).toHaveLength(1);
    expect(state.persisted.stars[0]).toMatchObject({
      id: STAR_ID,
      title: 'Interstellar',
      normalizedTitle: 'interstellar',
      director: 'Christopher Nolan',
      normalizedDirector: 'christopher nolan',
      createdAt: NOW,
    });
    expect(state.runtime.hasPersistedRegistration).toBe(true);
    expect(state.runtime.completionEvents).toEqual(result.ok ? result.completionEvents : []);
    expect(state.runtime.completionEvents[0]).toMatchObject({
      type: 'work-added',
      payload: {
        starId: STAR_ID,
        rating: 5,
        particleEffects: ['fireworks', 'meteor-shower'],
      },
    });
    expect(state.runtime.toastEvents).toEqual([]);
  });

  it('R2.13-R2.15 blocks invalid form input without persistence, diagnostics, or effects', () => {
    const { storage, store } = createHarness();
    const before = captureOperationSnapshot(store.getState());

    const result = store.getState().commands.addWork({
      ...validInput,
      title: '   ',
      watchedDate: '2025-02-30',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    if (!result.ok && result.error.code === 'VALIDATION') {
      expect(result.error.fieldErrors).toMatchObject({
        title: expect.any(Array),
        watchedDate: expect.any(Array),
      });
    }
    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toEqual([]);
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).toBeNull();
  });

  it('R2.15 R8.15 R8.18 preserves the snapshot and queues every rapid user-save failure independently', () => {
    const { store } = createHarness({ failWrites: true });
    const persistedReference = store.getState().persisted;
    const before = structuredClone(persistedReference);

    const first = store.getState().commands.addWork(validInput);
    const second = store.getState().commands.addWork(validInput);

    expect(first).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(second).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(store.getState().persisted).toBe(persistedReference);
    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toHaveLength(2);
    expect(store.getState().runtime.toastEvents.map(({ id }) => id)).toEqual([
      'user-save-failed:1',
      'user-save-failed:2',
    ]);
    expect(store.getState().runtime.toastEvents.every(
      ({ type }) => type === 'user-save-failed',
    )).toBe(true);
    expect(store.getState().runtime.commandDiagnostics).toMatchObject({
      operation: 'addWork',
      code: 'STORAGE_WRITE',
      occurredAt: NOW,
    });
  });

  it('R8.16 records autosave failures in diagnostics without a toast or memory mutation', () => {
    const { clock, store } = createHarness({ failWrites: true });
    const before = captureOperationSnapshot(store.getState());

    store.getState().commands.scheduleAutosave();
    clock.advanceBy(AUTOSAVE_DEBOUNCE_MS);

    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.toastEvents).toEqual([]);
    expect(store.getState().runtime.storageDiagnostics).toEqual({
      lastAutosaveError: 'STORAGE_WRITE: Injected localStorage write failure',
      lastAutosaveErrorAt: NOW,
    });
  });

  it('R2.15 rejects an invalid generated candidate before storage and emits no completion event', () => {
    let writes = 0;
    const storage: StorageAdapter = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      },
    };
    const persistence = new PersistenceService({ storage, scheduler: new FakeClock() });
    const store = createArchiveStore({
      persistence,
      providers: { nextUuid: () => 'not-a-uuid', nowIso: () => NOW },
    });

    const result = store.getState().commands.addWork(validInput);

    expect(result).toMatchObject({ ok: false, error: { code: 'SERIALIZATION' } });
    expect(writes).toBe(0);
    expect(store.getState().persisted.stars).toEqual([]);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toHaveLength(1);
  });

  it('R8.10 composes a bootstrap load result and exposes persisted/runtime selector boundaries', () => {
    const persistence = new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
    });
    const loaded = persistence.load();
    const store = createArchiveStoreFromLoadResult(loaded, persistence, {
      nextUuid: () => STAR_ID,
      nowIso: () => NOW,
    });
    const state = store.getState();

    expect(archiveSelectors.persisted(state)).toBe(state.persisted);
    expect(archiveSelectors.runtime(state)).toBe(state.runtime);
    expect(archiveSelectors.stars(state)).toBe(state.persisted.stars);
    expect(archiveSelectors.sceneArchiveContent(state)).toEqual({
      stars: [],
      constellations: [],
    });
    expect(state.persisted).toEqual(createDefaultStore().persisted);
  });
});


describe('runtime quality state', () => {
  it('R13.3-R13.5 degrades one session-only level per command without persistence or skipped stages', () => {
    const { storage, store } = createHarness();
    const persisted = store.getState().persisted;

    expect(store.getState().runtime.qualityLevel).toBe('full');
    expect(store.getState().commands.degradeQuality()).toBe('reducedBackground');
    expect(store.getState().commands.degradeQuality()).toBe('minimumParticles');
    expect(store.getState().commands.degradeQuality()).toBe('reducedBloom');
    expect(store.getState().commands.degradeQuality()).toBe('reducedBloom');

    expect(store.getState().persisted).toBe(persisted);
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).toBeNull();

    const freshSession = createHarness().store;
    expect(freshSession.getState().runtime.qualityLevel).toBe('full');
  });
});
