import { describe, expect, it } from 'vitest';

import { createSeedAchievements } from './achievementCatalog';
import { GENRES, type Star } from './models';
import {
  MINIMUM_GALAXY_CENTER_DISTANCE,
  createDefaultPersistedStore,
  createDefaultStore,
  selectSceneArchiveContent,
} from './defaultState';

function centerDistance(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

describe('deterministic default store', () => {
  it('R8.2-R8.8 creates fresh empty collections and the schemaVersion 2 defaults', () => {
    const first = createDefaultPersistedStore();
    const second = createDefaultPersistedStore();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.schemaVersion).toBe(2);
    expect(first.stars).toEqual([]);
    expect(first.constellations).toEqual([]);
    expect(first.blackholeArchive).toEqual([]);
    expect(first.milestoneUnlocks).toEqual({
      fifty: { target: 50, unlocked: false, unlockedAt: null, rewardId: null },
      hundred: { target: 100, unlocked: false, unlockedAt: null, rewardId: null },
    });
    expect(first.achievements).toEqual(createSeedAchievements());
    expect(first.achievements).toHaveLength(6);
    expect(first.achievements.every((a) => !a.unlocked && a.progress === 0)).toBe(true);
    expect(first.achievements.map((a) => a.ruleId)).toContain('director-master');
  });

  it('R3.12 creates exactly one themed galaxy per Genre with center distances of at least 25', () => {
    const galaxies = createDefaultPersistedStore().galaxies;
    const galaxyGenres = galaxies.map((galaxy) =>
      galaxy.kind.type === 'genre' ? galaxy.kind.genre : null,
    );

    expect(galaxies).toHaveLength(8);
    expect(new Set(galaxyGenres)).toEqual(new Set(GENRES));
    expect(galaxies.every((galaxy) => galaxy.unlocked && galaxy.placementRadius > 0)).toBe(true);

    for (let leftIndex = 0; leftIndex < galaxies.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < galaxies.length; rightIndex += 1) {
        const left = galaxies[leftIndex];
        const right = galaxies[rightIndex];
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        if (left !== undefined && right !== undefined) {
          expect(centerDistance(left.center, right.center)).toBeGreaterThanOrEqual(
            MINIMUM_GALAXY_CENTER_DISTANCE,
          );
        }
      }
    }
  });

  it('R1.9 gates registered content on first run while retaining default galaxies', () => {
    const store = createDefaultStore();
    const fixtureStar = { id: 'fixture-star' } as Star;
    store.persisted.stars.push(fixtureStar);
    store.persisted.constellations.push({
      id: 'fixture-constellation',
      name: 'fixture',
      starIds: ['fixture-star', 'other-star'],
      color: '#ffffff',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    expect(store.persisted.galaxies).toHaveLength(8);
    expect(selectSceneArchiveContent(store)).toEqual({ stars: [], constellations: [] });

    store.runtime.hasPersistedRegistration = true;
    expect(selectSceneArchiveContent(store)).toEqual({
      stars: [fixtureStar],
      constellations: store.persisted.constellations,
    });
  });
});
