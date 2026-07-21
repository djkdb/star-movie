import { describe, expect, it } from 'vitest';

import {
  GALAXY_CORE_RADIUS,
  GALAXY_MAX_RADIUS,
  GALAXY_ORBITAL_SPEED,
  createGalaxySeedData,
  galaxyOrbitalSpeed,
} from './spiralGalaxyModel';

describe('galaxyOrbitalSpeed', () => {
  it('rises linearly through the rigid core', () => {
    expect(galaxyOrbitalSpeed(0)).toBe(0);
    expect(galaxyOrbitalSpeed(GALAXY_CORE_RADIUS / 2)).toBeCloseTo(GALAXY_ORBITAL_SPEED / 2);
  });

  it('flattens to the constant disk speed beyond the core', () => {
    expect(galaxyOrbitalSpeed(GALAXY_CORE_RADIUS)).toBeCloseTo(GALAXY_ORBITAL_SPEED);
    expect(galaxyOrbitalSpeed(GALAXY_MAX_RADIUS)).toBeCloseTo(GALAXY_ORBITAL_SPEED);
  });
});

describe('createGalaxySeedData', () => {
  const size = 16;
  const count = size * size;

  it('fills every packed array to the particle count', () => {
    const seed = createGalaxySeedData(size);
    expect(seed.positions).toHaveLength(count * 4);
    expect(seed.velocities).toHaveLength(count * 4);
    expect(seed.colors).toHaveLength(count * 3);
    expect(seed.sizes).toHaveLength(count);
    expect(seed.references).toHaveLength(count * 2);
  });

  it('is deterministic for a given size and seed', () => {
    const a = createGalaxySeedData(size, 42);
    const b = createGalaxySeedData(size, 42);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.velocities)).toEqual(Array.from(b.velocities));
  });

  it('seeds every star within the disk radius', () => {
    const seed = createGalaxySeedData(size);
    for (let i = 0; i < count; i += 1) {
      const radius = Math.hypot(seed.positions[i * 4]!, seed.positions[i * 4 + 1]!);
      expect(radius).toBeLessThanOrEqual(GALAXY_MAX_RADIUS * 1.05);
    }
  });

  it('gives each star a tangential circular-orbit velocity', () => {
    const seed = createGalaxySeedData(size);
    for (let i = 0; i < count; i += 1) {
      const px = seed.positions[i * 4]!;
      const py = seed.positions[i * 4 + 1]!;
      const vx = seed.velocities[i * 4]!;
      const vy = seed.velocities[i * 4 + 1]!;
      const radius = Math.hypot(px, py);
      if (radius < 1) continue;
      // Velocity is perpendicular to the radius (dot product ~ 0).
      const dot = px * vx + py * vy;
      expect(Math.abs(dot) / radius).toBeLessThan(1e-3);
      // ...and its magnitude matches the rotation curve at that radius.
      expect(Math.hypot(vx, vy)).toBeCloseTo(galaxyOrbitalSpeed(radius), 4);
      // The disk stays flat: no out-of-plane velocity.
      expect(seed.velocities[i * 4 + 2]).toBe(0);
    }
  });

  it('maps references onto the texel grid', () => {
    const seed = createGalaxySeedData(size);
    for (let i = 0; i < count; i += 1) {
      const u = seed.references[i * 2]!;
      const v = seed.references[i * 2 + 1]!;
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});
