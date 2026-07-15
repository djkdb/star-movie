// Feature: space-movie-archive, Property 15: 별자리 활성 참조와 순서 무결성
// **Validates: Requirements 10.1, 10.6, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultPersistedStore } from '../../src/domain/defaultState';
import type {
  Constellation,
  PersistedStateV2,
  Star,
} from '../../src/domain/models';
import { createConstellationLineViewModels } from '../../src/scene/constellationRendererModel';
import { selectActiveConstellations } from '../../src/store/selectors';
import {
  reduceHardDelete,
  reduceRestoreArchived,
  reduceSoftDelete,
} from '../../src/store/workCollectionReducers';

const ID_COUNT = 12;
const DISCARDED_AT = '2025-06-01T00:00:00.000Z';

type OperationOrder =
  | readonly ['hardDelete', 'softDelete', 'restore']
  | readonly ['softDelete', 'hardDelete', 'restore']
  | readonly ['softDelete', 'restore', 'hardDelete'];

interface Scenario {
  activeIndexes: number[];
  primaryPriorities: number[];
  additionalReferenceIndexes: number[][];
  hardTargetSelector: number;
  softTargetSelector: number;
  operationOrder: OperationOrder;
}

const operationOrderArbitrary = fc.constantFrom<OperationOrder>(
  ['hardDelete', 'softDelete', 'restore'],
  ['softDelete', 'hardDelete', 'restore'],
  ['softDelete', 'restore', 'hardDelete'],
);

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  activeIndexes: fc.uniqueArray(fc.integer({ min: 0, max: ID_COUNT - 1 }), {
    minLength: 2,
    maxLength: ID_COUNT,
  }),
  primaryPriorities: fc.array(fc.integer({ min: -100, max: 100 }), {
    minLength: ID_COUNT,
    maxLength: ID_COUNT,
  }),
  additionalReferenceIndexes: fc.array(
    fc.uniqueArray(fc.integer({ min: 0, max: ID_COUNT - 1 }), {
      minLength: 2,
      maxLength: ID_COUNT,
    }),
    { maxLength: 5 },
  ),
  hardTargetSelector: fc.nat(),
  softTargetSelector: fc.nat(),
  operationOrder: operationOrderArbitrary,
});

