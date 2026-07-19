import { describe, expect, it } from 'vitest';

import type { PlanetCollection } from './models';
import { RARITY_ODDS, getPlanetSpecies } from './planetCatalog';
import {
  availableTickets,
  collectionRate,
  ownedCountBySpecies,
  pullPlanet,
  resolvePulledSpecies,
  rollRarity,
  starsUntilNextTicket,
  ticketsEarned,
} from './planetGacha';

function emptyCollection(lifetimeStarsAdded = 0, pullsPerformed = 0): PlanetCollection {
  return { lifetimeStarsAdded, pullsPerformed, planets: [] };
}

describe('ticket economy', () => {
  it('earns one ticket per five stars added', () => {
    expect(ticketsEarned(0)).toBe(0);
    expect(ticketsEarned(4)).toBe(0);
    expect(ticketsEarned(5)).toBe(1);
    expect(ticketsEarned(14)).toBe(2);
    expect(ticketsEarned(15)).toBe(3);
  });

  it('subtracts performed pulls from earned tickets', () => {
    expect(availableTickets(emptyCollection(15, 1))).toBe(2);
    expect(availableTickets(emptyCollection(15, 3))).toBe(0);
    // Never negative even if data is inconsistent.
    expect(availableTickets(emptyCollection(5, 4))).toBe(0);
  });

  it('reports stars remaining until the next ticket', () => {
    expect(starsUntilNextTicket(0)).toBe(5);
    expect(starsUntilNextTicket(3)).toBe(2);
    expect(starsUntilNextTicket(5)).toBe(5);
    expect(starsUntilNextTicket(6)).toBe(4);
  });
});

describe('rarity rolls', () => {
  it('maps roll ranges to the cumulative rarity bands', () => {
    expect(rollRarity(0)).toBe('common');
    expect(rollRarity(0.59)).toBe('common');
    expect(rollRarity(0.61)).toBe('rare');
    expect(rollRarity(0.6 + 0.27 - 0.001)).toBe('rare');
    expect(rollRarity(0.9)).toBe('epic');
    expect(rollRarity(0.98)).toBe('legendary');
    expect(rollRarity(1)).toBe('legendary');
  });

  it('honors the tier boundaries exactly at the cumulative edges', () => {
    // Just below the legendary threshold stays epic; at/above is legendary.
    const epicUpper = RARITY_ODDS.common + RARITY_ODDS.rare + RARITY_ODDS.epic;
    expect(rollRarity(epicUpper - 1e-6)).toBe('epic');
    expect(rollRarity(epicUpper + 1e-6)).toBe('legendary');
  });

  it('resolves a species within the rolled tier', () => {
    const legendary = resolvePulledSpecies(0.99, 0);
    expect(legendary.rarity).toBe('legendary');
    const common = resolvePulledSpecies(0, 0.5);
    expect(common.rarity).toBe('common');
  });
});

describe('pullPlanet', () => {
  it('requires a ticket', () => {
    expect(() =>
      pullPlanet({
        collection: emptyCollection(4, 0),
        rarityRoll: 0,
        speciesRoll: 0,
        orbitRoll: 0,
        planetId: 'p1',
        acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
    ).toThrow(/ticket/i);
  });

  it('spends a ticket, appends the planet, and flags new species', () => {
    const result = pullPlanet({
      collection: emptyCollection(10, 0),
      rarityRoll: 0.99,
      speciesRoll: 0,
      orbitRoll: 0.42,
      planetId: 'p1',
      acquiredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(result.collection.pullsPerformed).toBe(1);
    expect(result.collection.planets).toHaveLength(1);
    expect(result.planet.id).toBe('p1');
    expect(getPlanetSpecies(result.speciesId)).toBeDefined();
    expect(result.isNewSpecies).toBe(true);
    expect(Number.isInteger(result.planet.orbitSeed)).toBe(true);
    expect(result.planet.orbitSeed).toBeGreaterThanOrEqual(0);

    // Pulling the same species again reports it as a duplicate.
    const dup = pullPlanet({
      collection: result.collection,
      rarityRoll: 0.99,
      speciesRoll: 0,
      orbitRoll: 0.1,
      planetId: 'p2',
      acquiredAt: '2025-01-02T00:00:00.000Z',
    });
    expect(dup.isNewSpecies).toBe(false);
    expect(dup.collection.planets).toHaveLength(2);
  });

  it('does not mutate the input collection', () => {
    const collection = emptyCollection(10, 0);
    pullPlanet({
      collection,
      rarityRoll: 0.1,
      speciesRoll: 0.1,
      orbitRoll: 0.1,
      planetId: 'p1',
      acquiredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(collection.planets).toHaveLength(0);
    expect(collection.pullsPerformed).toBe(0);
  });
});

describe('collection summaries', () => {
  it('counts owned copies and dex completion', () => {
    let collection = emptyCollection(30, 0);
    for (let i = 0; i < 3; i += 1) {
      collection = pullPlanet({
        collection,
        rarityRoll: 0,
        speciesRoll: 0,
        orbitRoll: 0,
        planetId: `p${i}`,
        acquiredAt: '2025-01-01T00:00:00.000Z',
      }).collection;
    }
    const counts = ownedCountBySpecies(collection);
    // Same rolls => same species => three copies of one species.
    expect([...counts.values()].reduce((sum, value) => sum + value, 0)).toBe(3);
    const rate = collectionRate(collection);
    expect(rate.collected).toBe(1);
    expect(rate.total).toBe(28);
  });
});
