// Feature: space-movie-archive, Property 20: Selective Bloom 대상 집합
// **Validates: Requirements 13.6, 13.9**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Constellation, Star } from '../../src/domain/models';
import { createSelectiveBloomViewModel } from '../../src/scene/selectiveBloom';

const STAR_ID_POOL_SIZE = 80;
const REFERENCE_ID_POOL_SIZE = 120;

interface SceneScenario {
  activeStarIndexes: number[];
  constellationReferenceIndexes: number[][];
  nonTargetIndexes: number[];
}

const scenarioArbitrary: fc.Arbitrary<SceneScenario> = fc.record({
  activeStarIndexes: fc.uniqueArray(
    fc.integer({ min: 0, max: STAR_ID_POOL_SIZE - 1 }),
    { maxLength: STAR_ID_POOL_SIZE },
  ),
  constellationReferenceIndexes: fc.array(
    fc.uniqueArray(
      fc.integer({ min: 0, max: REFERENCE_ID_POOL_SIZE - 1 }),
      { maxLength: 20 },
    ),
    { maxLength: 30 },
  ),
  nonTargetIndexes: fc.uniqueArray(fc.nat({ max: 100 }), { maxLength: 20 }),
});

function starId(index: number): string {
  return `scene-object-${index}`;
}

function createStar(index: number): Star {
  const id = starId(index);
  return {
    id,
    title: `Work ${index}`,
    normalizedTitle: `work ${index}`,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: index, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function createConstellation(index: number, referenceIndexes: number[]): Constellation {
  return {
    id: `constellation-${index}`,
    name: `Constellation ${index}`,
    starIds: referenceIndexes.map(starId),
    color: '#ffffff',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function createNonTargetKeys(indexes: readonly number[]): Set<string> {
  const nonTargetKinds = [
    'background-star',
    'galaxy',
    'blackhole',
    'milestone-reward',
    'particle',
  ] as const;

  return new Set(
    indexes.flatMap((index) =>
      nonTargetKinds.map((kind) => `${kind}:scene-object-${index}`),
    ),
  );
}

describe('Property 20: Selective Bloom 대상 집합', () => {
  it('R13.6 R13.9 selects exactly the union of all Stars and active Constellation lines, leaks no non-targets, and disables an empty selection', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const stars = scenario.activeStarIndexes.map(createStar);
        const activeStarIds = new Set(stars.map(({ id }) => id));
        const constellations = scenario.constellationReferenceIndexes.map(
          (referenceIndexes, index) =>
            createConstellation(index, referenceIndexes),
        );
        const activeConstellationIds = constellations
          .filter(
            ({ starIds }) =>
              starIds.filter((id) => activeStarIds.has(id)).length >= 2,
          )
          .map(({ id }) => id);
        const expectedTargets = new Set<string>([
          ...stars.map(({ id }) => `star:${id}`),
          ...activeConstellationIds.map((id) => `constellation:${id}`),
        ]);
        const nonTargetKeys = createNonTargetKeys(scenario.nonTargetIndexes);

        const model = createSelectiveBloomViewModel(stars, constellations);
        const actualTargets = new Set<string>(model.targetKeys);

        expect(actualTargets).toEqual(expectedTargets);
        expect(model.targetKeys).toHaveLength(expectedTargets.size);
        expect(model.targetKeys.every((key) => !nonTargetKeys.has(key))).toBe(true);
        expect(model.enabled).toBe(expectedTargets.size > 0);

        if (expectedTargets.size === 0) {
          expect(model.targetKeys).toEqual([]);
          expect(model.enabled).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
