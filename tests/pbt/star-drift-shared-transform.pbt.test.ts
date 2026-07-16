// Feature: natural-star-drift-and-camera-return, Property 3: 식별자 기반 결정성
// Feature: natural-star-drift-and-camera-return, Property 4: 렌더러 간 통일된 표류
// Feature: natural-star-drift-and-camera-return, Property 5: 모션 축소 시 기준 위치 고정
// Feature: natural-star-drift-and-camera-return, Property 6: 자전 각속도 보존
// Feature: natural-star-drift-and-camera-return, Property 7: 별자리 선 끝점과 렌더링 위치 일치
// **Validates: Requirements 1.4, 1.6, 1.7, 1.8, 1.9, 2.1, 2.3**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Rating, Star } from '../../src/domain/models';
import { sampleConstellationLinePoints } from '../../src/scene/constellationRendererModel';
import {
  getStarInstancePhase,
  sampleStarInstanceTransform,
} from '../../src/scene/starRendererModel';
import {
  sampleStarDriftOffset,
  sampleStarRenderTransform,
} from '../../src/scene/starVisualModel';

function starFrom(id: string, position: Star['position'], rating: Rating = 3): Star {
  return {
    id,
    title: `Title ${id}`,
    normalizedTitle: `title ${id}`,
    genre: 'SF',
    rating,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

const idArbitrary = fc.string({ minLength: 1, maxLength: 24 });
const positionArbitrary = fc.record({
  x: fc.double({ min: -100, max: 100, noNaN: true }),
  y: fc.double({ min: -100, max: 100, noNaN: true }),
  z: fc.double({ min: -100, max: 100, noNaN: true }),
});
const elapsedArbitrary = fc.double({ min: 0, max: 86_400, noNaN: true });

describe('Property 3: identity-based determinism', () => {
  it('R1.4 R1.8 gives identical offsets for identical inputs and distinct seeds for distinct ids', () => {
    fc.assert(
      fc.property(idArbitrary, idArbitrary, elapsedArbitrary, (idA, idB, elapsed) => {
        const seedA = getStarInstancePhase(idA);
        const first = sampleStarDriftOffset(elapsed, seedA);
        const second = sampleStarDriftOffset(elapsed, seedA);
        expect(second).toEqual(first);
        if (idA !== idB) {
          expect(getStarInstancePhase(idB)).not.toBe(seedA);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: unified drift across renderers', () => {
  it('R1.6 makes the individual and instanced transforms identical for the same inputs', () => {
    fc.assert(
      fc.property(
        idArbitrary,
        positionArbitrary,
        elapsedArbitrary,
        fc.boolean(),
        (id, position, elapsed, hovered) => {
          const star = starFrom(id, position);
          const seed = getStarInstancePhase(id);
          const individual = sampleStarRenderTransform(star, elapsed, seed, hovered, false);
          const instanced = sampleStarInstanceTransform(star, elapsed, seed, hovered, false);
          expect(instanced).toEqual(individual);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 5: reduced motion pins to Base_Position', () => {
  it('R1.7 returns exactly the base position with zero rotation under reduced motion', () => {
    fc.assert(
      fc.property(
        idArbitrary,
        positionArbitrary,
        elapsedArbitrary,
        (id, position, elapsed) => {
          const star = starFrom(id, position);
          const transform = sampleStarRenderTransform(
            star,
            elapsed,
            getStarInstancePhase(id),
            false,
            true,
          );
          expect(transform.position).toEqual(position);
          expect(transform.rotationY).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 6: rotation angular velocity preserved', () => {
  it('R1.9 keeps rotationY equal to elapsed × (π/6) while moving', () => {
    fc.assert(
      fc.property(idArbitrary, positionArbitrary, elapsedArbitrary, (id, position, elapsed) => {
        const star = starFrom(id, position);
        const transform = sampleStarRenderTransform(
          star,
          elapsed,
          getStarInstancePhase(id),
          false,
          false,
        );
        expect(transform.rotationY).toBe(elapsed * (Math.PI / 6));
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 7: constellation endpoints match rendered positions', () => {
  it('R2.1 R2.3 places each line endpoint exactly at its star\'s rendered position', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(idArbitrary, positionArbitrary), { minLength: 1, maxLength: 8 }),
        elapsedArbitrary,
        (entries, elapsed) => {
          const stars = entries.map(([id, position], index) =>
            starFrom(`${id}-${index}`, position),
          );
          const points = sampleConstellationLinePoints(stars, elapsed, false);
          stars.forEach((star, index) => {
            // The strongest form of the invariant: endpoints equal the exact
            // rendered star position (drift + gravitational lean included).
            const rendered = sampleStarRenderTransform(
              star,
              elapsed,
              getStarInstancePhase(star.id),
              false,
              false,
            ).position;
            expect(points[index]).toEqual([rendered.x, rendered.y, rendered.z]);
          });

          const reduced = sampleConstellationLinePoints(stars, elapsed, true);
          stars.forEach((star, index) => {
            expect(reduced[index]).toEqual([
              star.position.x,
              star.position.y,
              star.position.z,
            ]);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
