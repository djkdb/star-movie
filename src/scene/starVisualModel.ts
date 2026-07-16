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
 * Per-axis free-roaming drift amplitude (units). Each axis sums a slow primary
 * wave and a faster secondary wave whose weights add to 1, so the per-axis
 * offset stays within ±A and the total wander is bounded by A·√3 ≈ 4.16 units.
 * The two incommensurate frequencies keep the path from visibly repeating, so
 * stars appear to roam the field freely rather than orbit a fixed point.
 */
export const STAR_DRIFT_AMPLITUDE = 2.4;
export const STAR_DRIFT_PRIMARY_WEIGHT = 0.62;
export const STAR_DRIFT_SECONDARY_WEIGHT = 0.38;
export const STAR_DRIFT_ANGULAR_FREQUENCIES = {
  x: 0.09,
  y: 0.108,
  z: 0.123,
} as const;
export const STAR_DRIFT_SECONDARY_FREQUENCIES = {
  x: 0.211,
  y: 0.187,
  z: 0.164,
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
function driftAxis(
  elapsedVisibleSeconds: number,
  phaseSeed: number,
  primaryFrequency: number,
  secondaryFrequency: number,
  phaseOffset: number,
): number {
  const primary = Math.sin(
    primaryFrequency * elapsedVisibleSeconds + phaseSeed + phaseOffset,
  );
  const secondary = Math.sin(
    secondaryFrequency * elapsedVisibleSeconds + phaseSeed * 1.7 + phaseOffset,
  );
  return (
    STAR_DRIFT_AMPLITUDE
    * (STAR_DRIFT_PRIMARY_WEIGHT * primary + STAR_DRIFT_SECONDARY_WEIGHT * secondary)
  );
}

export function sampleStarDriftOffset(
  elapsedVisibleSeconds: number,
  phaseSeed: number,
): Vec3 {
  assertDriftInputs(elapsedVisibleSeconds, phaseSeed);
  return {
    x: driftAxis(
      elapsedVisibleSeconds,
      phaseSeed,
      STAR_DRIFT_ANGULAR_FREQUENCIES.x,
      STAR_DRIFT_SECONDARY_FREQUENCIES.x,
      STAR_DRIFT_AXIS_PHASE_OFFSETS.x,
    ),
    y: driftAxis(
      elapsedVisibleSeconds,
      phaseSeed,
      STAR_DRIFT_ANGULAR_FREQUENCIES.y,
      STAR_DRIFT_SECONDARY_FREQUENCIES.y,
      STAR_DRIFT_AXIS_PHASE_OFFSETS.y,
    ),
    z: driftAxis(
      elapsedVisibleSeconds,
      phaseSeed,
      STAR_DRIFT_ANGULAR_FREQUENCIES.z,
      STAR_DRIFT_SECONDARY_FREQUENCIES.z,
      STAR_DRIFT_AXIS_PHASE_OFFSETS.z,
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
