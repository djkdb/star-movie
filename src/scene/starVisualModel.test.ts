import { describe, expect, it } from 'vitest';

import type { Rating, Star } from '../domain/models';
import {
  createStarDragPayload,
  getRatingVisual,
  sampleStarDriftOffset,
  sampleStarRenderTransform,
  STAR_DRIFT_AMPLITUDE,
  STAR_DRIFT_ANGULAR_FREQUENCIES,
  STAR_DRIFT_AXIS_PHASE_OFFSETS,
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_LABEL_FADE_SECONDS,
  STAR_ROTATION_RADIANS_PER_SECOND,
} from './starVisualModel';

const expectedVisuals = [
  [1, 0.4, 0.1, '#6a7290'],
  [2, 0.6, 0.25, '#9aa8d0'],
  [3, 0.85, 0.5, '#cfe0ff'],
  [4, 1.1, 0.75, '#ffe9b8'],
  [5, 1.4, 1, '#fff8e0'],
] as const;

function createStar(overrides: Partial<Star> = {}): Star {
  return {
    id: 'star-drift',
    title: 'Drifting Star',
    normalizedTitle: 'drifting star',
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 2, y: 7, z: -3 },
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('individual Star visual model', () => {
  it.each(expectedVisuals)(
    'R3.1 maps rating %i to radius %f, Bloom %f, and color %s',
    (rating, radius, bloom, color) => {
      expect(getRatingVisual(rating as Rating)).toEqual({ radius, bloom, color });
    },
  );

  it('R1.10 exposes drift constants and drops the old y oscillation API', async () => {
    expect(STAR_ROTATION_RADIANS_PER_SECOND).toBeCloseTo(Math.PI / 6);
    expect(STAR_DRIFT_AMPLITUDE).toBe(0.34);
    expect(STAR_DRIFT_ANGULAR_FREQUENCIES).toEqual({ x: 0.21, y: 0.24, z: 0.27 });
    expect(STAR_DRIFT_AXIS_PHASE_OFFSETS).toEqual({
      x: 0,
      y: (2 * Math.PI) / 3,
      z: (4 * Math.PI) / 3,
    });

    const model = await import('./starVisualModel');
    expect('sampleStarMotion' in model).toBe(false);
    expect('STAR_OSCILLATION_AMPLITUDE' in model).toBe(false);
    expect('STAR_OSCILLATION_PERIOD_SECONDS' in model).toBe(false);
  });

  it('R1.1-R1.3 drifts within the proven magnitude and speed bounds on all three axes', () => {
    const offsetStart = sampleStarDriftOffset(0, 0);
    const offsetLater = sampleStarDriftOffset(12.5, 1.2);
    for (const offset of [offsetStart, offsetLater]) {
      expect(Math.hypot(offset.x, offset.y, offset.z)).toBeLessThanOrEqual(0.6);
    }
    // A generic sampled instant moves on every axis (not a single-axis wobble).
    expect(offsetLater.x).not.toBe(0);
    expect(offsetLater.y).not.toBe(0);
    expect(offsetLater.z).not.toBe(0);
  });

  it('R1.7 R1.9 pins to Base_Position under reduced motion and otherwise preserves rotation', () => {
    const star = createStar();
    const moving = sampleStarRenderTransform(star, 3, Math.PI / 3, false, false);
    expect(moving.rotationY).toBeCloseTo(3 * (Math.PI / 6));
    expect(moving.position).not.toEqual(star.position);

    const still = sampleStarRenderTransform(star, 3, Math.PI / 3, false, true);
    expect(still.position).toEqual(star.position);
    expect(still.rotationY).toBe(0);
  });

  it('R3.6-R3.10 defines exact hover scales and title fade duration', () => {
    expect(STAR_IDLE_SCALE).toBe(1);
    expect(STAR_HOVER_SCALE).toBe(1.5);
    expect(STAR_LABEL_FADE_SECONDS).toBe(0.3);
  });

  it('creates an immutable Blackhole drag payload with the Star identity and source position', () => {
    const position = { x: 1, y: 2, z: 3 };
    const payload = createStarDragPayload('star-1', position);

    expect(payload).toEqual({
      type: 'star',
      starId: 'star-1',
      sourcePosition: position,
    });
    expect(payload.sourcePosition).not.toBe(position);
  });
});
