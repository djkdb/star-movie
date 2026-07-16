// Feature: space-movie-archive, Property 4: Rating 시각 매핑
// Feature: natural-star-drift-and-camera-return, Property 1: 표류 오프셋 크기 경계
// Feature: natural-star-drift-and-camera-return, Property 2: 표류 속도·연속성 경계
// **Validates: Requirements 3.1 (rating map); 1.1, 1.2, 1.3, 1.5 (drift)**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Rating } from '../../src/domain/models';
import {
  getRatingVisual,
  sampleStarDriftOffset,
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

const magnitude = (offset: { x: number; y: number; z: number }): number =>
  Math.hypot(offset.x, offset.y, offset.z);

describe('Property 4: Rating visual mapping', () => {
  it('R3.1 preserves every exact Rating tuple', () => {
    for (const [rating, radius, bloom, color] of EXPECTED_VISUALS) {
      expect(getRatingVisual(rating)).toEqual({ radius, bloom, color });
    }
  });
});

const driftInputArbitrary = fc.record({
  elapsedVisibleSeconds: fc.double({ min: 0, max: 86_400, noNaN: true }),
  phaseSeed: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
});

describe('Property 1: drift offset magnitude bound', () => {
  it('R1.1 R1.2 keeps the offset finite, time-varying, and within the free-roaming envelope', () => {
    // Each axis sums two weighted sines whose weights total 1, so |axis| ≤ A and
    // the total wander is bounded by A·√3.
    const maxWander = 2.4 * Math.sqrt(3) + 1e-9;
    fc.assert(
      fc.property(driftInputArbitrary, ({ elapsedVisibleSeconds, phaseSeed }) => {
        const offset = sampleStarDriftOffset(elapsedVisibleSeconds, phaseSeed);
        expect(Number.isFinite(offset.x)).toBe(true);
        expect(Number.isFinite(offset.y)).toBe(true);
        expect(Number.isFinite(offset.z)).toBe(true);
        expect(magnitude(offset)).toBeLessThanOrEqual(maxWander);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: drift speed and continuity bound', () => {
  it('R1.3 R1.5 keeps ‖offset(t+Δ) − offset(t)‖ ≤ 0.6·Δ (bounded speed, no discontinuous jump)', () => {
    fc.assert(
      fc.property(
        fc.record({
          elapsedVisibleSeconds: fc.double({ min: 0, max: 86_400, noNaN: true }),
          phaseSeed: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
          delta: fc.double({ min: 1e-4, max: 0.5, noNaN: true }),
        }),
        ({ elapsedVisibleSeconds, phaseSeed, delta }) => {
          const before = sampleStarDriftOffset(elapsedVisibleSeconds, phaseSeed);
          const after = sampleStarDriftOffset(
            elapsedVisibleSeconds + delta,
            phaseSeed,
          );
          const displacement = magnitude({
            x: after.x - before.x,
            y: after.y - before.y,
            z: after.z - before.z,
          });
          // Small tolerance absorbs floating-point error at the Lipschitz bound.
          expect(displacement).toBeLessThanOrEqual(0.6 * delta + 1e-9);
        },
      ),
      { numRuns: 100 },
    );
  });
});
