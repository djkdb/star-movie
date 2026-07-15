import { describe, expect, it } from 'vitest';

import type { Rating } from '../domain/models';
import {
  createStarDragPayload,
  getRatingVisual,
  sampleStarMotion,
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_LABEL_FADE_SECONDS,
  STAR_OSCILLATION_AMPLITUDE,
  STAR_OSCILLATION_PERIOD_SECONDS,
  STAR_ROTATION_RADIANS_PER_SECOND,
} from './starVisualModel';

const expectedVisuals = [
  [1, 0.4, 0.1, '#6a7290'],
  [2, 0.6, 0.25, '#9aa8d0'],
  [3, 0.85, 0.5, '#cfe0ff'],
  [4, 1.1, 0.75, '#ffe9b8'],
  [5, 1.4, 1, '#fff8e0'],
] as const;

describe('individual Star visual model', () => {
  it.each(expectedVisuals)(
    'R3.1 maps rating %i to radius %f, Bloom %f, and color %s',
    (rating, radius, bloom, color) => {
      expect(getRatingVisual(rating as Rating)).toEqual({ radius, bloom, color });
    },
  );

  it('R3.2-R3.5 rotates 30 degrees per visible second and repeats a ±0.1 y oscillation every 3 seconds', () => {
    expect(STAR_ROTATION_RADIANS_PER_SECOND).toBeCloseTo(Math.PI / 6);
    expect(STAR_OSCILLATION_PERIOD_SECONDS).toBe(3);
    expect(STAR_OSCILLATION_AMPLITUDE).toBe(0.1);

    expect(sampleStarMotion(0, 7)).toEqual({ rotationY: 0, y: 7 });
    expect(sampleStarMotion(0.75, 7)).toMatchObject({ y: 7.1 });
    expect(sampleStarMotion(1.5, 7).y).toBeCloseTo(7);
    expect(sampleStarMotion(2.25, 7).y).toBeCloseTo(6.9);
    expect(sampleStarMotion(3, 7).y).toBeCloseTo(7);
    expect(sampleStarMotion(3, 7).rotationY).toBeCloseTo(Math.PI / 2);
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
