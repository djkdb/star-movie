// Importing a backup replaces the whole archive, so it must both persist the
// new document and drop every runtime reference to the universe it replaced.

import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { PersistedStateV2 } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore, type ArchiveStoreApi } from './archiveStore';

function createStore(storage = new FakeLocalStorageAdapter()): ArchiveStoreApi {
  return createArchiveStore({
    persistence: new PersistenceService({
      storage,
      scheduler: new FakeClock(),
      nowIso: () => '2030-01-01T00:00:00.000Z',
    }),
    initialState: createDefaultStore(true),
  });
}

/** An archive holding a single work, built through the real add command. */
function archiveWithWork(title: string): PersistedStateV2 {
  const store = createStore();
  try {
    const added = store.getState().commands.addWork({
      title,
      genre: 'SF',
      rating: 5,
      review: '',
      watchedDate: '2025-01-01',
      director: 'Director',
    });
    if (!added.ok) throw new Error('setup failed');
    return structuredClone(store.getState().persisted);
  } finally {
    store.dispose();
  }
}

describe('importArchive', () => {
  it('replaces the archive and persists it', () => {
    const storage = new FakeLocalStorageAdapter();
    const store = createStore(storage);
    try {
      const incoming = archiveWithWork('Imported Work');

      const result = store.getState().commands.importArchive(incoming);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.workCount).toBe(1);
      expect(store.getState().persisted.stars.map(({ title }) => title))
        .toEqual(['Imported Work']);

      // A fresh service reading the same storage must see the imported archive.
      const reloaded = new PersistenceService({
        storage,
        scheduler: new FakeClock(),
        nowIso: () => '2030-01-01T00:00:00.000Z',
      }).load();
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) return;
      expect(reloaded.state.stars.map(({ title }) => title)).toEqual(['Imported Work']);
    } finally {
      store.dispose();
    }
  });

  it('clears selections, camera state and drafts that point at the old universe', () => {
    const store = createStore();
    try {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          selectedStarId: 'star-from-previous-universe',
          selectedGenres: new Set(['SF'] as const),
          watchlistPrefill: null,
        },
      }));
      store.getState().commands.capturePreFocusPose({
        position: { x: 1, y: 2, z: 3 },
        target: { x: 0, y: 0, z: 0 },
      });

      store.getState().commands.importArchive(archiveWithWork('Fresh Start'));

      const { runtime } = store.getState();
      expect(runtime.selectedStarId).toBeNull();
      expect(runtime.preFocusPose).toBeNull();
      expect(runtime.pendingCameraRequest).toBeNull();
      expect(runtime.selectedGenres.size).toBe(0);
      expect(runtime.constellationDraft.active).toBe(false);
    } finally {
      store.dispose();
    }
  });

  it('leaves the existing archive untouched when the document is invalid', () => {
    const store = createStore();
    try {
      const before = structuredClone(store.getState().persisted);
      const corrupted = {
        ...structuredClone(before),
        stars: [{ id: 'missing-every-other-field' }],
      } as unknown as PersistedStateV2;

      const result = store.getState().commands.importArchive(corrupted);

      expect(result.ok).toBe(false);
      expect(store.getState().persisted).toEqual(before);
    } finally {
      store.dispose();
    }
  });
});
