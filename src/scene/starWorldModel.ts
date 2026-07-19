import type { Star } from '../domain/models';
import type { PlanetSurfacePattern } from '../domain/planetCatalog';
import type { SurfaceSpec } from './planetSurfaceTextures';
import { GENRE_STAR_HUES, mixHexColor } from './starVisualModel';

/**
 * When a star is selected it "blooms" into a small, inspectable world. Its look
 * is derived deterministically from the work: the genre sets the palette, the
 * identity picks a surface pattern and variant, and the rating drives size, glow,
 * and whether it earns a ring — so every work becomes its own recognizable planet
 * without needing stored art.
 */
export interface StarWorldRing {
  color: string;
  innerScale: number;
  outerScale: number;
}

export interface StarWorldVisual {
  spec: SurfaceSpec;
  /** Body radius in world units. */
  size: number;
  atmosphere: string;
  emissiveIntensity: number;
  ring?: StarWorldRing;
}

const WORLD_PATTERNS: readonly PlanetSurfacePattern[] = [
  'blotches',
  'swirl',
  'bands',
  'marble',
  'poles',
  'spots',
];

function hashStarId(starId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < starId.length; index += 1) {
    hash ^= starId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getStarWorldVisual(star: Star): StarWorldVisual {
  if (star.id.length === 0) throw new RangeError('star id must not be empty');
  const base = GENRE_STAR_HUES[star.genre];
  const hash = hashStarId(star.id);
  const pattern = WORLD_PATTERNS[hash % WORLD_PATTERNS.length]!;
  const variant = (hash >>> 8) % 6;

  return {
    spec: {
      // Namespaced so it can never collide with a planet-catalog species id.
      id: `starworld:${star.genre}:${pattern}:${variant}`,
      pattern,
      baseColor: base,
      accentColor: mixHexColor(base, '#ffffff', 0.5),
      emissiveColor: mixHexColor(base, '#000000', 0.45),
    },
    // Higher-rated works bloom into larger, brighter worlds.
    size: 2.3 + star.rating * 0.3,
    atmosphere: mixHexColor(base, '#ffffff', 0.35),
    emissiveIntensity: 0.22 + star.rating * 0.05,
    ring:
      star.rating >= 4
        ? {
            color: mixHexColor(base, '#ffffff', 0.6),
            innerScale: 1.5,
            outerScale: 2.2 + (star.rating - 4) * 0.4,
          }
        : undefined,
  };
}
