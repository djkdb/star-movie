import { describe, expect, it } from 'vitest';

import type { OwnedPlanet, PlanetRarity } from '../domain/models';
import { STAR_FIELD_RADII } from '../store/deterministicPlacement';
import {
  PLANET_MAX_RADIUS,
  PLANET_MIN_RADIUS,
  PLANET_RARITY_PLACEMENT,
  planetOrbitFromSeed,
  planetOrbitPosition,
  resolvePlanetVisual,
} from './planetVisualModel';

const RARITIES: readonly PlanetRarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Half-angle a body of `size` subtends when viewed from `radius` away. */
function apparentSize(size: number, radius: number): number {
  return size / radius;
}

describe('planet orbit model', () => {
  it('is deterministic for a given seed', () => {
    expect(planetOrbitFromSeed(12345, 'rare')).toEqual(planetOrbitFromSeed(12345, 'rare'));
  });

  it('keeps every rarity inside its own distance shell', () => {
    for (const rarity of RARITIES) {
      const placement = PLANET_RARITY_PLACEMENT[rarity];
      for (let seed = 1; seed <= 500; seed += 7) {
        const orbit = planetOrbitFromSeed(seed, rarity);
        expect(orbit.radius).toBeGreaterThanOrEqual(placement.minRadius);
        expect(orbit.radius).toBeLessThanOrEqual(placement.maxRadius);
      }
    }
  });

  it('orders the shells so rarer worlds hang nearer the viewer', () => {
    expect(PLANET_RARITY_PLACEMENT.legendary.maxRadius)
      .toBeLessThan(PLANET_RARITY_PLACEMENT.epic.minRadius);
    expect(PLANET_RARITY_PLACEMENT.epic.maxRadius)
      .toBeLessThan(PLANET_RARITY_PLACEMENT.rare.minRadius);
    expect(PLANET_RARITY_PLACEMENT.rare.maxRadius)
      .toBeLessThan(PLANET_RARITY_PLACEMENT.common.minRadius);
  });

  it('keeps every shell clear of the work star field and inside camera reach', () => {
    const fieldReach = Math.max(STAR_FIELD_RADII.x, STAR_FIELD_RADII.y, STAR_FIELD_RADII.z);
    for (const rarity of RARITIES) {
      const { minRadius, maxRadius, size } = PLANET_RARITY_PLACEMENT[rarity];
      // A planet never intrudes on the stars that represent works...
      expect(minRadius - size).toBeGreaterThan(fieldReach);
      // ...and never sits beyond where the camera can travel.
      expect(maxRadius + size).toBeLessThan(900);
    }
  });

  it('never lets a world eclipse the background black hole at closest approach', () => {
    // The home camera sits 80 units out, so a world dead ahead is only
    // (minRadius - 80) away, and a ring covers about twice the body radius.
    // The background hole spans roughly 36 degrees; nothing may rival it.
    const HOME_CAMERA_DISTANCE = 80;
    const RING_FOOTPRINT = 2;
    const BLACKHOLE_DEGREES = 36;

    for (const rarity of RARITIES) {
      const { minRadius, size } = PLANET_RARITY_PLACEMENT[rarity];
      const closest = minRadius - HOME_CAMERA_DISTANCE;
      const degrees =
        (2 * Math.atan((size * RING_FOOTPRINT) / closest) * 180) / Math.PI;
      expect(degrees).toBeLessThan(BLACKHOLE_DEGREES * 0.6);
    }
  });

  it('makes rarity legible as apparent size, rarest largest', () => {
    // Compared at each shell's midpoint, apparent size must fall with rarity.
    const midpointApparent = (rarity: PlanetRarity) => {
      const { minRadius, maxRadius, size } = PLANET_RARITY_PLACEMENT[rarity];
      return apparentSize(size, (minRadius + maxRadius) / 2);
    };
    const legendary = midpointApparent('legendary');
    const epic = midpointApparent('epic');
    const rare = midpointApparent('rare');
    const common = midpointApparent('common');

    expect(legendary).toBeGreaterThan(epic);
    expect(epic).toBeGreaterThan(rare);
    expect(rare).toBeGreaterThan(common);
    // The spread is dramatic enough to read at a glance, not a subtle nudge.
    expect(legendary / common).toBeGreaterThan(8);
  });

  it('preserves the orbit radius as distance from the origin at any time', () => {
    const orbit = planetOrbitFromSeed(98765, 'epic');
    for (const time of [0, 3.5, 12, 40]) {
      const [x, y, z] = planetOrbitPosition(orbit, time);
      expect(Math.hypot(x, y, z)).toBeCloseTo(orbit.radius, 6);
    }
  });

  it('scales body size up with rarity on the same seed', () => {
    const common = planetOrbitFromSeed(42, 'common');
    const legendary = planetOrbitFromSeed(42, 'legendary');
    expect(legendary.size).toBeGreaterThan(common.size);
  });

  it('drifts distant worlds slowly enough to read as landmarks', () => {
    for (const rarity of RARITIES) {
      for (let seed = 3; seed <= 200; seed += 11) {
        const orbit = planetOrbitFromSeed(seed, rarity);
        // A full lap takes minutes, never a distracting sweep.
        const periodSeconds = (Math.PI * 2) / Math.abs(orbit.angularSpeed);
        expect(periodSeconds).toBeGreaterThan(600);
        expect(orbit.radius).toBeGreaterThanOrEqual(PLANET_MIN_RADIUS);
        expect(orbit.radius).toBeLessThanOrEqual(PLANET_MAX_RADIUS);
      }
    }
  });
});

describe('resolvePlanetVisual', () => {
  const planet = (speciesId: string): OwnedPlanet => ({
    id: 'p1',
    speciesId,
    acquiredAt: '2025-01-01T00:00:00.000Z',
    orbitSeed: 777,
  });

  it('resolves a known species to a species + orbit', () => {
    const visual = resolvePlanetVisual(planet('verde'));
    expect(visual).not.toBeNull();
    expect(visual?.species.id).toBe('verde');
  });

  it('returns null for an unknown species', () => {
    expect(resolvePlanetVisual(planet('does-not-exist'))).toBeNull();
  });
});
