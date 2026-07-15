// Feature: space-movie-archive, Property 19: 렌더 모드와 성능 저하 순서
// **Validates: Requirements 13.1, 13.3, 13.4, 13.5**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { QualityLevel } from '../../src/domain/models';
import {
  FpsDegradationController,
  type AnimationFrameScheduler,
} from '../../src/scene/FpsDegradationController';
import {
  INDIVIDUAL_STAR_LIMIT,
  getStarRenderMode,
} from '../../src/scene/starRendererModel';

const ORDERED_DEGRADATION_LEVELS: readonly QualityLevel[] = [
  'reducedBackground',
  'minimumParticles',
  'reducedBloom',
];

interface PerformanceScenario {
  activeWorkCount: number;
  fpsWindows: number[];
}

const scenarioArbitrary: fc.Arbitrary<PerformanceScenario> = fc.record({
  activeWorkCount: fc.oneof(
    fc.constant(INDIVIDUAL_STAR_LIMIT),
    fc.constant(INDIVIDUAL_STAR_LIMIT + 1),
    fc.integer({ min: 0, max: 500 }),
  ),
  fpsWindows: fc.array(
    fc.oneof(
      fc.constant(29),
      fc.constant(30),
      fc.integer({ min: 1, max: 60 }),
    ),
    { minLength: 1, maxLength: 12 },
  ),
});

class FakeAnimationFrameScheduler implements AnimationFrameScheduler {
  private nextId = 1;
  private pending: { id: number; callback: FrameRequestCallback } | null = null;

  request(callback: FrameRequestCallback): number {
    const id = this.nextId;
    this.nextId += 1;
    this.pending = { id, callback };
    return id;
  }

  cancel(requestId: number): void {
    if (this.pending?.id === requestId) this.pending = null;
  }

  step(timestamp: number): void {
    const pending = this.pending;
    if (pending === null) throw new Error('No animation frame is pending');
    this.pending = null;
    pending.callback(timestamp);
  }
}

function runFiveSecondFpsWindow(
  scheduler: FakeAnimationFrameScheduler,
  startMs: number,
  fps: number,
): void {
  const intervalCount = fps * 5;
  for (let index = 1; index <= intervalCount; index += 1) {
    scheduler.step(startMs + (index * 5_000) / intervalCount);
  }
}

describe('Property 19: 렌더 모드와 성능 저하 순서', () => {
  it('R13.1 R13.3 R13.4 R13.5 selects the 50/51 render mode boundary and degrades exactly one ordered stage per sub-30 FPS window without recovery', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ activeWorkCount, fpsWindows }) => {
        expect(getStarRenderMode(activeWorkCount)).toBe(
          activeWorkCount <= INDIVIDUAL_STAR_LIMIT ? 'individual' : 'instanced',
        );
        expect(getStarRenderMode(50)).toBe('individual');
        expect(getStarRenderMode(51)).toBe('instanced');

        const scheduler = new FakeAnimationFrameScheduler();
        let qualityLevel: QualityLevel = 'full';
        const observedChanges: QualityLevel[] = [];
        const controller = new FpsDegradationController({
          scheduler,
          getQualityLevel: () => qualityLevel,
          onQualityLevelChange: (next) => {
            qualityLevel = next;
            observedChanges.push(next);
          },
        });

        controller.start();
        scheduler.step(0);

        let lowFpsWindowCount = 0;
        fpsWindows.forEach((fps, windowIndex) => {
          runFiveSecondFpsWindow(scheduler, windowIndex * 5_000, fps);
          if (fps < 30) lowFpsWindowCount += 1;

          const expectedChangeCount = Math.min(
            lowFpsWindowCount,
            ORDERED_DEGRADATION_LEVELS.length,
          );
          expect(observedChanges).toEqual(
            ORDERED_DEGRADATION_LEVELS.slice(0, expectedChangeCount),
          );
          expect(qualityLevel).toBe(
            expectedChangeCount === 0
              ? 'full'
              : ORDERED_DEGRADATION_LEVELS[expectedChangeCount - 1],
          );
        });

        controller.stop();
      }),
      { numRuns: 150 },
    );
  });
});
