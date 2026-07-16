import { describe, expect, it } from 'vitest';

import type { RuntimeEvent } from '../domain/models';
import {
  BLACKHOLE_DISTORTION_MAX_STRENGTH,
  BLACKHOLE_DISTORTION_RADIUS,
  BLACKHOLE_MASS_SCALE_PER_WORK,
  BLACKHOLE_MAX_MASS_SCALE,
  BLACKHOLE_POSITION,
  BLACKHOLE_SPIRAL_DURATION_SECONDS,
  collectPendingBlackholeEffects,
  EMBER_ORBIT_MAX_RADIUS,
  EMBER_ORBIT_MIN_RADIUS,
  getArchivedEmberOrbit,
  getBlackholeEffectDescriptor,
  getBlackholeMassScale,
  getBlackholeRotation,
  getBoundedLightDistortion,
  isBlackholeDropHit,
} from './blackholeModel';

const POSITION = { x: -42, y: 1, z: -44 };

function event(type: string, id = `${type}:1`): RuntimeEvent {
  return {
    id,
    type,
    occurredAt: '2025-04-05T06:07:08.000Z',
    payload: {
      starId: '10000000-0000-4000-8000-000000000001',
      position: POSITION,
      particleEffects: type === 'work-soft-deleted' ? ['blackhole-spiral'] : [],
    },
  };
}

describe('blackhole scene model', () => {
  it('R12.1 keeps the disk at one fixed position and rotates deterministically', () => {
    expect(BLACKHOLE_POSITION).toEqual({ x: 0, y: -18, z: -25 });
    expect(Object.isFrozen(BLACKHOLE_POSITION)).toBe(true);
    expect(getBlackholeRotation(2)).toBeCloseTo(Math.PI * 0.4);
    expect(() => getBlackholeRotation(-1)).toThrow(RangeError);
  });

  it('R12.1 bounds light distortion to the visible halo', () => {
    for (let distance = 0; distance <= BLACKHOLE_DISTORTION_RADIUS + 4; distance += 0.1) {
      const strength = getBoundedLightDistortion(distance);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(BLACKHOLE_DISTORTION_MAX_STRENGTH);
      if (distance >= BLACKHOLE_DISTORTION_RADIUS) expect(strength).toBe(0);
    }
  });

  it('R12.2 accepts only drops inside the bounded world-space hit volume', () => {
    expect(isBlackholeDropHit(BLACKHOLE_POSITION)).toBe(true);
    expect(isBlackholeDropHit({
      x: BLACKHOLE_POSITION.x + BLACKHOLE_DISTORTION_RADIUS,
      y: BLACKHOLE_POSITION.y,
      z: BLACKHOLE_POSITION.z,
    })).toBe(true);
    expect(isBlackholeDropHit({
      x: BLACKHOLE_POSITION.x + BLACKHOLE_DISTORTION_RADIUS + 0.01,
      y: BLACKHOLE_POSITION.y,
      z: BLACKHOLE_POSITION.z,
    })).toBe(false);
    expect(isBlackholeDropHit({
      ...BLACKHOLE_POSITION,
      z: BLACKHOLE_POSITION.z + 3.01,
    })).toBe(false);
  });

  it('R12.4-R12.5 R12.12 maps committed success events once and ignores failures/non-effects', () => {
    const softDelete = event('work-soft-deleted');
    const restore = event('work-restored');
    const failed = event('user-save-failed');

    expect(getBlackholeEffectDescriptor(softDelete)).toMatchObject({
      kind: 'soft-delete-spiral',
      durationSeconds: BLACKHOLE_SPIRAL_DURATION_SECONDS,
      sourcePosition: POSITION,
    });
    expect(getBlackholeEffectDescriptor(restore)).toMatchObject({ kind: 'restore-pulse' });
    expect(getBlackholeEffectDescriptor(failed)).toBeNull();

    const pending = collectPendingBlackholeEffects(
      [softDelete, softDelete, restore, failed],
      new Set([restore.id]),
    );
    expect(pending.map(({ eventId }) => eventId)).toEqual([softDelete.id]);
  });
it('grows bounded mass with the archive and keeps deterministic ember orbits', () => {
    expect(getBlackholeMassScale(0)).toBe(1);
    expect(getBlackholeMassScale(-3)).toBe(1);
    expect(getBlackholeMassScale(4)).toBeCloseTo(1 + 4 * BLACKHOLE_MASS_SCALE_PER_WORK);
    expect(getBlackholeMassScale(500)).toBe(BLACKHOLE_MAX_MASS_SCALE);
    expect(getBlackholeMassScale(10)).toBeGreaterThan(getBlackholeMassScale(3));

    const orbit = getArchivedEmberOrbit('10000000-0000-4000-8000-000000000001');
    expect(getArchivedEmberOrbit('10000000-0000-4000-8000-000000000001')).toEqual(orbit);
    expect(orbit.radius).toBeGreaterThanOrEqual(EMBER_ORBIT_MIN_RADIUS);
    expect(orbit.radius).toBeLessThanOrEqual(EMBER_ORBIT_MAX_RADIUS);
    expect(orbit.angularSpeedRadiansPerSecond).toBeGreaterThan(0);
    expect(orbit.phaseRadians).toBeGreaterThanOrEqual(0);
    expect(orbit.phaseRadians).toBeLessThanOrEqual(Math.PI * 2);
    expect(getArchivedEmberOrbit('another-work')).not.toEqual(orbit);
    expect(() => getArchivedEmberOrbit('')).toThrow(RangeError);
  });
});
