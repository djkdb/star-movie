import { describe, expect, it } from 'vitest';

import type { OwnedPlanet } from '../domain/models';
import {
  PLANET_BELT_MAX_RADIUS,
  PLANET_BELT_MIN_RADIUS,
  planetOrbitFromSeed,
  planetOrbitPosition,
  resolvePlanetVisual,
} from './planetVisualModel';

describe('planet orbit model', () => {
  it('is deterministic for a given seed', () => {
    expect(planetOrbitFromSeed(12345, 'rare')).toEqual(planetOrbitFromSeed(12345, 'rare'));
  });

  it('keeps orbit radius within the belt bounds', () => {
    for (let seed = 1; seed <= 500; seed += 7) {
      const orbit = planetOrbitFromSeed(seed);
      expect(orbit.radius).toBeGreaterThanOrEqual(PLANET_BELT_MIN_RADIUS);
      expect(orbit.radius).toBeLessThanOrEqual(PLANET_BELT_MAX_RADIUS);
    }
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
