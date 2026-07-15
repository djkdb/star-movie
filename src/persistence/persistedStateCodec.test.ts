import { describe, expect, it, vi } from 'vitest';

import { createDefaultPersistedStore } from '../domain/defaultState';
import type { PersistedStateV2, Star } from '../domain/models';
import { decodePersistedV2, encodePersistedV2, safeDecodePersistedV2 } from './persistedStateCodec';

const STAR_ONE_ID = '10000000-0000-4000-8000-000000000001';
const STAR_TWO_ID = '10000000-0000-4000-8000-000000000002';
const CONSTELLATION_ID = '20000000-0000-4000-8000-000000000001';

function createStar(id: string, title: string): Star {
  return {
    id,
    title,
    normalizedTitle: title.toLocaleLowerCase('und'),
    genre: 'SF',
    rating: 5,
    review: '',
    watchedDate: '2024-02-29',
    director: 'Christopher Nolan',
    normalizedDirector: 'christopher nolan',
    position: { x: -45, y: 0, z: -45 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function createValidDocument(): PersistedStateV2 {
  const state = createDefaultPersistedStore();
  state.stars = [createStar(STAR_ONE_ID, 'Interstellar'), createStar(STAR_TWO_ID, 'Inception')];
  state.constellations = [
    {
      id: CONSTELLATION_ID,
      name: 'Nolan Space',
      starIds: [STAR_TWO_ID, STAR_ONE_ID],
      color: '#abcdef',
      createdAt: '2025-01-02T00:00:00.000Z',
    },
  ];
  return state;
}

function archiveStar(star: Star, discardedAt = '2025-02-01T00:00:00.000Z') {
  return { ...structuredClone(star), discardedAt };
}

describe('schemaVersion 2 persisted-state codec', () => {
  it('R8.1-R8.9 encodes and decodes all required fields without changing collection order', () => {
    const state = createValidDocument();
    const decoded = decodePersistedV2(encodePersistedV2(state));

    expect(decoded).toEqual(state);
    expect(decoded.stars.map(({ id }) => id)).toEqual([STAR_ONE_ID, STAR_TWO_ID]);
    expect(decoded.constellations[0]?.starIds).toEqual([STAR_TWO_ID, STAR_ONE_ID]);
  });

  it.each(['2024-02-29', '2000-02-29', '2025-01-31'])(
    'R8.2 accepts the real calendar date %s',
    (watchedDate) => {
      const document = createValidDocument();
      document.stars[0]!.watchedDate = watchedDate;

      expect(safeDecodePersistedV2(document).success).toBe(true);
    },
  );

  it.each(['2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-10', '2024-1-01'])(
    'R8.2 rejects the invalid or malformed calendar date %s',
    (watchedDate) => {
      const document = createValidDocument();
      document.stars[0]!.watchedDate = watchedDate;

      expect(safeDecodePersistedV2(document).success).toBe(false);
    },
  );

  it('R8.2-R8.4 rejects malformed UUIDs and ISO timestamps in persisted entities', () => {
    const invalidStarUuid = createValidDocument();
    invalidStarUuid.stars[0]!.id = 'not-a-uuid';
    expect(safeDecodePersistedV2(invalidStarUuid).success).toBe(false);

    const invalidReferenceUuid = createValidDocument();
    invalidReferenceUuid.constellations[0]!.starIds[0] = 'not-a-uuid';
    expect(safeDecodePersistedV2(invalidReferenceUuid).success).toBe(false);

    const invalidCreatedAt = createValidDocument();
    invalidCreatedAt.stars[0]!.createdAt = '2025-01-01';
    expect(safeDecodePersistedV2(invalidCreatedAt).success).toBe(false);

    const invalidDiscardedAt = createValidDocument();
    const moved = invalidDiscardedAt.stars.pop()!;
    invalidDiscardedAt.blackholeArchive.push(archiveStar(moved, 'yesterday'));
    expect(safeDecodePersistedV2(invalidDiscardedAt).success).toBe(false);
  });

  it('R8.2 rejects broken normalized linkage and non-finite coordinates', () => {
    const invalidNormalizedTitle = createValidDocument();
    invalidNormalizedTitle.stars[0]!.normalizedTitle = 'not-the-title';
    expect(safeDecodePersistedV2(invalidNormalizedTitle).success).toBe(false);

    const invalidPosition = createValidDocument();
    invalidPosition.stars[0]!.position = { x: Number.POSITIVE_INFINITY, y: 0, z: 0 };
    expect(safeDecodePersistedV2(invalidPosition).success).toBe(false);
  });

  it('R8.6-R8.9 accepts valid locked/unlocked null linkage and rejects every partial linkage', () => {
    const linked = createValidDocument();
    linked.milestoneUnlocks.fifty = {
      target: 50,
      unlocked: true,
      unlockedAt: '2025-01-01T00:00:00.000Z',
      rewardId: '30000000-0000-4000-8000-000000000001',
    };
    linked.achievements[0] = {
      ...linked.achievements[0]!,
      unlocked: true,
      unlockedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(safeDecodePersistedV2(linked).success).toBe(true);

    for (const milestone of [
      { target: 50 as const, unlocked: false, unlockedAt: '2025-01-01T00:00:00.000Z', rewardId: null },
      { target: 50 as const, unlocked: false, unlockedAt: null, rewardId: '30000000-0000-4000-8000-000000000001' },
      { target: 50 as const, unlocked: true, unlockedAt: null, rewardId: '30000000-0000-4000-8000-000000000001' },
      { target: 50 as const, unlocked: true, unlockedAt: '2025-01-01T00:00:00.000Z', rewardId: null },
    ]) {
      const invalid = createValidDocument();
      invalid.milestoneUnlocks.fifty = milestone;
      expect(safeDecodePersistedV2(invalid).success).toBe(false);
    }

    const lockedAchievementWithDate = createValidDocument();
    lockedAchievementWithDate.achievements[0]!.unlockedAt = '2025-01-01T00:00:00.000Z';
    expect(safeDecodePersistedV2(lockedAchievementWithDate).success).toBe(false);

    const unlockedAchievementWithoutDate = createValidDocument();
    unlockedAchievementWithoutDate.achievements[0]!.unlocked = true;
    expect(safeDecodePersistedV2(unlockedAchievementWithoutDate).success).toBe(false);
  });

  it('R8.5 accepts a center distance of exactly 25 and rejects any smaller distance', () => {
    const boundary = createValidDocument();
    boundary.galaxies[1]!.center = { x: -20, y: 0, z: -45 };
    expect(safeDecodePersistedV2(boundary).success).toBe(true);

    const tooClose = createValidDocument();
    tooClose.galaxies[1]!.center = { x: -20.001, y: 0, z: -45 };
    expect(safeDecodePersistedV2(tooClose).success).toBe(false);
  });

  it('R8.5 rejects missing Genre galaxies and Stars outside their placement distance', () => {
    const missingGenre = createValidDocument();
    missingGenre.galaxies.pop();
    expect(safeDecodePersistedV2(missingGenre).success).toBe(false);

    const misplacedStar = createValidDocument();
    misplacedStar.stars[0]!.position = { x: 100, y: 100, z: 100 };
    expect(safeDecodePersistedV2(misplacedStar).success).toBe(false);
  });

  it('R8.2-R8.9 rejects duplicate IDs in every persisted identity namespace', () => {
    const duplicateStar = createValidDocument();
    duplicateStar.stars[1]!.id = duplicateStar.stars[0]!.id;
    expect(safeDecodePersistedV2(duplicateStar).success).toBe(false);

    const duplicateArchive = createValidDocument();
    duplicateArchive.blackholeArchive = [
      archiveStar(createStar('10000000-0000-4000-8000-000000000003', 'Dunkirk')),
      archiveStar(createStar('10000000-0000-4000-8000-000000000003', 'Tenet')),
    ];
    expect(safeDecodePersistedV2(duplicateArchive).success).toBe(false);

    const duplicateConstellation = createValidDocument();
    duplicateConstellation.constellations.push(structuredClone(duplicateConstellation.constellations[0]!));
    expect(safeDecodePersistedV2(duplicateConstellation).success).toBe(false);

    const duplicateGalaxy = createValidDocument();
    duplicateGalaxy.galaxies[1]!.id = duplicateGalaxy.galaxies[0]!.id;
    expect(safeDecodePersistedV2(duplicateGalaxy).success).toBe(false);

    const duplicateAchievement = createValidDocument();
    duplicateAchievement.achievements.push(structuredClone(duplicateAchievement.achievements[0]!));
    expect(safeDecodePersistedV2(duplicateAchievement).success).toBe(false);

    const duplicateReward = createValidDocument();
    const rewardId = '30000000-0000-4000-8000-000000000001';
    duplicateReward.milestoneUnlocks.fifty = {
      target: 50,
      unlocked: true,
      unlockedAt: '2025-01-01T00:00:00.000Z',
      rewardId,
    };
    duplicateReward.milestoneUnlocks.hundred = {
      target: 100,
      unlocked: true,
      unlockedAt: '2025-01-01T00:00:00.000Z',
      rewardId,
    };
    duplicateReward.galaxies.push({
      id: rewardId,
      kind: { type: 'reward', rewardType: 'milestone-100' },
      center: { x: 0, y: 50, z: 0 },
      placementRadius: 18,
      themeId: 'milestone-100-reward',
      primaryColor: '#ffffff',
      unlocked: true,
    });
    expect(safeDecodePersistedV2(duplicateReward).success).toBe(false);
  });

  it('R8.13 rejects active/archive collection overlap and archived Constellation references', () => {
    const overlap = createValidDocument();
    overlap.blackholeArchive.push(archiveStar(overlap.stars[0]!));
    expect(safeDecodePersistedV2(overlap).success).toBe(false);

    const archivedReference = createValidDocument();
    const moved = archivedReference.stars.shift()!;
    archivedReference.blackholeArchive.push(archiveStar(moved));
    expect(safeDecodePersistedV2(archivedReference).success).toBe(false);
  });

  it('R8.17 rejects a canonical round-trip that corrupts collection order', () => {
    const state = createValidDocument();
    const originalParse = JSON.parse.bind(JSON) as typeof JSON.parse;
    const parseSpy = vi.spyOn(JSON, 'parse');
    parseSpy
      .mockImplementationOnce(originalParse)
      .mockImplementationOnce((text: string) => {
        const parsed = originalParse(text) as PersistedStateV2;
        parsed.stars.reverse();
        return parsed;
      });

    try {
      expect(() => decodePersistedV2(JSON.stringify(state))).toThrow(
        'Canonical encode/decode changed persisted fields or collection order',
      );
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('R8.17 rejects unknown fields instead of partially restoring the document', () => {
    const payload = JSON.parse(encodePersistedV2(createValidDocument())) as Record<string, unknown>;
    payload.unrecognized = true;

    expect(() => decodePersistedV2(JSON.stringify(payload))).toThrow();
  });
});
