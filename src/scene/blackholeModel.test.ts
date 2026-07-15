import { describe, expect, it } from 'vitest';

import type { RuntimeEvent } from '../domain/models';
import {
  BLACKHOLE_DISTORTION_MAX_STRENGTH,
  BLACKHOLE_DISTORTION_RADIUS,
  BLACKHOLE_POSITION,
  BLACKHOLE_SPIRAL_DURATION_SECONDS,
  collectPendingBlackholeEffects,
  getBlackholeEffectDescriptor,
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
});
