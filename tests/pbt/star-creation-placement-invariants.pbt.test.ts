import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createDefaultStore,
  MINIMUM_GALAXY_CENTER_DISTANCE,
} from '../../src/domain/defaultState';
import { GENRES, type Vec3 } from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import { PersistenceService } from '../../src/persistence/persistenceService';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

const CREATED_AT = '2032-03-04T05:06:07.000Z';
const STAR_FIELDS = [
  'createdAt',
  'director',
  'genre',
  'id',
  'normalizedDirector',
  'normalizedTitle',
  'position',
  'rating',
  'review',
  'title',
  'watchedDate',
] as const;

const validInputArbitrary = fc.record({
  title: fc.string({ maxLength: 180 }).map((value) => `  Title ${value}  `),
  rating: fc.constantFrom(1, 2, 3, 4, 5),
  review: fc.string({ maxLength: 100 }),
  watchedDate: fc.integer({ min: 0, max: 36_524 }).map((dayOffset) =>
    new Date(Date.UTC(2000, 0, 1 + dayOffset)).toISOString().slice(0, 10),
  ),
  director: fc.string({ maxLength: 175 }).map((value) => `  Director ${value}  `),
});

const placementRadiusArbitrary = fc.oneof(
  fc.constantFrom(0.01, 9.99, 10, 10.01, 30),
  fc.integer({ min: 1, max: 3_000 }).map((value) => value / 100),
);

const placementCaseArbitrary = fc.record({
  input: validInputArbitrary,
  placementRadius: placementRadiusArbitrary,
  seed: fc.integer(),
});

function seededUuid(seed: number, genreIndex: number): string {
  const prefix = (seed >>> 0).toString(16).padStart(8, '0');
  const suffix = (genreIndex + 1).toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${suffix}`;
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

// Feature: space-movie-archive, Property 3: Star 생성 및 배치 불변식
// **Validates: Requirements 2.9, 2.10, 3.11, 3.12**
describe('Property 3: Star creation and placement invariants', () => {
  it('R2.9 R2.10 R3.11 R3.12 creates complete stars inside every genre galaxy and preserves galaxy-center separation', () => {
    fc.assert(
      fc.property(placementCaseArbitrary, ({ input, placementRadius, seed }) => {
        const initialState = createDefaultStore(true);
        initialState.persisted.galaxies.forEach((galaxy) => {
          if (galaxy.kind.type === 'genre') galaxy.placementRadius = placementRadius;
        });

        let genreIndex = 0;
        const persistence = new PersistenceService({
          storage: new FakeLocalStorageAdapter(),
          scheduler: new FakeClock(),
          nowIso: () => CREATED_AT,
        });
        const store = createArchiveStore({
          persistence,
          initialState,
          providers: {
            nextUuid: () => seededUuid(seed, genreIndex++),
            nowIso: () => CREATED_AT,
          },
        });

        try {
          for (const [index, genre] of GENRES.entries()) {
            const starId = seededUuid(seed, index);
            const result = store.getState().commands.addWork({ ...input, genre });
            expect(result).toMatchObject({ ok: true, value: { starId } });

            const star = store.getState().persisted.stars.at(-1);
            const galaxy = store.getState().persisted.galaxies.find(
              (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === genre,
            );
            expect(star).toBeDefined();
            expect(galaxy).toBeDefined();
            if (star === undefined || galaxy === undefined) throw new Error('Missing generated star or genre galaxy');

            expect(Object.keys(star).sort()).toEqual([...STAR_FIELDS]);
            expect(star).toMatchObject({
              id: starId,
              title: normalizeDisplayText(input.title),
              normalizedTitle: normalizeText(input.title),
              genre,
              rating: input.rating,
              review: input.review,
              watchedDate: input.watchedDate,
              director: normalizeDisplayText(input.director),
              normalizedDirector: normalizeText(input.director),
              createdAt: CREATED_AT,
            });
            expect(star.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            expect(new Date(star.createdAt).toISOString()).toBe(star.createdAt);
            expect(Object.values(star.position).every(Number.isFinite)).toBe(true);

            const maximumDistance = Math.min(galaxy.placementRadius, 10);
            expect(distance(star.position, galaxy.center)).toBeLessThanOrEqual(maximumDistance + 1e-10);
          }

          const genreGalaxies = store.getState().persisted.galaxies.filter(
            (galaxy) => galaxy.kind.type === 'genre',
          );
          expect(genreGalaxies).toHaveLength(GENRES.length);
          for (let leftIndex = 0; leftIndex < genreGalaxies.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < genreGalaxies.length; rightIndex += 1) {
              const left = genreGalaxies[leftIndex];
              const right = genreGalaxies[rightIndex];
              if (left === undefined || right === undefined) throw new Error('Missing genre galaxy');
              expect(distance(left.center, right.center)).toBeGreaterThanOrEqual(
                MINIMUM_GALAXY_CENTER_DISTANCE,
              );
            }
          }
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
