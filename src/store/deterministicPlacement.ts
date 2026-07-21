import type { Genre, Vec3 } from '../domain/models';

/**
 * Radius of the sphere new stars are scattered across. Chosen so the whole
 * field sits comfortably inside the default camera framing while spreading
 * stars across the entire viewable range rather than clustering them by genre.
 */
export const STAR_FIELD_RADIUS = 48;

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
 * Maps a stable work UUID (and its genre, for extra seed variety) to a uniform
 * point inside the whole star field sphere. Placement is intentionally
 * independent of genre so stars scatter freely across the entire range; genre
 * and director grouping is expressed through constellations, not position. No
 * mutable random source participates, so a work always lands at the same spot.
 */
export function createDeterministicStarPosition(
  starId: string,
  genre: Genre,
  fieldRadius: number = STAR_FIELD_RADIUS,
): Vec3 {
  let state = hashSeed(`${starId}:${genre}`);
  const next = (): number => {
    state = xorshift32(state);
    return state / 0x1_0000_0000;
  };

  const radius = fieldRadius * Math.cbrt(next());
  const theta = 2 * Math.PI * next();
  const cosinePhi = 2 * next() - 1;
  const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));

  return {
    x: radius * sinePhi * Math.cos(theta),
    y: radius * cosinePhi,
    z: radius * sinePhi * Math.sin(theta),
  };
}
