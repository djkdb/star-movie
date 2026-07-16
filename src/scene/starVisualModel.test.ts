import { describe, expect, it } from 'vitest';

import type { Rating, Star } from '../domain/models';
import {
  createStarDragPayload,
  getRatingVisual,
  getStarAppearance,
  getStarDisplayColor,
  sampleStarDriftOffset,
  STAR_TINT_PALETTE,
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

  it('R1.10 exposes free-roaming drift constants and drops the old y oscillation API', async () => {
    expect(STAR_ROTATION_RADIANS_PER_SECOND).toBeCloseTo(Math.PI / 6);
    expect(STAR_DRIFT_AMPLITUDE).toBe(2.4);
    expect(STAR_DRIFT_ANGULAR_FREQUENCIES).toEqual({ x: 0.09, y: 0.108, z: 0.123 });
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

  it('R1.1-R1.3 drifts within the bounded per-axis envelope on all three axes', () => {
    // Each axis sums two weighted sines whose weights total 1, so |axis| ≤ A and
    // the total wander is bounded by A·√3.
    const maxTotal = STAR_DRIFT_AMPLITUDE * Math.sqrt(3) + 1e-9;
    const offsetStart = sampleStarDriftOffset(0, 0);
    const offsetLater = sampleStarDriftOffset(12.5, 1.2);
    for (const offset of [offsetStart, offsetLater]) {
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(STAR_DRIFT_AMPLITUDE + 1e-9);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(STAR_DRIFT_AMPLITUDE + 1e-9);
      expect(Math.abs(offset.z)).toBeLessThanOrEqual(STAR_DRIFT_AMPLITUDE + 1e-9);
      expect(Math.hypot(offset.x, offset.y, offset.z)).toBeLessThanOrEqual(maxTotal);
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

  it('derives varied but stable per-star appearances from identity', () => {
    const appearance = getStarAppearance('star-appearance', 3);
    expect(getStarAppearance('star-appearance', 3)).toEqual(appearance);
    expect(STAR_TINT_PALETTE).toContain(appearance.color);
    expect([0, 4, 6]).toContain(appearance.spikeCount);

    // Rating still controls size and brightness; identity controls hue.
    expect(getStarAppearance('star-appearance', 5).radius).toBeGreaterThan(
      getStarAppearance('star-appearance', 1).radius,
    );
    expect(getStarAppearance('star-appearance', 5).color).toBe(appearance.color);

    // A modest sample of identities spreads across several palette hues.
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) => getStarAppearance(`star-${index}`, 3).color),
    );
    expect(colors.size).toBeGreaterThanOrEqual(4);

    // Display colors are valid hex and dimmer for low ratings.
    expect(getStarDisplayColor('star-appearance', 4)).toMatch(/^#[0-9a-f]{6}$/);
    expect(() => getStarAppearance('', 3)).toThrow(RangeError);
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
