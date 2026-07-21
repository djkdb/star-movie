import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import { GENRES, type Vec3 } from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import { PersistenceService } from '../../src/persistence/persistenceService';
import { createArchiveStore } from '../../src/store/archiveStore';
import { STAR_FIELD_RADIUS } from '../../src/store/deterministicPlacement';
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

const placementCaseArbitrary = fc.record({
  input: validInputArbitrary,
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

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

// Feature: space-movie-archive, Property 3: Star 생성 및 배치 불변식
// **Validates: Requirements 2.9, 2.10, 3.11, 3.12**
describe('Property 3: Star creation and placement invariants', () => {
  it('R2.9 R2.10 R3.11 R3.12 creates complete stars scattered deterministically across the whole field', () => {
    fc.assert(
      fc.property(placementCaseArbitrary, ({ input, seed }) => {
        const initialState = createDefaultStore(true);

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
          const positions: Vec3[] = [];
          for (const [index, genre] of GENRES.entries()) {
            const starId = seededUuid(seed, index);
            const result = store.getState().commands.addWork({ ...input, genre });
            expect(result).toMatchObject({ ok: true, value: { starId } });

            const star = store.getState().persisted.stars.at(-1);
            expect(star).toBeDefined();
            if (star === undefined) throw new Error('Missing generated star');

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

            // Every star lands inside the shared field sphere, no longer tied to
            // a genre region — position is deterministic from the star id.
            expect(distance(star.position, ORIGIN)).toBeLessThanOrEqual(
              STAR_FIELD_RADIUS + 1e-9,
            );
            positions.push(star.position);
          }

          // Distinct ids scatter to distinct points (no genre clustering).
          const uniquePoints = new Set(
            positions.map(({ x, y, z }) => `${x},${y},${z}`),
          );
          expect(uniquePoints.size).toBe(positions.length);
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
