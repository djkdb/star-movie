import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Genre, GenreGalaxyThemeId, Vec3 } from '../../src/domain/models';
import {
  buildGalaxyThemeSafely,
  getGalaxyTheme,
  type BuiltGalaxyTheme,
  type GalaxyPrimitive,
  type GalaxyTheme,
  type ShapeMetrics,
} from '../../src/scene/galaxyThemes';

type StandardForm = 'native' | 'build-error' | 'empty-geometry';

const THEME_CASES: ReadonlyArray<{
  id: GenreGalaxyThemeId;
  genre: Genre;
  primaryColor: string;
}> = [
  { id: 'blue-spiral', genre: 'SF', primaryColor: '#3B82F6' },
  { id: 'pink-core-nebula', genre: '로맨스', primaryColor: '#F472B6' },
  { id: 'red-asymmetric-bands', genre: '스릴러', primaryColor: '#DC2626' },
  { id: 'gold-elliptical', genre: '드라마', primaryColor: '#F59E0B' },
  { id: 'purple-prism', genre: '애니', primaryColor: '#A855F7' },
  { id: 'yellow-rings', genre: '코미디', primaryColor: '#FDE047' },
  { id: 'orange-burst', genre: '액션', primaryColor: '#F97316' },
  { id: 'teal-irregular-clusters', genre: '기타', primaryColor: '#14B8A6' },
];

const STANDARD_FORMS: readonly StandardForm[] = [
  'native',
  'build-error',
  'empty-geometry',
];

const contextArbitrary = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  radius: fc.integer({ min: 1, max: 100 }),
});

function themeForForm(baseTheme: GalaxyTheme, form: StandardForm): GalaxyTheme {
  switch (form) {
    case 'native':
      return baseTheme;
    case 'build-error':
      return {
        ...baseTheme,
        buildGeometry: () => {
          throw new Error('generated theme build failure');
        },
      };
    case 'empty-geometry':
      return {
        ...baseTheme,
        buildGeometry: (context) => ({
          radius: context?.radius ?? 18,
          seed: context?.seed ?? 0,
          primitives: [],
        }),
      };
  }
}

function romanceHeartAttempt(baseTheme: GalaxyTheme): GalaxyTheme {
  const heartPrimitive = {
    kind: 'heart-outline',
    color: baseTheme.primaryColor,
    opacity: 0.8,
    vertices: [{ x: 0, y: 0, z: 0 }],
    closed: true,
  } as unknown as GalaxyPrimitive;

  return {
    ...baseTheme,
    buildGeometry: (context) => ({
      radius: context?.radius ?? 18,
      seed: context?.seed ?? 0,
      primitives: [heartPrimitive],
    }),
  };
}

function expectDistinctNormals(normals: readonly Vec3[], expectedCount: number): void {
  const signatures = normals.map(({ x, y, z }) => `${x.toFixed(12)}:${y.toFixed(12)}:${z.toFixed(12)}`);
  expect(new Set(signatures).size).toBe(expectedCount);
}

function expectRequiredShapeMetric(metrics: ShapeMetrics): void {
  switch (metrics.kind) {
    case 'spiral':
      expect(metrics.armCount).toBeGreaterThanOrEqual(2);
      expect(metrics.turnsPerArm).toHaveLength(metrics.armCount);
      expect(metrics.turnsPerArm.every((turns) => turns >= 1)).toBe(true);
      return;
    case 'core-nebula':
      expect(metrics.innerRadiusFraction).toBe(0.5);
      expect(metrics.outerParticleDensity).toBeGreaterThan(0);
      expect(metrics.innerParticleDensity).toBeGreaterThanOrEqual(
        metrics.outerParticleDensity * 1.5,
      );
      expect(metrics.densityRatio).toBeGreaterThanOrEqual(1.5);
      return;
    case 'asymmetric-bands':
      expect(metrics.bandCount).toBeGreaterThanOrEqual(3);
      expect(metrics.lengthWidthRatios).toHaveLength(metrics.bandCount);
      expect(metrics.lengthWidthRatios.every((ratio) => ratio >= 2)).toBe(true);
      return;
    case 'ellipse':
      expect(metrics.majorToMinorAxisRatio).toBeGreaterThanOrEqual(1.5);
      expect(metrics.majorToMinorAxisRatio).toBeLessThanOrEqual(2.5);
      return;
    case 'prism':
      expect(metrics.faceCount).toBeGreaterThanOrEqual(3);
      expect(metrics.normalDirections).toHaveLength(metrics.faceCount);
      expectDistinctNormals(metrics.normalDirections, metrics.faceCount);
      return;
    case 'rings':
      expect(metrics.ringCount).toBeGreaterThanOrEqual(2);
      expect(metrics.outerToInnerDiameterRatios).toHaveLength(metrics.ringCount);
      expect(metrics.outerToInnerDiameterRatios.every((ratio) => ratio >= 1.5)).toBe(true);
      return;
    case 'radial-rays':
      expect(metrics.rayCount).toBeGreaterThanOrEqual(8);
      expect(metrics.minimumLengthToCoreRadius).toBeGreaterThanOrEqual(1.5);
      return;
    case 'irregular-clusters':
      expect(metrics.clusterCount).toBeGreaterThanOrEqual(3);
      expect(metrics.relativeSizes).toHaveLength(metrics.clusterCount);
      expect(metrics.minimumSizeDifference).toBeGreaterThanOrEqual(0.2);
      return;
  }
}

