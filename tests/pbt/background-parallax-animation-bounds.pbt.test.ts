// Feature: space-movie-archive, Property 1: 배경 파라랙스와 애니메이션 경계
// **Validates: Requirements 1.3, 1.4, 1.5**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_NEBULA_COUNT,
  MAX_NEBULA_OPACITY,
  MAX_TWINKLE_PERIOD_SECONDS,
  MIN_NEBULA_COUNT,
  MIN_NEBULA_OPACITY,
  MIN_TWINKLE_PERIOD_SECONDS,
  NEBULA_COLOR_END,
  NEBULA_COLOR_START,
  TWINKLE_AMPLITUDE,
  calculateParallaxOffset,
  createBackgroundStars,
  createNebulaConfigs,
  twinkleMultiplier,
  type BackgroundLayerDefinition,
} from '../../src/scene/backgroundModel';

const STAR_SAMPLES_PER_LAYER = 16;
const TWO_PI = Math.PI * 2;

function hexChannels(color: string): readonly [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (match === null) throw new Error(`Invalid RGB color: ${color}`);
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ];
}

const cameraRotationArbitrary = fc.record({
  x: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  y: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
});

const propertyInputArbitrary = fc.record({
  cameraRotation: cameraRotationArbitrary,
  elapsedVisibleSeconds: fc.double({ min: 0, max: 86_400, noNaN: true }),
  seed: fc.integer({ min: 0, max: 0xffff_ffff }),
});

describe('Property 1: background parallax and animation boundaries', () => {
  it('R1.3 R1.4 R1.5 keeps parallax, twinkle, and Nebula values within their required bounds', () => {
    fc.assert(
      fc.property(
        propertyInputArbitrary,
        ({ cameraRotation, elapsedVisibleSeconds, seed }) => {
          const farOffset = calculateParallaxOffset(cameraRotation, 1);
          const nearOffset = calculateParallaxOffset(cameraRotation, 1.5);

          expect(nearOffset[0]).toBeCloseTo(farOffset[0] * 1.5, 14);
          expect(nearOffset[1]).toBeCloseTo(farOffset[1] * 1.5, 14);

          const definitions: readonly BackgroundLayerDefinition[] = [
            {
              kind: 'far',
              parallaxFactor: 1,
              seed,
              starCount: STAR_SAMPLES_PER_LAYER,
            },
            {
              kind: 'near',
              parallaxFactor: 1.5,
              seed: (seed ^ 0x9e37_79b9) >>> 0,
              starCount: STAR_SAMPLES_PER_LAYER,
            },
          ];

          for (const definition of definitions) {
            const stars = createBackgroundStars(definition);
            expect(stars).toHaveLength(STAR_SAMPLES_PER_LAYER);

            for (const star of stars) {
              expect(star.twinklePeriodSeconds).toBeGreaterThanOrEqual(
                MIN_TWINKLE_PERIOD_SECONDS,
              );
              expect(star.twinklePeriodSeconds).toBeLessThanOrEqual(
                MAX_TWINKLE_PERIOD_SECONDS,
              );
              expect(star.twinklePhaseRadians).toBeGreaterThanOrEqual(0);
              expect(star.twinklePhaseRadians).toBeLessThan(TWO_PI);

              const multiplier = twinkleMultiplier(
                elapsedVisibleSeconds,
                star.twinklePeriodSeconds,
                star.twinklePhaseRadians,
              );
              expect(multiplier).toBeGreaterThanOrEqual(1 - TWINKLE_AMPLITUDE);
              expect(multiplier).toBeLessThanOrEqual(1 + TWINKLE_AMPLITUDE);

              const onePeriodLater = twinkleMultiplier(
                elapsedVisibleSeconds + star.twinklePeriodSeconds,
                star.twinklePeriodSeconds,
                star.twinklePhaseRadians,
              );
              expect(onePeriodLater).toBeCloseTo(multiplier, 9);
            }
          }

          const nebulas = createNebulaConfigs(seed);
          expect(nebulas.length).toBeGreaterThanOrEqual(MIN_NEBULA_COUNT);
          expect(nebulas.length).toBeLessThanOrEqual(MAX_NEBULA_COUNT);

          const minimumColor = hexChannels(NEBULA_COLOR_START);
          const maximumColor = hexChannels(NEBULA_COLOR_END);
          for (const nebula of nebulas) {
            expect(nebula.opacity).toBeGreaterThanOrEqual(MIN_NEBULA_OPACITY);
            expect(nebula.opacity).toBeLessThanOrEqual(MAX_NEBULA_OPACITY);

            const channels = hexChannels(nebula.color);
            channels.forEach((channel, index) => {
              expect(channel).toBeGreaterThanOrEqual(minimumColor[index]!);
              expect(channel).toBeLessThanOrEqual(maximumColor[index]!);
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
