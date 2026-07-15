import { describe, expect, it, vi } from 'vitest';

import type { QualityLevel } from '../domain/models';
import { getSceneQualitySettings } from '../domain/qualityLevel';
import {
  FpsDegradationController,
  type AnimationFrameScheduler,
} from './FpsDegradationController';

class FakeAnimationFrameScheduler implements AnimationFrameScheduler {
  private nextId = 1;
  private pending: { id: number; callback: FrameRequestCallback } | null = null;

  request(callback: FrameRequestCallback): number {
    const id = this.nextId++;
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

  hasPendingFrame(): boolean {
    return this.pending !== null;
  }
}

function runFiveSecondWindow(
  scheduler: FakeAnimationFrameScheduler,
  startMs: number,
  intervalMs: number,
): void {
  const frameCount = Math.ceil(5_000 / intervalMs);
  for (let index = 1; index <= frameCount; index += 1) {
    scheduler.step(startMs + Math.min(index * intervalMs, 5_000));
  }
}

describe('FpsDegradationController', () => {
  it('R13.3-R13.5 applies at most one ordered degradation per low 5-second RAF window and never recovers', () => {
    const scheduler = new FakeAnimationFrameScheduler();
    const changes = vi.fn();
    const measurements = vi.fn();
    let qualityLevel: QualityLevel = 'full';
    const controller = new FpsDegradationController({
      scheduler,
      getQualityLevel: () => qualityLevel,
      onQualityLevelChange: (next, averageFps) => {
        qualityLevel = next;
        changes(next, averageFps);
      },
      onWindowMeasured: measurements,
    });

    controller.start();
    scheduler.step(0);
    runFiveSecondWindow(scheduler, 0, 100);
    expect(qualityLevel).toBe('reducedBackground');

    runFiveSecondWindow(scheduler, 5_000, 25);
    expect(qualityLevel).toBe('reducedBackground');

    runFiveSecondWindow(scheduler, 10_000, 100);
    expect(qualityLevel).toBe('minimumParticles');
    runFiveSecondWindow(scheduler, 15_000, 100);
    expect(qualityLevel).toBe('reducedBloom');
    runFiveSecondWindow(scheduler, 20_000, 100);

    expect(changes.mock.calls.map(([level]) => level)).toEqual([
      'reducedBackground',
      'minimumParticles',
      'reducedBloom',
    ]);
    expect(changes.mock.calls[0]![1]).toBeCloseTo(10);
    expect(qualityLevel).toBe('reducedBloom');
    expect(measurements).toHaveBeenCalledTimes(5);
    expect(measurements.mock.calls.map(([window]) => ({
      qualityLevel: window.qualityLevel,
      degradedTo: window.degradedTo,
      durationMs: window.durationMs,
    }))).toEqual([
      { qualityLevel: 'full', degradedTo: 'reducedBackground', durationMs: 5_000 },
      { qualityLevel: 'reducedBackground', degradedTo: null, durationMs: 5_000 },
      { qualityLevel: 'reducedBackground', degradedTo: 'minimumParticles', durationMs: 5_000 },
      { qualityLevel: 'minimumParticles', degradedTo: 'reducedBloom', durationMs: 5_000 },
      { qualityLevel: 'reducedBloom', degradedTo: null, durationMs: 5_000 },
    ]);
  });

  it('R13.2 resets an incomplete window across stop/start so hidden time cannot cause degradation', () => {
    const scheduler = new FakeAnimationFrameScheduler();
    let qualityLevel: QualityLevel = 'full';
    const controller = new FpsDegradationController({
      scheduler,
      getQualityLevel: () => qualityLevel,
      onQualityLevelChange: (next) => {
        qualityLevel = next;
      },
    });

    controller.start();
    controller.start();
    scheduler.step(0);
    scheduler.step(1_000);
    controller.stop();
    expect(scheduler.hasPendingFrame()).toBe(false);

    controller.start();
    scheduler.step(100_000);
    expect(qualityLevel).toBe('full');
    runFiveSecondWindow(scheduler, 100_000, 100);
    expect(qualityLevel).toBe('reducedBackground');
  });

  it('maps each quality level to cumulative scene reductions', () => {
    expect(getSceneQualitySettings('full')).toEqual({
      backgroundStarScale: 1,
      minimumParticleCounts: false,
      reducedBloom: false,
    });
    expect(getSceneQualitySettings('reducedBackground')).toEqual({
      backgroundStarScale: 0.5,
      minimumParticleCounts: false,
      reducedBloom: false,
    });
    expect(getSceneQualitySettings('minimumParticles')).toEqual({
      backgroundStarScale: 0.5,
      minimumParticleCounts: true,
      reducedBloom: false,
    });
    expect(getSceneQualitySettings('reducedBloom')).toEqual({
      backgroundStarScale: 0.5,
      minimumParticleCounts: true,
      reducedBloom: true,
    });
  });
});
