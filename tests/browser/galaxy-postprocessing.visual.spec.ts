import { expect, test } from '@playwright/test';

interface ShapeMetrics {
  kind: string;
  armCount?: number;
  turnsPerArm?: number[];
  innerParticleDensity?: number;
  outerParticleDensity?: number;
  bandCount?: number;
  lengthWidthRatios?: number[];
  majorToMinorAxisRatio?: number;
  faceCount?: number;
  normalDirections?: Array<{ x: number; y: number; z: number }>;
  ringCount?: number;
  outerToInnerDiameterRatios?: number[];
  rayCount?: number;
  minimumLengthToCoreRadius?: number;
  clusterCount?: number;
  minimumSizeDifference?: number;
}

interface GalaxySnapshot {
  fallbackUsed: boolean;
  primaryColor: string;
  shapeMetricKind: string;
  shapeMetrics: ShapeMetrics;
  pixels: {
    visiblePixelCount: number;
    primaryColorRatio: number;
    projectedAspectRatio: number;
    maskHash: string;
  };
}

interface VisualFixtureResult {
  viewport: { width: number; height: number };
  seed: number;
  nativeGalaxies: GalaxySnapshot[];
  fallbackGalaxies: GalaxySnapshot[];
  determinism: {
    nativeMaskHashes: string[];
    repeatedNativeMaskHashes: string[];
    fallbackMaskHashes: string[];
    repeatedFallbackMaskHashes: string[];
  };
  nebulas: Array<{ opacity: number; color: string }>;
  bloom: {
    enabled: boolean;
    selectedTargetCount: number;
    eligibleTargetCount: number;
    leakedTargetKeys: string[];
    missingTargetKeys: string[];
    leakageRatio: number;
  };
}

function parseHexColor(color: string): readonly [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function expectRequiredShapeMetric(metrics: ShapeMetrics): void {
  switch (metrics.kind) {
    case 'spiral':
      expect(metrics.armCount).toBeGreaterThanOrEqual(2);
      expect(metrics.turnsPerArm?.every((turns) => turns >= 1)).toBe(true);
      break;
    case 'core-nebula':
      expect(metrics.outerParticleDensity).toBeGreaterThan(0);
      expect(metrics.innerParticleDensity).toBeGreaterThanOrEqual(
        (metrics.outerParticleDensity ?? Number.POSITIVE_INFINITY) * 1.5,
      );
      break;
    case 'asymmetric-bands':
      expect(metrics.bandCount).toBeGreaterThanOrEqual(3);
      expect(metrics.lengthWidthRatios?.every((ratio) => ratio >= 2)).toBe(true);
      break;
    case 'ellipse':
      expect(metrics.majorToMinorAxisRatio).toBeGreaterThanOrEqual(1.5);
      expect(metrics.majorToMinorAxisRatio).toBeLessThanOrEqual(2.5);
      break;
    case 'prism':
      expect(metrics.faceCount).toBeGreaterThanOrEqual(3);
      expect(new Set(metrics.normalDirections?.map((normal) => JSON.stringify(normal))).size).toBe(
        metrics.faceCount,
      );
      break;
    case 'rings':
      expect(metrics.ringCount).toBeGreaterThanOrEqual(2);
      expect(metrics.outerToInnerDiameterRatios?.every((ratio) => ratio >= 1.5)).toBe(true);
      break;
    case 'radial-rays':
      expect(metrics.rayCount).toBeGreaterThanOrEqual(8);
      expect(metrics.minimumLengthToCoreRadius).toBeGreaterThanOrEqual(1.5);
      break;
    case 'irregular-clusters':
      expect(metrics.clusterCount).toBeGreaterThanOrEqual(3);
      expect(metrics.minimumSizeDifference).toBeGreaterThanOrEqual(0.2);
      break;
    default:
      throw new Error(`Unknown shape metric: ${metrics.kind}`);
  }
}

function expectGalaxySet(galaxies: GalaxySnapshot[], fallbackExpected: boolean): void {
  expect(galaxies).toHaveLength(8);
  expect(new Set(galaxies.map(({ shapeMetricKind }) => shapeMetricKind)).size).toBe(8);
  expect(new Set(galaxies.map(({ pixels }) => pixels.maskHash)).size).toBe(8);

  for (const galaxy of galaxies) {
    expect(galaxy.fallbackUsed).toBe(fallbackExpected);
    expect(galaxy.pixels.visiblePixelCount).toBeGreaterThan(0);
    expect(galaxy.pixels.primaryColorRatio).toBeGreaterThanOrEqual(0.5);
    expect(galaxy.pixels.projectedAspectRatio).toBeGreaterThan(0);
    expectRequiredShapeMetric(galaxy.shapeMetrics);
  }
}

// Visual regression fixture: fixed seed, 1920x1080 Chromium OffscreenCanvas.
test('R1.4 R13.6 R15.1-R15.12 keeps Galaxy, Nebula, fallback, and selective Bloom metrics stable', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/galaxy-visual-harness.html');
  await expect(page.getByTestId('visual-status')).toHaveText('ready');
  const serialized = await page.locator('#visual-metrics').textContent();
  if (serialized === null || serialized.length === 0) throw new Error('Visual metrics were not emitted');
  const metrics = JSON.parse(serialized) as VisualFixtureResult;

  expect(metrics.viewport).toEqual({ width: 1_920, height: 1_080 });
  expect(metrics.seed).toBe(0x5eed1234);
  expectGalaxySet(metrics.nativeGalaxies, false);
  expectGalaxySet(metrics.fallbackGalaxies, true);
  expect(metrics.nativeGalaxies.map(({ primaryColor }) => primaryColor)).toEqual([
    '#3B82F6',
    '#F472B6',
    '#DC2626',
    '#F59E0B',
    '#A855F7',
    '#FDE047',
    '#F97316',
    '#14B8A6',
  ]);
  expect(metrics.nativeGalaxies.map(({ shapeMetricKind }) => shapeMetricKind)).toEqual([
    'spiral',
    'core-nebula',
    'asymmetric-bands',
    'ellipse',
    'prism',
    'rings',
    'radial-rays',
    'irregular-clusters',
  ]);
  expect(metrics.determinism.nativeMaskHashes).toEqual(
    metrics.determinism.repeatedNativeMaskHashes,
  );
  expect(metrics.determinism.fallbackMaskHashes).toEqual(
    metrics.determinism.repeatedFallbackMaskHashes,
  );

  expect(metrics.nebulas.length).toBeGreaterThanOrEqual(1);
  expect(metrics.nebulas.length).toBeLessThanOrEqual(3);
  const minimumNebulaColor = parseHexColor('#0b1030');
  const maximumNebulaColor = parseHexColor('#1a1550');
  for (const nebula of metrics.nebulas) {
    expect(nebula.opacity).toBeGreaterThanOrEqual(0.1);
    expect(nebula.opacity).toBeLessThanOrEqual(0.5);
    parseHexColor(nebula.color).forEach((channel, index) => {
      expect(channel).toBeGreaterThanOrEqual(minimumNebulaColor[index]!);
      expect(channel).toBeLessThanOrEqual(maximumNebulaColor[index]!);
    });
  }

  expect(metrics.bloom).toMatchObject({
    enabled: true,
    selectedTargetCount: 3,
    eligibleTargetCount: 3,
    leakedTargetKeys: [],
    missingTargetKeys: [],
    leakageRatio: 0,
  });

  await test.info().attach('galaxy-postprocessing-metrics.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  });
});
