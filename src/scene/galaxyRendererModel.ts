import type { Galaxy, Genre, Vec3 } from '../domain/models';
import {
  buildGalaxyThemeById,
  type GalaxyPrimitive,
  type GalaxyPrimitiveKind,
} from './galaxyThemes';
import {
  DEFAULT_GALAXY_INTENSITY,
  GENRE_FILTER_TWEEN_DURATION_SECONDS,
  SELECTED_GALAXY_INTENSITY,
  UNSELECTED_GALAXY_INTENSITY,
} from './genreFilterViewModel';

/** Slow idle spin so each genre galaxy reads as a living object, not a decal. */
export const GALAXY_ROTATION_RADIANS_PER_SECOND = 0.02;
/** Intensity fades share the genre-filter tween so star dimming and galaxy
 *  brightening feel like one gesture. */
export const GALAXY_INTENSITY_TWEEN_DURATION_SECONDS = GENRE_FILTER_TWEEN_DURATION_SECONDS;

const INTENSITY_SPAN = SELECTED_GALAXY_INTENSITY - UNSELECTED_GALAXY_INTENSITY;

export type GalaxyRenderStrategy = 'line' | 'points';

/**
 * Maps each theme primitive to a render strategy: path-like shapes (including
 * prism faces, drawn as closed wireframe loops) become fat lines, while
 * volumetric clouds become point sprites. This is what makes SF read as a
 * spiral and romance as a nebula rather than every genre looking the same.
 */
export function classifyGalaxyPrimitive(kind: GalaxyPrimitiveKind): GalaxyRenderStrategy {
  switch (kind) {
    case 'spiral-arm':
    case 'asymmetric-band':
    case 'ellipse':
    case 'ring':
    case 'radial-ray':
    case 'prism-face':
      return 'line';
    case 'core-nebula':
    case 'irregular-cluster':
    case 'particles':
      return 'points';
  }
}

/** Deterministic unsigned 32-bit hash (FNV-1a) so each galaxy seeds a stable,
 *  distinct shape from its id without persisting anything. */
export function hashGalaxyId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Resolves a galaxy's target intensity under the current genre filter. With no
 * filter every galaxy sits at rest; selecting a genre ignites its galaxy and
 * dims the rest. Mirrors the star spotlight so both halves move together.
 */
export function resolveGalaxyIntensityTarget(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): number {
  if (selectedGenres.size === 0) return DEFAULT_GALAXY_INTENSITY;
  return selectedGenres.has(genre)
    ? SELECTED_GALAXY_INTENSITY
    : UNSELECTED_GALAXY_INTENSITY;
}

/** Moves `current` toward `target` so a full intensity swing completes in about
 *  one tween duration regardless of frame rate. Snaps when within one step. */
export function stepGalaxyIntensity(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  if (GALAXY_INTENSITY_TWEEN_DURATION_SECONDS <= 0) return target;
  const maxStep = (Math.max(0, deltaSeconds) / GALAXY_INTENSITY_TWEEN_DURATION_SECONDS)
    * INTENSITY_SPAN;
  const difference = target - current;
  if (Math.abs(difference) <= maxStep) return target;
  return current + Math.sign(difference) * maxStep;
}

/** Opacity actually applied to a primitive, brightened or dimmed by intensity
 *  and clamped so a boosted galaxy never exceeds full opacity. */
export function effectiveGalaxyOpacity(baseOpacity: number, intensity: number): number {
  return Math.min(1, Math.max(0, baseOpacity * intensity));
}

export interface GenreGalaxyRenderModel {
  id: string;
  genre: Genre;
  center: Vec3;
  placementRadius: number;
  primaryColor: string;
  primitives: readonly GalaxyPrimitive[];
  fallbackUsed: boolean;
}

/**
 * Builds render models for the always-present genre galaxies, skipping reward
 * galaxies (owned by the milestone renderer) and any locked entries. Geometry
 * comes from the deterministic theme builder seeded by galaxy id.
 */
export function buildGenreGalaxyRenderModels(
  galaxies: readonly Galaxy[],
): GenreGalaxyRenderModel[] {
  return galaxies.flatMap((galaxy) => {
    if (galaxy.kind.type !== 'genre' || !galaxy.unlocked) return [];
    if (galaxy.themeId === 'milestone-100-reward') return [];
    const built = buildGalaxyThemeById(galaxy.themeId, {
      radius: galaxy.placementRadius,
      seed: hashGalaxyId(galaxy.id),
    });
    return [
      {
        id: galaxy.id,
        genre: galaxy.kind.genre,
        center: galaxy.center,
        placementRadius: galaxy.placementRadius,
        primaryColor: galaxy.primaryColor,
        primitives: built.geometry.primitives,
        fallbackUsed: built.fallbackUsed,
      },
    ];
  });
}

/** Vertices as `[x, y, z]` tuples for a fat line, closing the loop when the
 *  primitive is marked closed (rings, ellipses). */
export function primitiveLinePoints(
  primitive: GalaxyPrimitive,
): [number, number, number][] {
  const points = primitive.vertices.map(
    (vertex) => [vertex.x, vertex.y, vertex.z] as [number, number, number],
  );
  if (primitive.closed && points.length > 1) {
    const first = points[0]!;
    points.push([first[0], first[1], first[2]]);
  }
  return points;
}

/** Flat `Float32Array` of vertex positions for a points or mesh buffer. */
export function primitivePositions(primitive: GalaxyPrimitive): Float32Array {
  const positions = new Float32Array(primitive.vertices.length * 3);
  primitive.vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
  });
  return positions;
}
