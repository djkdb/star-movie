import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { Genre, Star, Store } from '../domain/models';
import {
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
  type StorageAdapter,
} from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore } from './archiveStore';
import {
  MAX_CONSTELLATION_STARS,
  selectDeterministicConstellationColor,
} from './constellation';

const NOW = '2025-04-05T06:07:08.000Z';

function uuid(index: number): string {
  return `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createStar(
  state: Store,
  index: number,
  genre: Genre,
  createdAt = NOW,
): Star {
  const galaxy = state.persisted.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === genre,
  );
  if (galaxy === undefined) throw new Error(`Missing ${genre} galaxy`);
  return {
    id: uuid(index),
    title: `Work ${index}`,
    normalizedTitle: `work ${index}`,
    genre,
    rating: 3,
    review: '',
    watchedDate: '2025-04-01',
    director: `Director ${index}`,
    normalizedDirector: `director ${index}`,
    position: { ...galaxy.center },
    createdAt,
  };
}

function createHarness(options: {
  state?: Store;
  generatedIds?: readonly string[];
  storage?: StorageAdapter;
} = {}) {
  const storage = options.storage ?? new FakeLocalStorageAdapter();
  const persistence = new PersistenceService({
    storage,
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  let idIndex = 0;
  const generatedIds = options.generatedIds ?? [uuid(900)];
  const store = createArchiveStore({
    persistence,
    initialState: options.state,
    providers: {
      nextUuid: () => {
        const value = generatedIds[idIndex];
        if (value === undefined) throw new Error('UUID sequence exhausted');
        idIndex += 1;
        return value;
      },
      nowIso: () => NOW,
    },
  });
  return { storage, store };
}

function stateWithStars(count: number): Store {
  const state = createDefaultStore(true);
  state.persisted.stars = Array.from({ length: count }, (_, index) =>
    createStar(state, index + 1, 'SF'),
  );
  return state;
}

describe('constellation draft commands', () => {
  it('R9.1-R9.5 R9.8-R9.9 preserves click order, ignores duplicates, enforces bounds, and cancels cleanly', () => {
    const state = stateWithStars(MAX_CONSTELLATION_STARS + 1);
    const { store } = createHarness({ state });
    const commands = store.getState().commands;

    expect(commands.startConstellationDraft(uuid(2))).toMatchObject({ ok: true });
    expect(commands.selectConstellationStar(uuid(1))).toMatchObject({ ok: true });
    expect(commands.selectConstellationStar(uuid(2))).toMatchObject({ ok: true });
    expect(store.getState().runtime.constellationDraft.starIds).toEqual([
      uuid(2),
      uuid(1),
    ]);
    expect(commands.finishConstellationDraft()).toMatchObject({ ok: true });
    expect(store.getState().runtime.constellationDraft.phase).toBe('naming');

    commands.startConstellationDraft();
    for (let index = 1; index <= MAX_CONSTELLATION_STARS; index += 1) {
      expect(commands.selectConstellationStar(uuid(index)).ok).toBe(true);
    }
    const beforeOverflow = [...store.getState().runtime.constellationDraft.starIds];
    const overflow = commands.selectConstellationStar(
      uuid(MAX_CONSTELLATION_STARS + 1),
    );
    expect(overflow).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(store.getState().runtime.constellationDraft.starIds).toEqual(beforeOverflow);
    expect(store.getState().runtime.constellationDraft.phase).toBe('selecting');
    expect(store.getState().runtime.constellationDraft.error).toContain('200');

    commands.cancelConstellationDraft();
    expect(store.getState().runtime.constellationDraft).toEqual({
      active: false,
      phase: 'selecting',
      starIds: [],
      error: null,
    });
    expect(store.getState().persisted.constellations).toEqual([]);
  });

  it('R9.5 R9.7-R9.8 blocks finishing or naming invalid selections without losing the draft', () => {
    const state = stateWithStars(2);
    const { storage, store } = createHarness({ state });
    const commands = store.getState().commands;

    commands.startConstellationDraft(uuid(1));
    const tooFew = commands.finishConstellationDraft();
    expect(tooFew).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(store.getState().runtime.constellationDraft.starIds).toEqual([uuid(1)]);

    commands.selectConstellationStar(uuid(2));
    commands.finishConstellationDraft();
    const before = structuredClone(store.getState().runtime.constellationDraft);
    const invalidName = commands.createConstellation(' '.repeat(4));
    expect(invalidName).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fieldErrors: { name: expect.any(Array) } },
    });
    expect(store.getState().runtime.constellationDraft).toMatchObject({
      active: before.active,
      phase: before.phase,
      starIds: before.starIds,
      error: '별자리 이름을 입력해 주세요.',
    });
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).toBeNull();
  });
});

describe('manual constellation command', () => {
  it('R9.6 R9.14 trims the name, keeps order, assigns deterministic color, persists, and commits once', () => {
    const state = stateWithStars(2);
    state.persisted.constellations.push({
      id: uuid(800),
      name: 'Existing',
      starIds: [uuid(1), uuid(2)],
      color: '#60A5FA',
      createdAt: NOW,
    });
    const { storage, store } = createHarness({
      state,
      generatedIds: [uuid(900)],
    });
    const commands = store.getState().commands;
    commands.startConstellationDraft(uuid(2));
    commands.selectConstellationStar(uuid(1));
    commands.finishConstellationDraft();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    const result = commands.createConstellation('  My Constellation  ');

    expect(result).toMatchObject({
      ok: true,
      value: { constellationId: uuid(900) },
    });
    expect(notifications).toBe(1);
    expect(store.getState().persisted.constellations[1]).toEqual({
      id: uuid(900),
      name: 'My Constellation',
      starIds: [uuid(2), uuid(1)],
      color: selectDeterministicConstellationColor(['#60A5FA']),
      createdAt: NOW,
    });
    expect(store.getState().runtime.constellationDraft.active).toBe(false);
    expect(store.getState().runtime.completionEvents.at(-1)).toMatchObject({
      type: 'constellation-created',
      payload: { constellationId: uuid(900) },
    });
    expect(storage.getItem(PERSISTENCE_STORAGE_KEY)).not.toBeNull();
  });

  it('R9.15 preserves the persisted snapshot and draft when manual persistence fails', () => {
    const state = stateWithStars(2);
    const storage = new FakeLocalStorageAdapter({ failWrites: true });
    const { store } = createHarness({ state, storage });
    const commands = store.getState().commands;
    commands.startConstellationDraft(uuid(1));
    commands.selectConstellationStar(uuid(2));
    commands.finishConstellationDraft();
    const beforePersisted = structuredClone(store.getState().persisted);
    const beforeDraft = structuredClone(store.getState().runtime.constellationDraft);

    const result = commands.createConstellation('Failure stays selected');

    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(store.getState().persisted).toEqual(beforePersisted);
    expect(store.getState().runtime.constellationDraft).toEqual(beforeDraft);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toHaveLength(1);
  });
});

describe('automatic genre constellation command', () => {
  it('R9.10-R9.11 R9.16 R9.18 creates eligible genres in deterministic order and deduplicates operationId', () => {
    const state = createDefaultStore(true);
    state.persisted.stars = [
      createStar(state, 3, 'SF', '2025-03-01T00:00:00.000Z'),
      createStar(state, 2, 'SF', '2025-02-01T00:00:00.000Z'),
      createStar(state, 1, 'SF', '2025-02-01T00:00:00.000Z'),
      createStar(state, 5, '액션', '2025-01-01T00:00:00.000Z'),
      createStar(state, 4, '액션', '2025-01-01T00:00:00.000Z'),
      createStar(state, 6, '기타', '2025-01-01T00:00:00.000Z'),
    ];
    let writes = 0;
    const backing = new FakeLocalStorageAdapter();
    const storage: StorageAdapter = {
      getItem: (key) => backing.getItem(key),
      setItem: (key, value) => {
        writes += 1;
        backing.setItem(key, value);
      },
    };
    const { store } = createHarness({
      state,
      storage,
      generatedIds: [uuid(901), uuid(902)],
    });

    const first = store.getState().commands.createGenreConstellations('operation-1');
    const second = store.getState().commands.createGenreConstellations('operation-1');

    expect(first).toMatchObject({
      ok: true,
      value: { constellationIds: [uuid(901), uuid(902)] },
    });
    expect(second).toMatchObject({
      ok: true,
      value: { constellationIds: [uuid(901), uuid(902)] },
      completionEvents: [],
    });
    expect(writes).toBe(1);
    expect(store.getState().persisted.constellations).toHaveLength(2);
    expect(store.getState().persisted.constellations[0]).toMatchObject({
      name: 'SF 별자리',
      starIds: [uuid(1), uuid(2), uuid(3)],
    });
    expect(store.getState().persisted.constellations[1]).toMatchObject({
      name: '액션 별자리',
      starIds: [uuid(4), uuid(5)],
    });
    expect(store.getState().runtime.completionEvents).toHaveLength(1);
  });

  it('R9.13 performs no insertion or persistence when no genre is eligible', () => {
    const state = createDefaultStore(true);
    state.persisted.stars = [createStar(state, 1, 'SF')];
    let writes = 0;
    const storage: StorageAdapter = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      },
    };
    const { store } = createHarness({ state, storage, generatedIds: [] });

    expect(store.getState().commands.createGenreConstellations('empty-op')).toEqual({
      ok: true,
      value: { constellationIds: [] },
      completionEvents: [],
    });
    expect(store.getState().commands.createGenreConstellations('empty-op')).toEqual({
      ok: true,
      value: { constellationIds: [] },
      completionEvents: [],
    });
    expect(store.getState().persisted.constellations).toEqual([]);
    expect(writes).toBe(0);
  });

  it('R9.17 rolls back all auto insertions on save failure and permits retrying the operationId', () => {
    const state = createDefaultStore(true);
    state.persisted.stars = [
      createStar(state, 1, 'SF'),
      createStar(state, 2, 'SF'),
    ];
    const storage = new FakeLocalStorageAdapter({ failWrites: true });
    const { store } = createHarness({
      state,
      storage,
      generatedIds: [uuid(901), uuid(902)],
    });
    const before = structuredClone(store.getState().persisted);

    const failed = store.getState().commands.createGenreConstellations('retry-op');
    expect(failed).toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE' } });
    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.completionEvents).toEqual([]);

    storage.failWrites = false;
    const retried = store.getState().commands.createGenreConstellations('retry-op');
    expect(retried).toMatchObject({
      ok: true,
      value: { constellationIds: [uuid(902)] },
    });
    expect(store.getState().persisted.constellations).toHaveLength(1);
  });
});
