import { describe, expect, it } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { availableTickets } from '../domain/planetGacha';
import { getPlanetSpecies } from '../domain/planetCatalog';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore } from './archiveStore';

const NOW = '2025-04-05T06:07:08.000Z';

function uuid(n: number): string {
  return `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function createHarness(random: () => number = () => 0) {
  const clock = new FakeClock();
  const storage = new FakeLocalStorageAdapter();
  const persistence = new PersistenceService({
    storage,
    scheduler: clock,
    nowIso: () => NOW,
  });
  let uuidCounter = 0;
  const store = createArchiveStore({
    persistence,
    providers: {
      nextUuid: () => uuid(++uuidCounter),
      nowIso: () => NOW,
      nextRandom: random,
    },
  });
  return { store };
}

function addStar(store: ReturnType<typeof createHarness>['store'], index: number) {
  return store.getState().commands.addWork({
    title: `Movie ${index}`,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-04-01',
    director: `Director ${index}`,
  });
}

describe('gacha ticket accrual', () => {
  it('earns one ticket per five added works', () => {
    const { store } = createHarness();
    expect(availableTickets(store.getState().persisted.planetCollection)).toBe(0);

    for (let i = 0; i < 5; i += 1) {
      expect(addStar(store, i).ok).toBe(true);
    }

    const collection = store.getState().persisted.planetCollection;
    expect(collection.lifetimeStarsAdded).toBe(5);
    expect(availableTickets(collection)).toBe(1);
  });

  it('keeps lifetime tickets even after works are deleted', () => {
    const { store } = createHarness();
    const results = Array.from({ length: 5 }, (_, i) => addStar(store, i));
    const firstId = results[0]!.ok ? results[0]!.value.starId : '';
    store.getState().commands.hardDelete(firstId);

    const collection = store.getState().persisted.planetCollection;
    expect(collection.lifetimeStarsAdded).toBe(5);
    expect(availableTickets(collection)).toBe(1);
  });
});

describe('pullPlanet command', () => {
  it('rejects a pull when no ticket is available', () => {
    const { store } = createHarness();
    const result = store.getState().commands.pullPlanet();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(store.getState().persisted.planetCollection.planets).toHaveLength(0);
  });

  it('spends a ticket, adds a planet, and emits a planet-pulled event', () => {
    // Rolls of 0 => common tier, first common species, orbit seed 0.
    const { store } = createHarness(() => 0);
    for (let i = 0; i < 5; i += 1) addStar(store, i);

    const result = store.getState().commands.pullPlanet();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rarity).toBe('common');
    expect(getPlanetSpecies(result.value.speciesId)).toBeDefined();
    expect(result.value.isNewSpecies).toBe(true);

    const collection = store.getState().persisted.planetCollection;
    expect(collection.pullsPerformed).toBe(1);
    expect(collection.planets).toHaveLength(1);
    expect(availableTickets(collection)).toBe(0);

    const pulledEvents = store
      .getState()
      .runtime.completionEvents.filter((event) => event.type === 'planet-pulled');
    expect(pulledEvents).toHaveLength(1);
    expect(pulledEvents[0]!.payload.speciesId).toBe(result.value.speciesId);
  });

  it('draws a legendary species on a high rarity roll', () => {
    const { store } = createHarness(() => 0.999);
    for (let i = 0; i < 5; i += 1) addStar(store, i);
    const result = store.getState().commands.pullPlanet();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rarity).toBe('legendary');
  });
});

describe('planet codex panel toggle', () => {
  it('opens and closes the codex panel', () => {
    const { store } = createHarness();
    expect(store.getState().runtime.isPlanetCodexOpen).toBe(false);
    store.getState().commands.setPlanetCodexOpen(true);
    expect(store.getState().runtime.isPlanetCodexOpen).toBe(true);
    store.getState().commands.setPlanetCodexOpen(false);
    expect(store.getState().runtime.isPlanetCodexOpen).toBe(false);
  });
});
