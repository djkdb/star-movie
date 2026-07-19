import type { OwnedPlanet, PlanetRarity } from '../domain/models';
import { getPlanetSpecies, type PlanetSpecies } from '../domain/planetCatalog';

/** Inner/outer bounds of the belt the collected planets orbit within. */
export const PLANET_BELT_MIN_RADIUS = 22;
export const PLANET_BELT_MAX_RADIUS = 42;

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

/** Bigger, statelier bodies for higher rarities — collected planets read as
 *  prominent hero worlds rather than distant specks. */
const RARITY_SIZE: Readonly<Record<PlanetRarity, number>> = {
  common: 1.6,
  rare: 2.1,
  epic: 2.8,
  legendary: 3.6,
};

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
  const radius =
    PLANET_BELT_MIN_RADIUS +
    random() * (PLANET_BELT_MAX_RADIUS - PLANET_BELT_MIN_RADIUS);
  const inclination = (random() - 0.5) * 0.9;
  const ascendingNode = random() * TWO_PI;
  const phase = random() * TWO_PI;
  const direction = random() < 0.5 ? -1 : 1;
  const angularSpeed = direction * (0.04 + random() * 0.1);
  const spinSpeed = 0.15 + random() * 0.4;
  const size = RARITY_SIZE[rarity] * (0.85 + random() * 0.3);
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
