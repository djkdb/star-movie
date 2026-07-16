import type { Rating, Star, Vec3 } from '../domain/models';

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
export const STAR_HOVER_SCALE = 1.5;
export const STAR_IDLE_SCALE = 1;
export const STAR_LABEL_FADE_SECONDS = 0.3;
export const STAR_DRAG_PAYLOAD_TYPE = 'application/x-space-movie-star';

/**
 * Per-axis drift amplitude (units). Bounds proof (design "표류 수학"):
 * magnitude ≤ A·√3 = 0.34·1.7320… = 0.5889 < 0.6 (Requirement 1.2);
 * speed ≤ A·‖ω‖ = 0.34·0.4179 = 0.1421 < 0.15 units/s (Requirements 1.3, 1.5).
 */
export const STAR_DRIFT_AMPLITUDE = 0.34;
export const STAR_DRIFT_ANGULAR_FREQUENCIES = {
  x: 0.21,
  y: 0.24,
  z: 0.27,
} as const;
export const STAR_DRIFT_AXIS_PHASE_OFFSETS = {
  x: 0,
  y: (2 * Math.PI) / 3,
  z: (4 * Math.PI) / 3,
} as const;

export interface StarRenderTransform {
  position: Vec3;
  rotationY: number;
  scale: number;
}

export interface StarDragPayload {
  type: 'star';
  starId: string;
  sourcePosition: Vec3;
}

export function getRatingVisual(rating: Rating): RatingVisual {
  return RATING_VISUALS[rating];
}

function assertDriftInputs(
  elapsedVisibleSeconds: number,
  phaseSeed: number,
): void {
  if (!Number.isFinite(elapsedVisibleSeconds) || elapsedVisibleSeconds < 0) {
    throw new RangeError('elapsedVisibleSeconds must be a non-negative finite number');
  }
  if (!Number.isFinite(phaseSeed)) {
    throw new RangeError('phaseSeed must be finite');
  }
}

/**
 * Bounded 3-axis drift offset derived deterministically from visible elapsed
 * time and a per-star phase seed. Sampling from the visibility clock means
 * hidden intervals cannot advance the phase (Requirement 1.8).
 */
export function sampleStarDriftOffset(
  elapsedVisibleSeconds: number,
  phaseSeed: number,
): Vec3 {
  assertDriftInputs(elapsedVisibleSeconds, phaseSeed);
  return {
    x:
      STAR_DRIFT_AMPLITUDE
      * Math.sin(
        STAR_DRIFT_ANGULAR_FREQUENCIES.x * elapsedVisibleSeconds
          + phaseSeed
          + STAR_DRIFT_AXIS_PHASE_OFFSETS.x,
      ),
    y:
      STAR_DRIFT_AMPLITUDE
      * Math.sin(
        STAR_DRIFT_ANGULAR_FREQUENCIES.y * elapsedVisibleSeconds
          + phaseSeed
          + STAR_DRIFT_AXIS_PHASE_OFFSETS.y,
      ),
    z:
      STAR_DRIFT_AMPLITUDE
      * Math.sin(
        STAR_DRIFT_ANGULAR_FREQUENCIES.z * elapsedVisibleSeconds
          + phaseSeed
          + STAR_DRIFT_AXIS_PHASE_OFFSETS.z,
      ),
  };
}

/**
 * Single transform shared by the individual and instanced renderers so both
 * paths drift identically. Under reduced motion the star is pinned to its
 * Base_Position with zero rotation (Requirements 1.6, 1.7).
 */
export function sampleStarRenderTransform(
  star: Star,
  elapsedVisibleSeconds: number,
  phaseSeed: number,
  hovered: boolean,
  reducedMotion: boolean,
): StarRenderTransform {
  assertDriftInputs(elapsedVisibleSeconds, phaseSeed);
  const scale = hovered ? STAR_HOVER_SCALE : STAR_IDLE_SCALE;

  if (reducedMotion) {
    return {
      position: { ...star.position },
      rotationY: 0,
      scale,
    };
  }

  const offset = sampleStarDriftOffset(elapsedVisibleSeconds, phaseSeed);
  return {
    position: {
      x: star.position.x + offset.x,
      y: star.position.y + offset.y,
      z: star.position.z + offset.z,
    },
    rotationY: elapsedVisibleSeconds * STAR_ROTATION_RADIANS_PER_SECOND,
    scale,
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
