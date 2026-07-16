import { describe, expect, it } from 'vitest';

import { createDemoSeedPersistedStore } from './demoSeedState';
import { GENRES } from './models';
import {
  bootstrapPersistedState,
  seedDemoArchiveIfFirstRun,
} from '../persistence/bootstrapPersistedState';
import {
  decodePersistedV2,
  encodePersistedV2,
} from '../persistence/persistedStateCodec';
import { PersistenceService } from '../persistence/persistenceService';
import { STAR_FIELD_CENTER, STAR_FIELD_RADII } from '../store/deterministicPlacement';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';

function createService(storage = new FakeLocalStorageAdapter()) {
  return {
    storage,
    service: new PersistenceService({
      storage,
      scheduler: new FakeClock(),
      nowIso: () => '2025-07-01T00:00:00.000Z',
    }),
  };
}

describe('demo seed state', () => {
  it('builds a schema-valid demo archive covering every genre', () => {
    const seed = createDemoSeedPersistedStore();

    // Round-trips through the strict persistence codec without changes.
    expect(decodePersistedV2(encodePersistedV2(seed))).toEqual(seed);

    expect(seed.stars).toHaveLength(15);
    expect(new Set(seed.stars.map(({ genre }) => genre))).toEqual(new Set(GENRES));
    expect(seed.blackholeArchive).toHaveLength(2);
    expect(seed.constellations).toHaveLength(1);

    // Constellation references seeded active stars only.
    const activeIds = new Set(seed.stars.map(({ id }) => id));
    for (const starId of seed.constellations[0]!.starIds) {
      expect(activeIds.has(starId)).toBe(true);
    }

    // Positions land inside the shared star-field ellipsoid.
    for (const star of seed.stars) {
      const normalized = Math.hypot(
        (star.position.x - STAR_FIELD_CENTER.x) / STAR_FIELD_RADII.x,
        (star.position.y - STAR_FIELD_CENTER.y) / STAR_FIELD_RADII.y,
        (star.position.z - STAR_FIELD_CENTER.z) / STAR_FIELD_RADII.z,
      );
      expect(normalized).toBeLessThanOrEqual(1 + 1e-9);
    }

    // Milestones stay locked below fifty works; Nolan progress matches seeds.
    expect(seed.milestoneUnlocks.fifty.unlocked).toBe(false);
    expect(seed.achievements.find(({ ruleId }) => ruleId === 'nolan-unique-work')!.progress)
      .toBe(2);
  });

  it('seeds only a genuine first run and opens the registration gate', async () => {
    const { service } = createService();
    expect(seedDemoArchiveIfFirstRun(service)).toBe(true);

    const loaded = await bootstrapPersistedState(service);
    expect(loaded.hasPersistedRegistration).toBe(true);
    expect(loaded.state.stars).toHaveLength(15);

    // A second call never reseeds or overwrites.
    expect(seedDemoArchiveIfFirstRun(service)).toBe(false);

    // An existing (non-demo) archive is left untouched.
    const existing = createService(
      new FakeLocalStorageAdapter({
        initial: {
          'space-movie-archive:v2': encodePersistedV2(createDemoSeedPersistedStore()),
        },
      }),
    );
    expect(seedDemoArchiveIfFirstRun(existing.service)).toBe(false);
  });
});
