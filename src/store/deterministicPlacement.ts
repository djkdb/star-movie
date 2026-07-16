import type { Genre, Vec3 } from '../domain/models';

/**
 * Shared free-roaming star field. Stars are no longer clustered inside per-genre
 * galaxy spheres; every work is scattered across one wide ellipsoidal volume
 * around the origin so the sky reads as a single open starfield rather than
 * genre-colored regions. The volume is wider than it is deep to match the
 * default wide camera framing.
 */
export const STAR_FIELD_CENTER: Vec3 = Object.freeze({ x: 0, y: 2, z: -6 });
export const STAR_FIELD_RADII: Vec3 = Object.freeze({ x: 42, y: 24, z: 30 });

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function xorshift32(state: number): number {
  let next = state;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

/**
 * Maps a stable work UUID to a uniform point inside the shared star-field
 * ellipsoid. Genre still perturbs the seed so the same work keeps a stable
 * position, but genres no longer occupy separate regions of space.
 */
export function createDeterministicStarPosition(
  starId: string,
  genre: Genre,
): Vec3 {
  let state = hashSeed(`${starId}:${genre}`);
  const next = (): number => {
    state = xorshift32(state);
    return state / 0x1_0000_0000;
  };

  // Uniform point in the unit sphere, then stretched into the field ellipsoid.
  const radius = Math.cbrt(next());
  const theta = 2 * Math.PI * next();
  const cosinePhi = 2 * next() - 1;
  const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));

  const unitX = radius * sinePhi * Math.cos(theta);
  const unitY = radius * cosinePhi;
  const unitZ = radius * sinePhi * Math.sin(theta);

  return {
    x: STAR_FIELD_CENTER.x + unitX * STAR_FIELD_RADII.x,
    y: STAR_FIELD_CENTER.y + unitY * STAR_FIELD_RADII.y,
    z: STAR_FIELD_CENTER.z + unitZ * STAR_FIELD_RADII.z,
  };
}
