// Feature: space-movie-archive, Property 13: Constellation draft의 순서·유일성·경계
// **Validates: Requirements 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.14**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import type { Star, Store } from '../../src/domain/models';
import { normalizeDisplayText } from '../../src/domain/normalization';
import {
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
  type StorageAdapter,
} from '../../src/persistence/persistenceService';
import {
  MAX_CONSTELLATION_STARS,
  MAX_CONSTELLATION_NAME_LENGTH,
} from '../../src/store/constellation';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

const NOW = '2025-04-05T06:07:08.000Z';
const STAR_COUNT = MAX_CONSTELLATION_STARS + 1;

function uuid(index: number): string {
  return `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createStar(state: Store, index: number): Star {
  const galaxy = state.persisted.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === 'SF',
  );
  if (galaxy === undefined) throw new Error('Missing SF galaxy');
  return {
    id: uuid(index + 1),
    title: `Work ${index + 1}`,
    normalizedTitle: `work ${index + 1}`,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-04-01',
    director: `Director ${index + 1}`,
    normalizedDirector: `director ${index + 1}`,
    position: { ...galaxy.center },
    createdAt: NOW,
  };
}

function stateWithStars(): Store {
  const state = createDefaultStore(true);
  state.persisted.stars = Array.from({ length: STAR_COUNT }, (_, index) =>
    createStar(state, index),
  );
  return state;
}

const nameCharacterArbitrary = fc.constantFrom('a', 'Z', '0', '가', '별', '-');
const validNameArbitrary = fc
  .array(nameCharacterArbitrary, {
    minLength: 1,
    maxLength: MAX_CONSTELLATION_NAME_LENGTH,
  })
  .map((characters) => `  ${characters.join('')}  `);
const invalidNameArbitrary = fc.oneof(
  fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t\n '),
  fc
    .array(nameCharacterArbitrary, {
      minLength: MAX_CONSTELLATION_NAME_LENGTH + 1,
      maxLength: MAX_CONSTELLATION_NAME_LENGTH + 20,
    })
    .map((characters) => ` ${characters.join('')} `),
);

const propertyInputArbitrary = fc.record({
  arbitraryClicks: fc.array(fc.integer({ min: 0, max: STAR_COUNT - 1 }), {
    maxLength: STAR_COUNT * 2,
  }),
  completionOrder: fc.shuffledSubarray(
    Array.from({ length: STAR_COUNT }, (_, index) => index),
    { minLength: STAR_COUNT, maxLength: STAR_COUNT },
  ),
  validName: validNameArbitrary,
  invalidName: invalidNameArbitrary,
});

describe('Property 13: constellation draft order, uniqueness, and boundaries', () => {
  it('R9.1 R9.3-R9.9 R9.14 preserves the ordered unique draft across duplicate, overflow, invalid-name, and invalid-count operations', () => {
    fc.assert(
      fc.property(propertyInputArbitrary, ({
        arbitraryClicks,
        completionOrder,
        validName,
        invalidName,
      }) => {
        const backingStorage = new FakeLocalStorageAdapter();
        let storageWrites = 0;
        const storage: StorageAdapter = {
          getItem: (key) => backingStorage.getItem(key),
          setItem: (key, value) => {
            storageWrites += 1;
            backingStorage.setItem(key, value);
          },
        };
        const persistence = new PersistenceService({
          storage,
          scheduler: new FakeClock(),
          nowIso: () => NOW,
        });
        const store = createArchiveStore({
          persistence,
          initialState: stateWithStars(),
          providers: {
            nextUuid: () => uuid(900),
            nowIso: () => NOW,
          },
        });

        try {
          const commands = store.getState().commands;
          const firstId = uuid(completionOrder[0]! + 1);
          expect(commands.startConstellationDraft(firstId).ok).toBe(true);

          const beforeGuaranteedDuplicate = structuredClone(
            store.getState().runtime.constellationDraft,
          );
          expect(commands.selectConstellationStar(firstId).ok).toBe(true);
          expect(store.getState().runtime.constellationDraft).toEqual(
            beforeGuaranteedDuplicate,
          );

          const expectedIds = [firstId];
          const expectedSet = new Set(expectedIds);
          const clicks = [
            ...arbitraryClicks,
            ...completionOrder.filter(
              (index) => !new Set(arbitraryClicks).has(index),
            ),
          ];
          let observedOverflow = false;

          for (const index of clicks) {
            const starId = uuid(index + 1);
            const beforeIds = [...expectedIds];
            const duplicate = expectedSet.has(starId);
            const result = commands.selectConstellationStar(starId);

            if (duplicate) {
              expect(result.ok).toBe(true);
            } else if (expectedIds.length < MAX_CONSTELLATION_STARS) {
              expectedIds.push(starId);
              expectedSet.add(starId);
              expect(result.ok).toBe(true);
            } else {
              observedOverflow = true;
              expect(result).toMatchObject({
                ok: false,
                error: { code: 'VALIDATION' },
              });
              expect(store.getState().runtime.constellationDraft.starIds).toEqual(
                beforeIds,
              );
              expect(store.getState().runtime.constellationDraft.phase).toBe(
                'selecting',
              );
            }

            expect(store.getState().runtime.constellationDraft.starIds).toEqual(
              expectedIds,
            );
          }

          expect(observedOverflow).toBe(true);
          expect(expectedIds).toHaveLength(MAX_CONSTELLATION_STARS);
          expect(new Set(expectedIds).size).toBe(MAX_CONSTELLATION_STARS);
          expect(commands.finishConstellationDraft().ok).toBe(true);
          expect(store.getState().runtime.constellationDraft.phase).toBe('naming');

          const beforeInvalidName = structuredClone(
            store.getState().runtime.constellationDraft,
          );
          const persistedBeforeInvalidName = structuredClone(
            store.getState().persisted,
          );
          expect(commands.createConstellation(invalidName)).toMatchObject({
            ok: false,
            error: { code: 'VALIDATION' },
          });
          expect(store.getState().runtime.constellationDraft).toMatchObject({
            active: beforeInvalidName.active,
            phase: beforeInvalidName.phase,
            starIds: beforeInvalidName.starIds,
          });
          expect(store.getState().persisted).toEqual(persistedBeforeInvalidName);
          expect(backingStorage.getItem(PERSISTENCE_STORAGE_KEY)).toBeNull();
          expect(storageWrites).toBe(0);

          let commitNotifications = 0;
          const unsubscribe = store.subscribe(() => {
            commitNotifications += 1;
          });
          const creation = commands.createConstellation(validName);
          unsubscribe();

          expect(creation).toMatchObject({
            ok: true,
            value: { constellationId: uuid(900) },
          });
          expect(commitNotifications).toBe(1);
          expect(storageWrites).toBe(1);
          expect(store.getState().persisted.constellations).toHaveLength(1);
          expect(store.getState().persisted.constellations[0]).toMatchObject({
            id: uuid(900),
            name: normalizeDisplayText(validName),
            starIds: expectedIds,
          });

          const createdConstellations = structuredClone(
            store.getState().persisted.constellations,
          );
          expect(commands.startConstellationDraft(firstId).ok).toBe(true);
          const beforeInvalidCount = structuredClone(
            store.getState().runtime.constellationDraft,
          );
          expect(commands.finishConstellationDraft()).toMatchObject({
            ok: false,
            error: { code: 'VALIDATION' },
          });
          expect(store.getState().runtime.constellationDraft.starIds).toEqual(
            beforeInvalidCount.starIds,
          );
          expect(store.getState().persisted.constellations).toEqual(
            createdConstellations,
          );
          expect(storageWrites).toBe(1);
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