function parseHexColor(color: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match?.[1] === undefined) throw new Error(`Invalid RGB color: ${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function isWithinPrimaryColorTolerance(color: string, primaryColor: string): boolean {
  const actual = parseHexColor(color);
  const primary = parseHexColor(primaryColor);
  return actual.every((channel, index) => Math.abs(channel - primary[index]!) <= 32);
}

function expectPrimaryColorArea(result: BuiltGalaxyTheme): void {
  const visiblePrimitives = result.geometry.primitives.filter(
    ({ opacity }) => opacity >= result.uniforms.visibleOpacityThreshold,
  );
  const visibleArea = visiblePrimitives.reduce(
    (area, currentPrimitive) => area + currentPrimitive.vertices.length,
    0,
  );
  const primaryColorArea = visiblePrimitives.reduce(
    (area, currentPrimitive) =>
      area +
      (isWithinPrimaryColorTolerance(currentPrimitive.color, result.uniforms.primaryColor)
        ? currentPrimitive.vertices.length
        : 0),
    0,
  );

  expect(visibleArea).toBeGreaterThan(0);
  expect(primaryColorArea / visibleArea).toBeGreaterThanOrEqual(0.5);
  expect(result.uniforms.primaryColorContribution).toBeGreaterThanOrEqual(0.5);
}

function expectNoHeartPrimitive(result: BuiltGalaxyTheme): void {
  expect(
    result.geometry.primitives.some(({ kind }) =>
      String(kind).toLocaleLowerCase('en-US').includes('heart'),
    ),
  ).toBe(false);
}

function expectThemeContract(
  result: BuiltGalaxyTheme,
  expected: (typeof THEME_CASES)[number],
  fallbackExpected: boolean,
): void {
  expect(result.themeId).toBe(expected.id);
  expect(result.genre).toBe(expected.genre);
  expect(result.uniforms.primaryColor).toBe(expected.primaryColor);
  expect(result.fallbackUsed).toBe(fallbackExpected);
  expect(result.geometry.primitives.length).toBeGreaterThan(0);
  expectRequiredShapeMetric(result.shapeMetrics);
  expectPrimaryColorArea(result);
  expectNoHeartPrimitive(result);

  if (fallbackExpected) {
    expect(result.geometry.primitives).toHaveLength(1);
    expect(result.geometry.primitives[0]).toMatchObject({
      kind: 'particles',
      color: expected.primaryColor,
      monochrome: true,
      distribution: result.shapeMetrics.kind,
    });
  }
}

// Feature: space-movie-archive, Property 23: Genre Galaxy 테마의 수치적 구별성
// **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12**
describe('Property 23: Genre Galaxy numerical theme distinctness', () => {
  it('R15.1-R15.12 keeps all eight shape metrics, unique signatures, no heart primitive, and at least 50% primary color area across seeds and fallbacks', () => {
    fc.assert(
      fc.property(contextArbitrary, (context) => {
        for (const form of STANDARD_FORMS) {
          const results = THEME_CASES.map((expected) => {
            const baseTheme = getGalaxyTheme(expected.id);
            const result = buildGalaxyThemeSafely(themeForForm(baseTheme, form), context);
            expectThemeContract(result, expected, form !== 'native');
            return result;
          });

          const signatures = results.map(({ shapeMetrics }) => shapeMetrics.kind);
          expect(new Set(signatures).size).toBe(THEME_CASES.length);
        }

        const romance = THEME_CASES.find(({ genre }) => genre === '로맨스');
        if (romance === undefined) throw new Error('Missing Romance theme case');
        const heartAttemptResult = buildGalaxyThemeSafely(
          romanceHeartAttempt(getGalaxyTheme(romance.id)),
          context,
        );
        expectThemeContract(heartAttemptResult, romance, true);
        expect(heartAttemptResult.failureReason).toContain('heart primitives are forbidden');
      }),
      { numRuns: 100 },
    );
  });
});
