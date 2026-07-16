import { describe, expect, it } from 'vitest';

import {
  applyWheelToZoomTarget,
  dampZoomDistance,
  SMOOTH_ZOOM_MIN_DISTANCE,
  SMOOTH_ZOOM_WHEEL_SENSITIVITY,
} from './smoothZoomModel';

describe('smooth zoom model', () => {
  it('scales the target multiplicatively per wheel tick and clamps to bounds', () => {
    const zoomedOut = applyWheelToZoomTarget(100, 100, 3, 1000);
    expect(zoomedOut).toBeCloseTo(100 * Math.exp(100 * SMOOTH_ZOOM_WHEEL_SENSITIVITY));
    expect(zoomedOut).toBeGreaterThan(100);

    const zoomedIn = applyWheelToZoomTarget(100, -100, 3, 1000);
    expect(zoomedIn).toBeLessThan(100);
    // Two ticks compose multiplicatively, independent of order.
    const twice = applyWheelToZoomTarget(applyWheelToZoomTarget(100, 60), -30);
    const once = applyWheelToZoomTarget(100, 30);
    expect(twice).toBeCloseTo(once);

    expect(applyWheelToZoomTarget(4, -10_000, SMOOTH_ZOOM_MIN_DISTANCE, 1000))
      .toBe(SMOOTH_ZOOM_MIN_DISTANCE);
    expect(applyWheelToZoomTarget(900, 10_000, 3, 1000)).toBe(1000);
    expect(() => applyWheelToZoomTarget(Number.NaN, 1)).toThrow(RangeError);
  });

  it('eases toward the target monotonically and settles exactly on it', () => {
    let distance = 100;
    const target = 40;
    let previousGap = Math.abs(distance - target);
    for (let frame = 0; frame < 240; frame += 1) {
      const sample = dampZoomDistance(distance, target, 1 / 60);
      distance = sample.distance;
      const gap = Math.abs(distance - target);
      expect(gap).toBeLessThanOrEqual(previousGap);
      previousGap = gap;
      if (sample.settled) break;
    }
    expect(distance).toBe(target);
  });

  it('is frame-rate independent: two half steps equal one full step', () => {
    const full = dampZoomDistance(100, 40, 1 / 30).distance;
    const half = dampZoomDistance(100, 40, 1 / 60).distance;
    const halves = dampZoomDistance(half, 40, 1 / 60).distance;
    expect(halves).toBeCloseTo(full, 10);
    expect(() => dampZoomDistance(1, 1, -0.1)).toThrow(RangeError);
  });
});
