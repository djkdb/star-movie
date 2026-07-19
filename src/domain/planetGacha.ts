import type { OwnedPlanet, PlanetCollection, PlanetRarity } from './models';
import {
  PLANET_RARITIES,
  RARITY_ODDS,
  TOTAL_SPECIES_COUNT,
  getPlanetSpecies,
  speciesByRarity,
  type PlanetSpecies,
} from './planetCatalog';

/** Stars required to earn one gacha ticket. */
export const STARS_PER_TICKET = 5;

export function ticketsEarned(lifetimeStarsAdded: number): number {
  if (!Number.isFinite(lifetimeStarsAdded) || lifetimeStarsAdded <= 0) return 0;
  return Math.floor(lifetimeStarsAdded / STARS_PER_TICKET);
}

/** Tickets earned but not yet spent on a pull. */
export function availableTickets(collection: PlanetCollection): number {
  return Math.max(
    0,
    ticketsEarned(collection.lifetimeStarsAdded) - collection.pullsPerformed,
  );
}

/** Stars remaining until the next ticket is earned (1..STARS_PER_TICKET). */
export function starsUntilNextTicket(lifetimeStarsAdded: number): number {
  const remainder = Math.max(0, Math.floor(lifetimeStarsAdded)) % STARS_PER_TICKET;
  return STARS_PER_TICKET - remainder;
}

/** Maps a uniform roll in [0, 1) to a rarity using the cumulative odds. */
export function rollRarity(roll: number): PlanetRarity {
  const clamped = Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0;
  let cumulative = 0;
  for (const rarity of PLANET_RARITIES) {
    cumulative += RARITY_ODDS[rarity];
    if (clamped < cumulative) return rarity;
  }
  return 'common';
}

/**
 * Resolves a pull to a concrete species from two uniform rolls: the first picks
 * the rarity tier, the second picks a species uniformly within that tier.
 */
export function resolvePulledSpecies(
  rarityRoll: number,
  speciesRoll: number,
): PlanetSpecies {
  const rarity = rollRarity(rarityRoll);
  const pool = speciesByRarity(rarity);
  if (pool.length === 0) {
    // A tier must always have members; fall back to common defensively.
    const common = speciesByRarity('common');
    return common[0]!;
  }
  const clamped = Number.isFinite(speciesRoll)
    ? Math.min(0.999999999, Math.max(0, speciesRoll))
    : 0;
  const index = Math.min(pool.length - 1, Math.floor(clamped * pool.length));
  return pool[index]!;
}

export interface PullPlanetInput {
  collection: PlanetCollection;
  /** Uniform [0,1) for rarity, species, and orbit seed respectively. */
  rarityRoll: number;
  speciesRoll: number;
  orbitRoll: number;
  planetId: string;
  acquiredAt: string;
}

export interface PullPlanetResult {
  collection: PlanetCollection;
  planet: OwnedPlanet;
  speciesId: string;
  rarity: PlanetRarity;
  /** True when this species had not been owned before this pull. */
  isNewSpecies: boolean;
}

/**
 * Performs one gacha pull, returning the updated collection and the drawn
 * planet. Throws when no ticket is available; callers guard with
 * {@link availableTickets}.
 */
export function pullPlanet(input: PullPlanetInput): PullPlanetResult {
  if (availableTickets(input.collection) < 1) {
    throw new Error('No gacha ticket available for a pull');
  }
  const species = resolvePulledSpecies(input.rarityRoll, input.speciesRoll);
  const orbitSeed =
    Math.floor(
      (Number.isFinite(input.orbitRoll) ? Math.min(0.999999999, Math.max(0, input.orbitRoll)) : 0) *
        0x1_0000_0000,
    ) >>> 0;

  const planet: OwnedPlanet = {
    id: input.planetId,
    speciesId: species.id,
    acquiredAt: input.acquiredAt,
    orbitSeed,
  };

  const isNewSpecies = !input.collection.planets.some(
    (owned) => owned.speciesId === species.id,
  );

  return {
    collection: {
      lifetimeStarsAdded: input.collection.lifetimeStarsAdded,
      pullsPerformed: input.collection.pullsPerformed + 1,
      planets: [...input.collection.planets, planet],
    },
    planet,
    speciesId: species.id,
    rarity: species.rarity,
    isNewSpecies,
  };
}

export interface SpeciesOwnership {
  species: PlanetSpecies;
  count: number;
}

/** Counts owned copies per species id. */
export function ownedCountBySpecies(
  collection: PlanetCollection,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const planet of collection.planets) {
    counts.set(planet.speciesId, (counts.get(planet.speciesId) ?? 0) + 1);
  }
  return counts;
}

/** Distinct species collected, over the full catalog (the dex completion rate). */
export function collectionRate(collection: PlanetCollection): {
  collected: number;
  total: number;
} {
  const distinct = new Set(
    collection.planets
      .map((planet) => planet.speciesId)
      .filter((speciesId) => getPlanetSpecies(speciesId) !== undefined),
  );
  return { collected: distinct.size, total: TOTAL_SPECIES_COUNT };
}
