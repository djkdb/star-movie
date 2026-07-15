import { describe, expect, it } from 'vitest';

import { createDefaultPersistedStore } from '../domain/defaultState';
import type { PersistedStateV2 } from '../domain/models';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { encodePersistedV2 } from './persistedStateCodec';
import {
  AUTOSAVE_DEBOUNCE_MS,
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
  type StorageAdapter,
} from './persistenceService';

function stateWithTitle(title: string): PersistedStateV2 {
  const state = createDefaultPersistedStore();
  state.stars.push({
    id: '10000000-0000-4000-8000-000000000001',
    title,
    normalizedTitle: title.toLocaleLowerCase('und'),
    genre: 'SF',
    rating: 5,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Christopher Nolan',
    normalizedDirector: 'christopher nolan',
    position: { x: -45, y: 0, z: -45 },
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  return state;
}

describe('PersistenceService', () => {
  it('R8.10-R8.13 restores a codec-validated document from the single key', () => {
    const expected = stateWithTitle('Interstellar');
    const storage = new FakeLocalStorageAdapter({
      initial: { [PERSISTENCE_STORAGE_KEY]: encodePersistedV2(expected) },
    });

    const result = new PersistenceService({ storage, scheduler: new FakeClock() }).load();

    expect(result).toMatchObject({ ok: true, source: 'storage', hasPersistedRegistration: true });
    expect(result.state).toEqual(expected);
    expect(storage.length).toBe(1);
  });

  it('R8.11-R8.12 and R8.17 fully recovers defaults for read, JSON, and schema failures', () => {
    const cases = [
      new FakeLocalStorageAdapter({ failReads: true }),
      new FakeLocalStorageAdapter({ initial: { [PERSISTENCE_STORAGE_KEY]: '{bad json' } }),
      new FakeLocalStorageAdapter({
        initial: { [PERSISTENCE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, stars: [] }) },
      }),
    ];

    for (const storage of cases) {
      const result = new PersistenceService({ storage, scheduler: new FakeClock() }).load();
      expect(result.ok).toBe(false);
      expect(result.state).toEqual(createDefaultPersistedStore());
      expect(result.state.stars).toEqual([]);
      expect(result.state.galaxies).toHaveLength(8);
    }
  });

  it('R8.1 and R8.14 debounces within one second and coalesces to the latest state', () => {
    const clock = new FakeClock();
    const storage = new FakeLocalStorageAdapter();
    const service = new PersistenceService({ storage, scheduler: clock });

    service.scheduleAutosave(stateWithTitle('Older'));
    clock.advanceBy(600);
    service.scheduleAutosave(stateWithTitle('Latest'));
    clock.advanceBy(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).toBeNull();

    clock.advanceBy(1);
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).toBe(
      encodePersistedV2(stateWithTitle('Latest')),
    );
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it('R8.16 keeps autosave failure silent and records diagnostics without memory mutation', () => {
    const clock = new FakeClock();
    const storage = new FakeLocalStorageAdapter({ failWrites: true });
    const candidate = stateWithTitle('Immutable');
    const before = structuredClone(candidate);
    const observed: unknown[] = [];
    const service = new PersistenceService({
      storage,
      scheduler: clock,
      nowIso: () => '2025-03-01T00:00:00.000Z',
      onAutosaveDiagnostics: (diagnostics) => observed.push(diagnostics),
    });

    service.scheduleAutosave(candidate);
    expect(() => clock.advanceBy(1_000)).not.toThrow();

    expect(candidate).toEqual(before);
    expect(service.getDiagnostics()).toEqual({
      lastAutosaveError: 'STORAGE_WRITE: Injected localStorage write failure',
      lastAutosaveErrorAt: '2025-03-01T00:00:00.000Z',
    });
    expect(observed).toHaveLength(1);
  });

  it('R8.15 and R8.18 returns an independent user-write failure and leaves memory untouched', () => {
    const storage = new FakeLocalStorageAdapter({ failWrites: true });
    const candidate = stateWithTitle('No Commit');
    const before = structuredClone(candidate);
    const service = new PersistenceService({ storage, scheduler: new FakeClock() });

    const first = service.saveUserAction(candidate);
    const second = service.saveUserAction(candidate);

    expect(first).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(second).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(first).not.toBe(second);
    expect(candidate).toEqual(before);
  });

  it('R8.14-R8.18 serializes re-entrant autosave and user writes without stale overwrite', () => {
    const clock = new FakeClock();
    const writes: string[] = [];
    let service: PersistenceService;
    const userState = stateWithTitle('User');
    const autosaveState = stateWithTitle('Autosave');
    const storage: StorageAdapter = {
      getItem: () => null,
      setItem: (_key, value) => {
        writes.push(value);
        if (writes.length === 1) {
          const nested = service.saveUserAction(userState);
          expect(nested).toMatchObject({ ok: false, error: { code: 'WRITE_BUSY' } });
        }
      },
    };
    service = new PersistenceService({ storage, scheduler: clock });

    service.scheduleAutosave(autosaveState);
    clock.advanceBy(1_000);
    const result = service.saveUserAction(userState);

    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([encodePersistedV2(autosaveState), encodePersistedV2(userState)]);
  });
});