function makeUuid(namespace: number, index: number): string {
  return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`;
}

function createStar(id: string, index: number): Star {
  return {
    id,
    title: `Work ${index + 1}`,
    normalizedTitle: `work ${index + 1}`,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: `Director ${index + 1}`,
    normalizedDirector: `director ${index + 1}`,
    position: { x: -45 + index / 10, y: index / 20, z: -45 },
    createdAt: `2025-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function createConstellation(
  index: number,
  starIds: string[],
): Constellation {
  return {
    id: makeUuid(0x15000001, index + 1),
    name: `Constellation ${index + 1}`,
    starIds,
    color: `#${(index + 1).toString(16).padStart(6, '0')}`,
    createdAt: `2025-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function selectDistinctTargets(
  activeIds: readonly string[],
  hardSelector: number,
  softSelector: number,
): { hardTargetId: string; softTargetId: string } {
  const hardTargetIndex = hardSelector % activeIds.length;
  const softOffset = 1 + (softSelector % (activeIds.length - 1));
  const softTargetIndex = (hardTargetIndex + softOffset) % activeIds.length;
  return {
    hardTargetId: activeIds[hardTargetIndex]!,
    softTargetId: activeIds[softTargetIndex]!,
  };
}

function createScenarioState(scenario: Scenario): {
  state: PersistedStateV2;
  hardTargetId: string;
  softTargetId: string;
} {
  const ids = Array.from({ length: ID_COUNT }, (_, index) =>
    makeUuid(0x15000000, index + 1),
  );
  const activeIndexSet = new Set(scenario.activeIndexes);
  const activeIds = ids.filter((_id, index) => activeIndexSet.has(index));
  const { hardTargetId, softTargetId } = selectDistinctTargets(
    activeIds,
    scenario.hardTargetSelector,
    scenario.softTargetSelector,
  );
  const primaryStarIds = ids
    .map((id, index) => ({ id, index, priority: scenario.primaryPriorities[index]! }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ id }) => id);
  const constellations = [
    createConstellation(0, primaryStarIds),
    ...scenario.additionalReferenceIndexes.map((indexes, index) =>
      createConstellation(index + 1, indexes.map((idIndex) => ids[idIndex]!)),
    ),
  ];
  const state = createDefaultPersistedStore();
  state.stars = scenario.activeIndexes.map((index) => createStar(ids[index]!, index));
  state.constellations = constellations;
  return { state, hardTargetId, softTargetId };
}

function assertReferenceViews(
  state: PersistedStateV2,
  expectedReferences: ReadonlyMap<string, readonly string[]>,
): void {
  const activeIds = new Set(state.stars.map(({ id }) => id));
  const lines = createConstellationLineViewModels(state.constellations, state.stars);
  const listItems = selectActiveConstellations(state.constellations, state.stars);

  expect(lines.map(({ id }) => id)).toEqual(listItems.map(({ id }) => id));

  for (const constellation of state.constellations) {
    const storedReferences = expectedReferences.get(constellation.id);
    if (storedReferences === undefined) {
      throw new Error(`Missing reference model for ${constellation.id}`);
    }
    expect(constellation.starIds).toEqual(storedReferences);

    const expectedActiveReferences = storedReferences.filter((id) => activeIds.has(id));
    const line = lines.find(({ id }) => id === constellation.id);
    const listItem = listItems.find(({ id }) => id === constellation.id);

    if (expectedActiveReferences.length < 2) {
      expect(line).toBeUndefined();
      expect(listItem).toBeUndefined();
    } else {
      expect(line?.activeStarIds).toEqual(expectedActiveReferences);
      expect(listItem?.activeStarIds).toEqual(expectedActiveReferences);
      expect(listItem?.activeStarCount).toBe(expectedActiveReferences.length);
    }
  }
}

describe('Property 15: 별자리 활성 참조와 순서 무결성', () => {
  it('R10.1 R10.6 R10.9 R10.10 R10.11 R10.12 R10.13 R10.14 preserves active intersections, two-reference gates, references, and relative order through delete and restore sequences', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const initial = createScenarioState(scenario);
        let state = initial.state;
        const expectedReferences = new Map(
          state.constellations.map(({ id, starIds }) => [id, [...starIds]] as const),
        );

        assertReferenceViews(state, expectedReferences);

        for (const operation of scenario.operationOrder) {
          if (operation === 'hardDelete') {
            state = reduceHardDelete(state, initial.hardTargetId).candidate;
            for (const [constellationId, references] of expectedReferences) {
              expectedReferences.set(
                constellationId,
                references.filter((id) => id !== initial.hardTargetId),
              );
            }
            expect(
              state.constellations.every(
                ({ starIds }) => !starIds.includes(initial.hardTargetId),
              ),
            ).toBe(true);
          } else if (operation === 'softDelete') {
            state = reduceSoftDelete(
              state,
              initial.softTargetId,
              DISCARDED_AT,
            ).candidate;
            for (const [constellationId, references] of expectedReferences) {
              expectedReferences.set(
                constellationId,
                references.filter((id) => id !== initial.softTargetId),
              );
            }
            expect(
              state.constellations.every(
                ({ starIds }) => !starIds.includes(initial.softTargetId),
              ),
            ).toBe(true);
          } else {
            const referencesBeforeRestore = state.constellations.map(({ starIds }) => [
              ...starIds,
            ]);
            state = reduceRestoreArchived(state, initial.softTargetId).candidate;
            expect(state.constellations.map(({ starIds }) => starIds)).toEqual(
              referencesBeforeRestore,
            );
            expect(
              state.constellations.every(
                ({ starIds }) => !starIds.includes(initial.softTargetId),
              ),
            ).toBe(true);
          }

          assertReferenceViews(state, expectedReferences);
        }
      }),
      { numRuns: 100 },
    );
  });
});
