import type { Rating, Vec3 } from '../domain/models';

export interface RatingVisual {
  radius: number;
  bloom: number;
  color: string;
}

export const RATING_VISUALS: Readonly<Record<Rating, RatingVisual>> = {
  1: { radius: 0.4, bloom: 0.1, color: '#6a7290' },
  2: { radius: 0.6, bloom: 0.25, color: '#9aa8d0' },
  3: { radius: 0.85, bloom: 0.5, color: '#cfe0ff' },
  4: { radius: 1.1, bloom: 0.75, color: '#ffe9b8' },
  5: { radius: 1.4, bloom: 1, color: '#fff8e0' },
} as const;

export const STAR_ROTATION_RADIANS_PER_SECOND = Math.PI / 6;
export const STAR_OSCILLATION_AMPLITUDE = 0.1;
export const STAR_OSCILLATION_PERIOD_SECONDS = 3;
export const STAR_HOVER_SCALE = 1.5;
export const STAR_IDLE_SCALE = 1;
export const STAR_LABEL_FADE_SECONDS = 0.3;
export const STAR_DRAG_PAYLOAD_TYPE = 'application/x-space-movie-star';

export interface StarMotionSample {
  rotationY: number;
  y: number;
}

export interface StarDragPayload {
  type: 'star';
  starId: string;
  sourcePosition: Vec3;
}

export function getRatingVisual(rating: Rating): RatingVisual {
  return RATING_VISUALS[rating];
}

/** Samples motion from visible elapsed time, so hidden intervals cannot advance phase. */
export function sampleStarMotion(
  elapsedVisibleSeconds: number,
  baseY: number,
): StarMotionSample {
  if (!Number.isFinite(elapsedVisibleSeconds) || elapsedVisibleSeconds < 0) {
    throw new RangeError('elapsedVisibleSeconds must be a non-negative finite number');
  }
  if (!Number.isFinite(baseY)) {
    throw new RangeError('baseY must be finite');
  }

  return {
    rotationY: elapsedVisibleSeconds * STAR_ROTATION_RADIANS_PER_SECOND,
    y:
      baseY
      + STAR_OSCILLATION_AMPLITUDE
        * Math.sin(
          (elapsedVisibleSeconds / STAR_OSCILLATION_PERIOD_SECONDS) * Math.PI * 2,
        ),
  };
}

export function createStarDragPayload(
  starId: string,
  sourcePosition: Vec3,
): StarDragPayload {
  if (starId.length === 0) throw new RangeError('starId must not be empty');
  return {
    type: 'star',
    starId,
    sourcePosition: { ...sourcePosition },
  };
}
