import type { OwnedPlanet, PlanetRarity } from '../domain/models';
import { getPlanetSpecies, type PlanetSpecies } from '../domain/planetCatalog';

/**
 * Rarity decides where a planet hangs and how large it is, so how rare a pull
 * was is felt spatially instead of only being read off a chip.
 *
 * Every shell sits well beyond the work star field (radius <= 42) and inside
 * the camera's reach (SPACE_CAMERA_MAX_DISTANCE 900).
 *
 * Sizes are calibrated against the *closest* approach, not the shell radius:
 * the home camera sits 80 units out, so a world directly ahead is only
 * `minRadius - 80` away, and a ringed species covers roughly twice its body
 * radius. Calibrating from the shell centre instead made legendaries balloon
 * until they eclipsed the background black hole. Budgeted this way the hole
 * (~36deg across) stays the sky's dominant landmark:
 *
 *   worst-case full angular size — legendary ~10deg (ringed ~19deg) ·
 *   epic ~4.6deg · rare ~2.1deg · common ~0.9deg
 */
export interface PlanetRarityPlacement {
  /** Inclusive distance-from-origin band this rarity occupies. */
  minRadius: number;
  maxRadius: number;
  /** Body radius in world units, before per-planet jitter. */
  size: number;
}

export const PLANET_RARITY_PLACEMENT: Readonly<
  Record<PlanetRarity, PlanetRarityPlacement>
> = {
  legendary: { minRadius: 300, maxRadius: 360, size: 20 },
  epic: { minRadius: 380, maxRadius: 440, size: 12 },
  rare: { minRadius: 460, maxRadius: 530, size: 7 },
  common: { minRadius: 550, maxRadius: 620, size: 3.6 },
};

/** Nearest and farthest any planet may sit, across every rarity. */
export const PLANET_MIN_RADIUS = PLANET_RARITY_PLACEMENT.legendary.minRadius;
export const PLANET_MAX_RADIUS = PLANET_RARITY_PLACEMENT.common.maxRadius;

/**
 * Angular speed of the innermost shell. Distant worlds are scaled down from
 * this so they read as fixed landmarks of your sky that drift over minutes;
 * their visible life comes from axial spin, not from racing across the view.
 */
const PLANET_BASE_ANGULAR_SPEED = 0.003;
const PLANET_ANGULAR_SPEED_JITTER = 0.005;

export interface PlanetOrbit {
  radius: number;
  /** Orbit-plane tilt (radians). */
  inclination: number;
  /** Rotation of the orbit plane about Y (radians). */
  ascendingNode: number;
  /** Starting angle along the orbit (radians). */
  phase: number;
  /** Angular speed (radians/second); sign encodes direction. */
  angularSpeed: number;
  /** Planet body radius in world units. */
  size: number;
  /** Self-rotation speed (radians/second). */
  spinSpeed: number;
}

const TWO_PI = Math.PI * 2;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** Deterministic orbit derived purely from a planet's stored seed and rarity. */
export function planetOrbitFromSeed(
  orbitSeed: number,
  rarity: PlanetRarity = 'common',
): PlanetOrbit {
  const random = seededRandom(orbitSeed);
  const placement = PLANET_RARITY_PLACEMENT[rarity];
  const radius =
    placement.minRadius +
    random() * (placement.maxRadius - placement.minRadius);
  // Full tilt range: the shells are spheres of possibility, not one flat belt,
  // so worlds are found above and below as well as around.
  const inclination = (random() - 0.5) * Math.PI;
  const ascendingNode = random() * TWO_PI;
  const phase = random() * TWO_PI;
  const direction = random() < 0.5 ? -1 : 1;
  // Farther shells sweep proportionally slower, so every world drifts at a
  // similar gentle pace across the sky rather than the distant ones racing.
  const angularSpeed =
    direction *
    (PLANET_BASE_ANGULAR_SPEED + random() * PLANET_ANGULAR_SPEED_JITTER) *
    (PLANET_MIN_RADIUS / radius);
  const spinSpeed = 0.15 + random() * 0.4;
  const size = placement.size * (0.85 + random() * 0.3);
  return {
    radius,
    inclination,
    ascendingNode,
    phase,
    angularSpeed,
    size,
    spinSpeed,
  };
}

/** World-space position of a planet on its inclined orbit at a given time. */
export function planetOrbitPosition(
  orbit: PlanetOrbit,
  elapsedSeconds: number,
): readonly [number, number, number] {
  const angle = orbit.phase + elapsedSeconds * orbit.angularSpeed;
  const x = Math.cos(angle) * orbit.radius;
  const z = Math.sin(angle) * orbit.radius;

  // Incline the flat orbit about the X axis...
  const y1 = -z * Math.sin(orbit.inclination);
  const z1 = z * Math.cos(orbit.inclination);

  // ...then swing the plane around Y by the ascending node.
  const cosNode = Math.cos(orbit.ascendingNode);
  const sinNode = Math.sin(orbit.ascendingNode);
  const x2 = x * cosNode + z1 * sinNode;
  const z2 = -x * sinNode + z1 * cosNode;
  return [x2, y1, z2];
}

export interface PlanetVisual {
  species: PlanetSpecies;
  orbit: PlanetOrbit;
}

/** Resolves an owned planet to its species + deterministic orbit, or null. */
export function resolvePlanetVisual(planet: OwnedPlanet): PlanetVisual | null {
  const species = getPlanetSpecies(planet.speciesId);
  if (species === undefined) return null;
  return { species, orbit: planetOrbitFromSeed(planet.orbitSeed, species.rarity) };
}
