import type { Galaxy, Genre, Vec3 } from '../domain/models';

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
 * Maps a stable work UUID and genre to a uniform point inside the genre
 * galaxy's allowed sphere. No mutable random source participates.
 */
export function createDeterministicStarPosition(
  starId: string,
  genre: Genre,
  galaxy: Pick<Galaxy, 'center' | 'placementRadius'>,
): Vec3 {
  let state = hashSeed(`${starId}:${genre}`);
  const next = (): number => {
    state = xorshift32(state);
    return state / 0x1_0000_0000;
  };

  const maximumRadius = Math.min(galaxy.placementRadius, 10);
  const radius = maximumRadius * Math.cbrt(next());
  const theta = 2 * Math.PI * next();
  const cosinePhi = 2 * next() - 1;
  const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));

  return {
    x: galaxy.center.x + radius * sinePhi * Math.cos(theta),
    y: galaxy.center.y + radius * cosinePhi,
    z: galaxy.center.z + radius * sinePhi * Math.sin(theta),
  };
}
