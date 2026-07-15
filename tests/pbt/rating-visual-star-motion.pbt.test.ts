// Feature: space-movie-archive, Property 4: Rating 시각 매핑과 Star 운동
// **Validates: Requirements 3.1, 3.2, 3.3**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Rating } from '../../src/domain/models';
import {
  getRatingVisual,
  sampleStarMotion,
} from '../../src/scene/starVisualModel';

const EXPECTED_VISUALS: ReadonlyArray<
  readonly [rating: Rating, radius: number, bloom: number, color: string]
> = [
  [1, 0.4, 0.1, '#6a7290'],
  [2, 0.6, 0.25, '#9aa8d0'],
  [3, 0.85, 0.5, '#cfe0ff'],
  [4, 1.1, 0.75, '#ffe9b8'],
  [5, 1.4, 1, '#fff8e0'],
];

const visibleMotionInputArbitrary = fc.record({
  elapsedVisibleSeconds: fc.double({ min: 0, max: 86_400, noNaN: true }),
  baseY: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
});

describe('Property 4: Rating visual mapping and Star motion', () => {
  it('R3.1-R3.3 preserves every exact Rating tuple, 30-degree rotation rate, and three-second ±0.1 y oscillation', () => {
    fc.assert(
      fc.property(visibleMotionInputArbitrary, ({ elapsedVisibleSeconds, baseY }) => {
        const motion = sampleStarMotion(elapsedVisibleSeconds, baseY);
        const oneSecondLater = sampleStarMotion(elapsedVisibleSeconds + 1, baseY);
        const onePeriodLater = sampleStarMotion(elapsedVisibleSeconds + 3, baseY);
        const expectedY =
          baseY + 0.1 * Math.sin((elapsedVisibleSeconds / 3) * Math.PI * 2);

        for (const [rating, radius, bloom, color] of EXPECTED_VISUALS) {
          expect(getRatingVisual(rating)).toEqual({ radius, bloom, color });
        }

        expect(motion.rotationY).toBe(elapsedVisibleSeconds * (Math.PI / 6));
        expect(oneSecondLater.rotationY - motion.rotationY).toBeCloseTo(
          Math.PI / 6,
          10,
        );
        expect(motion.y).toBeCloseTo(expectedY, 10);
        expect(motion.y).toBeGreaterThanOrEqual(baseY - 0.1);
        expect(motion.y).toBeLessThanOrEqual(baseY + 0.1);
        expect(onePeriodLater.y).toBeCloseTo(motion.y, 10);
      }),
      { numRuns: 100 },
    );
  });
});
