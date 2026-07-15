import { describe, expect, it } from 'vitest';

import type { Genre, GenreGalaxyThemeId } from '../domain/models';
import {
  GALAXY_THEMES,
  GENRE_THEME_IDS,
  buildGalaxyThemeById,
  buildGalaxyThemeSafely,
  getGalaxyTheme,
  type GalaxyPrimitive,
  type GalaxyTheme,
} from './galaxyThemes';

const EXPECTED_THEMES: ReadonlyArray<{
  genre: Genre;
  id: GenreGalaxyThemeId;
  color: string;
}> = [
  { genre: 'SF', id: 'blue-spiral', color: '#3B82F6' },
  { genre: '로맨스', id: 'pink-core-nebula', color: '#F472B6' },
  { genre: '스릴러', id: 'red-asymmetric-bands', color: '#DC2626' },
  { genre: '드라마', id: 'gold-elliptical', color: '#F59E0B' },
  { genre: '애니', id: 'purple-prism', color: '#A855F7' },
  { genre: '코미디', id: 'yellow-rings', color: '#FDE047' },
  { genre: '액션', id: 'orange-burst', color: '#F97316' },
  { genre: '기타', id: 'teal-irregular-clusters', color: '#14B8A6' },
];

describe('GalaxyTheme strategies', () => {
  it('R15.1-R15.8 exposes one strategy per Genre with the required primary color', () => {
    expect(Object.keys(GALAXY_THEMES)).toHaveLength(8);

    for (const expected of EXPECTED_THEMES) {
      expect(GENRE_THEME_IDS[expected.genre]).toBe(expected.id);
      const theme = getGalaxyTheme(expected.id);
      expect(theme.genre).toBe(expected.genre);
      expect(theme.primaryColor).toBe(expected.color);
      expect(theme.uniforms()).toMatchObject({
        primaryColor: expected.color,
        primaryColorContribution: expect.any(Number),
        visibleOpacityThreshold: 0.1,
      });
    }
  });

  it('R15.1-R15.8 builds geometry whose quantitative metrics meet every Genre constraint', () => {
    const sf = getGalaxyTheme('blue-spiral').shapeMetrics();
    expect(sf.kind).toBe('spiral');
    if (sf.kind === 'spiral') {
      expect(sf.armCount).toBeGreaterThanOrEqual(2);
      expect(sf.turnsPerArm.every((turns) => turns >= 1)).toBe(true);
    }

    const romance = getGalaxyTheme('pink-core-nebula').shapeMetrics();
    expect(romance.kind).toBe('core-nebula');
    if (romance.kind === 'core-nebula') {
      expect(romance.outerParticleDensity).toBeGreaterThan(0);
      expect(romance.innerParticleDensity).toBeGreaterThanOrEqual(
        romance.outerParticleDensity * 1.5,
      );
    }

    const thriller = getGalaxyTheme('red-asymmetric-bands').shapeMetrics();
    expect(thriller.kind).toBe('asymmetric-bands');
    if (thriller.kind === 'asymmetric-bands') {
      expect(thriller.bandCount).toBeGreaterThanOrEqual(3);
      expect(thriller.lengthWidthRatios.every((ratio) => ratio >= 2)).toBe(true);
    }

    const drama = getGalaxyTheme('gold-elliptical').shapeMetrics();
    expect(drama.kind).toBe('ellipse');
    if (drama.kind === 'ellipse') {
      expect(drama.majorToMinorAxisRatio).toBeGreaterThanOrEqual(1.5);
      expect(drama.majorToMinorAxisRatio).toBeLessThanOrEqual(2.5);
    }

    const anime = getGalaxyTheme('purple-prism').shapeMetrics();
    expect(anime.kind).toBe('prism');
    if (anime.kind === 'prism') {
      expect(anime.faceCount).toBeGreaterThanOrEqual(3);
      expect(new Set(anime.normalDirections.map((normal) => JSON.stringify(normal))).size).toBe(
        anime.faceCount,
      );
    }

    const comedy = getGalaxyTheme('yellow-rings').shapeMetrics();
    expect(comedy.kind).toBe('rings');
    if (comedy.kind === 'rings') {
      expect(comedy.ringCount).toBeGreaterThanOrEqual(2);
      expect(comedy.outerToInnerDiameterRatios.every((ratio) => ratio >= 1.5)).toBe(true);
    }

    const action = getGalaxyTheme('orange-burst').shapeMetrics();
    expect(action.kind).toBe('radial-rays');
    if (action.kind === 'radial-rays') {
      expect(action.rayCount).toBeGreaterThanOrEqual(8);
      expect(action.minimumLengthToCoreRadius).toBeGreaterThanOrEqual(1.5);
    }

    const other = getGalaxyTheme('teal-irregular-clusters').shapeMetrics();
    expect(other.kind).toBe('irregular-clusters');
    if (other.kind === 'irregular-clusters') {
      expect(other.clusterCount).toBeGreaterThanOrEqual(3);
      expect(other.minimumSizeDifference).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('R15.9-R15.10 exposes primary contribution >= 50% and distinct shape signatures', () => {
    const results = EXPECTED_THEMES.map(({ id }) => buildGalaxyThemeById(id, { seed: 42 }));

    expect(new Set(results.map((result) => result.shapeMetrics.kind)).size).toBe(8);
    for (const result of results) {
      expect(result.fallbackUsed).toBe(false);
      expect(result.uniforms.primaryColorContribution).toBeGreaterThanOrEqual(0.5);
      expect(result.geometry.primitives.length).toBeGreaterThan(0);
      for (const currentPrimitive of result.geometry.primitives) {
        expect(currentPrimitive.color).toBe(result.uniforms.primaryColor);
        expect(currentPrimitive.opacity).toBeGreaterThanOrEqual(0.1);
        expect(currentPrimitive.vertices.length).toBeGreaterThan(0);
      }
    }
  });

  it('R15.11 rejects a Romance heart primitive attempt and substitutes particles', () => {
    const romance = getGalaxyTheme('pink-core-nebula');
    const heartPrimitive = {
      kind: 'heart-outline',
      color: romance.primaryColor,
      opacity: 0.8,
      vertices: [{ x: 0, y: 0, z: 0 }],
      closed: true,
    } as unknown as GalaxyPrimitive;
    const invalidRomance: GalaxyTheme = {
      ...romance,
      buildGeometry: () => ({ radius: 18, seed: 1, primitives: [heartPrimitive] }),
    };

    const result = buildGalaxyThemeSafely(invalidRomance, { seed: 1 });

    expect(result.fallbackUsed).toBe(true);
    expect(result.failureReason).toContain('heart primitives are forbidden');
    expect(result.geometry.primitives).toHaveLength(1);
    expect(result.geometry.primitives[0]).toMatchObject({
      kind: 'particles',
      monochrome: true,
      distribution: 'core-nebula',
    });
  });

  it('R15.12 applies a monochrome primary-color particle fallback without losing metrics', () => {
    const baseTheme = getGalaxyTheme('red-asymmetric-bands');
    const failedTheme: GalaxyTheme = {
      ...baseTheme,
      buildGeometry: () => {
        throw new Error('simulated material failure');
      },
    };

    const result = buildGalaxyThemeSafely(failedTheme, { radius: 12, seed: 7 }, 1.5);

    expect(result.fallbackUsed).toBe(true);
    expect(result.failureReason).toBe('simulated material failure');
    expect(result.shapeMetrics).toEqual(baseTheme.shapeMetrics({ radius: 12, seed: 7 }));
    expect(result.uniforms).toMatchObject({
      primaryColor: '#DC2626',
      primaryColorContribution: 1,
      intensity: 1.5,
    });
    expect(result.geometry.primitives).toHaveLength(1);
    expect(result.geometry.primitives[0]).toMatchObject({
      kind: 'particles',
      color: '#DC2626',
      monochrome: true,
      distribution: 'asymmetric-bands',
    });
  });
});
