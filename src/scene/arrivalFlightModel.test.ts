import { describe, expect, it } from 'vitest';

import {
  SPACE_CAMERA_FOV,
  SPACE_CAMERA_HOME_POSE,
  SPACE_CAMERA_MAX_DISTANCE,
} from './backgroundModel';
import {
  ARRIVAL_DURATION_SECONDS,
  ARRIVAL_FOV_BOOST,
  ARRIVAL_START_DISTANCE,
  calculateArrivalStartPose,
  easeOutQuint,
  sampleArrivalFlight,
} from './arrivalFlightModel';

const HOME = SPACE_CAMERA_HOME_POSE;

function distanceFromTarget(position: { x: number; y: number; z: number }): number {
  return Math.hypot(
    position.x - HOME.target.x,
    position.y - HOME.target.y,
    position.z - HOME.target.z,
  );
}

describe('opening arrival flight', () => {
  it('starts far out along the home view axis', () => {
    const start = calculateArrivalStartPose(HOME);
    expect(distanceFromTarget(start.position)).toBeCloseTo(ARRIVAL_START_DISTANCE);
    // Home looks down +z, so the approach comes from further along +z.
    expect(start.position.z).toBeCloseTo(ARRIVAL_START_DISTANCE);
  });

  it('eases out: most of the distance is covered in the first half', () => {
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
    expect(easeOutQuint(0.5)).toBeGreaterThan(0.9);
    // Clamped outside the unit range rather than overshooting.
    expect(easeOutQuint(-1)).toBe(0);
    expect(easeOutQuint(4)).toBe(1);
  });

  it('flies inward monotonically and lands exactly on the home pose', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 10; step += 1) {
      const elapsed = (ARRIVAL_DURATION_SECONDS * step) / 10;
      const { pose } = sampleArrivalFlight(elapsed, HOME);
      const distance = distanceFromTarget(pose.position);
      expect(distance).toBeLessThan(previous);
      previous = distance;
    }

    const landed = sampleArrivalFlight(ARRIVAL_DURATION_SECONDS, HOME);
    expect(landed.completed).toBe(true);
    expect(landed.pose).toEqual({ position: HOME.position, target: HOME.target });
    expect(landed.fov).toBe(SPACE_CAMERA_FOV);
  });

  it('widens the field of view at launch and restores it on arrival', () => {
    expect(sampleArrivalFlight(0, HOME).fov).toBeCloseTo(
      SPACE_CAMERA_FOV + ARRIVAL_FOV_BOOST,
    );
    expect(sampleArrivalFlight(ARRIVAL_DURATION_SECONDS * 0.5, HOME).fov)
      .toBeLessThan(SPACE_CAMERA_FOV + ARRIVAL_FOV_BOOST);
    expect(sampleArrivalFlight(ARRIVAL_DURATION_SECONDS * 4, HOME).fov)
      .toBe(SPACE_CAMERA_FOV);
  });

  it('stays inside the trackball distance limit for the whole flight', () => {
    for (let step = 0; step <= 20; step += 1) {
      const elapsed = (ARRIVAL_DURATION_SECONDS * step) / 20;
      const { pose } = sampleArrivalFlight(elapsed, HOME);
      // Against the constant, not a copy of it: the limit moved to 2200 and a
      // hardcoded 900 would have gone on asserting a bound nothing enforces.
      expect(distanceFromTarget(pose.position))
        .toBeLessThanOrEqual(SPACE_CAMERA_MAX_DISTANCE);
    }
  });

  it('rejects invalid timings', () => {
    expect(() => sampleArrivalFlight(-1, HOME)).toThrow(RangeError);
    expect(() => sampleArrivalFlight(Number.NaN, HOME)).toThrow(RangeError);
    expect(() => sampleArrivalFlight(1, HOME, 0)).toThrow(RangeError);
  });
});
