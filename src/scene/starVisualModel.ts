import type { Genre, Rating, Star, Vec3 } from '../domain/models';
import { BLACKHOLE_POSITION } from './blackholeModel';

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
/** Frequencies carry a 3x speed multiplier so stars visibly roam the sky. */
export const STAR_DRIFT_ANGULAR_FREQUENCIES = {
  x: 0.27,
  y: 0.324,
  z: 0.369,
} as const;
export const STAR_DRIFT_SECONDARY_FREQUENCIES = {
  x: 0.633,
  y: 0.561,
  z: 0.492,
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

/**
 * Stellar tint palette. Loosely spectral (ice blue → white → gold → ember)
 * with a few fantasy pastels so the field reads as varied and jewel-like
 * rather than uniformly warm. Rating keeps controlling size and brightness;
 * identity controls hue.
 */
export const STAR_TINT_PALETTE = [
  '#8fb7ff', // ice blue
  '#7fd8ff', // cyan
  '#dcebff', // blue-white
  '#fff7ea', // warm white
  '#ffe9a8', // champagne
  '#ffc987', // amber
  '#ffa98c', // peach
  '#ff9fc0', // rose
  '#d3a6ff', // lilac
  '#96ecd2', // mint
] as const;

/**
 * Genre hue each star is tinted toward, mirroring the genre galaxies and
 * fireworks so the sky visibly separates into "my SF stars", "my romance
 * stars", and so on while identity still varies each individual star.
 */
export const GENRE_STAR_HUES: Readonly<Record<Genre, string>> = {
  SF: '#3B82F6',
  로맨스: '#F472B6',
  스릴러: '#DC2626',
  드라마: '#F59E0B',
  애니: '#A855F7',
  코미디: '#FDE047',
  액션: '#F97316',
  기타: '#14B8A6',
};

/** Linear blend of two hex colors; amount 0 → first, 1 → second. */
export function mixHexColor(first: string, second: string, amount: number): string {
  const a = parseInt(first.slice(1), 16);
  const b = parseInt(second.slice(1), 16);
  const clamped = Math.min(1, Math.max(0, amount));
  const channels = [16, 8, 0].map((shift) => {
    const left = (a >> shift) & 0xff;
    const right = (b >> shift) & 0xff;
    return Math.round(left + (right - left) * clamped)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

export type StarSpikeCount = 0 | 4 | 6;

export interface StarAppearance {
  /** Per-star hue; brightness still follows the rating visual. */
  color: string;
  radius: number;
  bloom: number;
  /** Soft additive halo, scaled relative to the core radius. */
  haloScale: number;
  haloOpacity: number;
  /** Diffraction-spike styling; 0 spikes = plain glow orb. */
  spikeCount: StarSpikeCount;
  spikeRotation: number;
  spikeScale: number;
}

function hashStarId(starId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < starId.length; index += 1) {
    hash ^= starId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Scales a hex color's channels toward black (amount 0) or itself (amount 1). */
function scaleHexColor(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    .map((channel) => Math.round(Math.min(255, channel * amount)))
    .map((channel) => channel.toString(16).padStart(2, '0'));
  return `#${channels.join('')}`;
}

/**
 * Deterministic per-star look: hue, halo, and spike shape all derive from the
 * stable star UUID, so a work keeps its exact appearance across sessions while
 * the field as a whole shows varied colors and silhouettes.
 */
export function getStarAppearance(
  starId: string,
  rating: Rating,
  genre?: Genre,
  rewatchCount = 0,
): StarAppearance {
  if (starId.length === 0) throw new RangeError('starId must not be empty');
  const visual = RATING_VISUALS[rating];
  const hash = hashStarId(starId);

  const tint = STAR_TINT_PALETTE[hash % STAR_TINT_PALETTE.length]!;
  // When the genre is known, pull the identity tint strongly toward the genre
  // hue so the sky reads its genre mix, while the per-star tint keeps siblings
  // of the same genre from looking identical.
  const color =
    genre === undefined ? tint : mixHexColor(GENRE_STAR_HUES[genre], tint, 0.4);
  // Roughly a quarter of stars stay plain orbs; half get classic 4-point
  // diffraction spikes; the rest sparkle with 6 points. Top-rated works always
  // blaze with the full 6-point star so a 5★ reads as a hero at a glance.
  const spikeRoll = (hash >>> 8) % 100;
  const spikeCount: StarSpikeCount =
    rating === 5 ? 6 : spikeRoll < 25 ? 0 : spikeRoll < 75 ? 4 : 6;

  // Every rewatch feeds the star a little more light, up to a gentle ceiling.
  const rewatchGlow = Math.min(Math.max(rewatchCount, 0), 5) * 0.05;

  return {
    color,
    radius: visual.radius,
    bloom: Math.min(1, visual.bloom + rewatchGlow),
    haloScale: 5 + visual.bloom * 3.5 + rewatchGlow * 2,
    haloOpacity: Math.min(0.6, 0.16 + visual.bloom * 0.3 + rewatchGlow * 0.5),
    spikeCount,
    spikeRotation: (((hash >>> 16) & 0xff) / 255) * Math.PI,
    spikeScale: 2.6 + visual.bloom * 3.2,
  };
}

/**
 * Display color for the instanced renderer: the per-star tint dimmed by rating
 * so low-rated stars fade toward the background while 5-star works blaze.
 */
export function getStarDisplayColor(
  starId: string,
  rating: Rating,
  genre?: Genre,
  rewatchCount = 0,
): string {
  const appearance = getStarAppearance(starId, rating, genre, rewatchCount);
  return scaleHexColor(appearance.color, 0.5 + appearance.bloom * 0.55);
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

/** Stars within this distance of the black hole visibly lean toward it. */
export const BLACKHOLE_GRAVITY_INFLUENCE_RADIUS = 30;
/** Maximum visual displacement (units) for a star grazing the influence edge. */
export const BLACKHOLE_GRAVITY_MAX_PULL = 2.6;

/**
 * Static gravitational lean: a bounded, deterministic offset pulling a star's
 * rendered position toward the black hole, growing quadratically as the base
 * position nears the hole. Time-independent, so it never fights the drift and
 * constellation lines can apply the identical term.
 */
export function sampleBlackholeGravityPull(
  basePosition: Vec3,
  blackholePosition: Vec3 = BLACKHOLE_POSITION,
): Vec3 {
  const towardX = blackholePosition.x - basePosition.x;
  const towardY = blackholePosition.y - basePosition.y;
  const towardZ = blackholePosition.z - basePosition.z;
  const distance = Math.hypot(towardX, towardY, towardZ);
  if (
    !Number.isFinite(distance)
    || distance === 0
    || distance >= BLACKHOLE_GRAVITY_INFLUENCE_RADIUS
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  const proximity = 1 - distance / BLACKHOLE_GRAVITY_INFLUENCE_RADIUS;
  // Never pull past the hole itself: cap by half the remaining distance.
  const pull = Math.min(
    BLACKHOLE_GRAVITY_MAX_PULL * proximity * proximity,
    distance / 2,
  );
  return {
    x: (towardX / distance) * pull,
    y: (towardY / distance) * pull,
    z: (towardZ / distance) * pull,
  };
}

/**
 * Full display offset (drift + gravitational lean) shared by both star
 * renderers and the constellation line sampler, so nothing can diverge.
 */
export function sampleStarDisplayOffset(
  basePosition: Vec3,
  elapsedVisibleSeconds: number,
  phaseSeed: number,
): Vec3 {
  const drift = sampleStarDriftOffset(elapsedVisibleSeconds, phaseSeed);
  const gravity = sampleBlackholeGravityPull(basePosition);
  return {
    x: drift.x + gravity.x,
    y: drift.y + gravity.y,
    z: drift.z + gravity.z,
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

  const offset = sampleStarDisplayOffset(
    star.position,
    elapsedVisibleSeconds,
    phaseSeed,
  );
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
