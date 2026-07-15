import type { BuiltGalaxyTheme, GalaxyPrimitive, ShapeMetrics } from './galaxyThemes';

export const VISUAL_REGRESSION_VIEWPORT = Object.freeze({
  width: 1_920,
  height: 1_080,
});
export const VISUAL_REGRESSION_SEED = 0x5eed1234;

const VISIBLE_ALPHA_THRESHOLD = 0.1;
const PRIMARY_COLOR_TOLERANCE = 32;

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OffscreenPixelMetrics {
  visiblePixelCount: number;
  primaryColorPixelCount: number;
  primaryColorRatio: number;
  coverageRatio: number;
  projectedAspectRatio: number;
  normalizedCentroid: readonly [number, number];
  bounds: PixelBounds;
  maskHash: string;
}

export interface GalaxyVisualSnapshot {
  themeId: BuiltGalaxyTheme['themeId'];
  genre: BuiltGalaxyTheme['genre'];
  fallbackUsed: boolean;
  shapeMetricKind: ShapeMetrics['kind'];
  shapeMetrics: ShapeMetrics;
  primaryColor: string;
  viewport: typeof VISUAL_REGRESSION_VIEWPORT;
  seed: number;
  pixels: OffscreenPixelMetrics;
}

export interface BloomLeakageMetrics {
  selectedTargetCount: number;
  eligibleTargetCount: number;
  sceneObjectCount: number;
  leakedTargetKeys: string[];
  missingTargetKeys: string[];
  leakageRatio: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

function parseHexColor(color: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match?.[1] === undefined) throw new Error(`Invalid RGB color: ${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function projectVertex(
  vertex: GalaxyPrimitive['vertices'][number],
  radius: number,
  width: number,
  height: number,
): ProjectedPoint {
  const scale = Math.min(width, height) / (radius * 2.65);
  return {
    x: width / 2 + (vertex.x + vertex.z * 0.32) * scale,
    y: height / 2 + (-vertex.y + vertex.z * 0.68) * scale,
  };
}

function tracePrimitive(
  context: OffscreenCanvasRenderingContext2D,
  primitive: GalaxyPrimitive,
  radius: number,
  width: number,
  height: number,
): void {
  const projected = primitive.vertices.map((vertex) =>
    projectVertex(vertex, radius, width, height),
  );
  const first = projected[0];
  if (first === undefined) return;

  const scale = Math.min(width, height) / (radius * 2.65);
  context.globalAlpha = primitive.opacity;
  context.fillStyle = primitive.color;
  context.strokeStyle = primitive.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (
    primitive.kind === 'core-nebula' ||
    primitive.kind === 'irregular-cluster' ||
    primitive.kind === 'particles'
  ) {
    const pointRadius = Math.max(1.5, (primitive.particleSize ?? radius * 0.035) * scale * 0.5);
    for (const current of projected) {
      context.beginPath();
      context.arc(current.x, current.y, pointRadius, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }

  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const current of projected.slice(1)) context.lineTo(current.x, current.y);
  if (primitive.closed) context.closePath();

  if (primitive.kind === 'prism-face') {
    context.fill();
    return;
  }

  const worldWidth = Math.min(primitive.width ?? radius * 0.04, radius * 0.12);
  context.lineWidth = Math.max(2, worldWidth * scale);
  context.stroke();
}

function updateHash(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

function readPixelMetrics(
  context: OffscreenCanvasRenderingContext2D,
  primaryColor: string,
  width: number,
  height: number,
): OffscreenPixelMetrics {
  const pixels = context.getImageData(0, 0, width, height).data;
  const [primaryRed, primaryGreen, primaryBlue] = parseHexColor(primaryColor);
  const alphaThreshold = Math.ceil(VISIBLE_ALPHA_THRESHOLD * 255);
  let visiblePixelCount = 0;
  let primaryColorPixelCount = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  let xTotal = 0;
  let yTotal = 0;
  let hash = 0x811c9dc5;

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const channelIndex = pixelIndex * 4;
    const alpha = pixels[channelIndex + 3] ?? 0;
    if (alpha < alphaThreshold) continue;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const red = pixels[channelIndex] ?? 0;
    const green = pixels[channelIndex + 1] ?? 0;
    const blue = pixels[channelIndex + 2] ?? 0;
    visiblePixelCount += 1;
    xTotal += x;
    yTotal += y;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
    hash = updateHash(hash, pixelIndex);
    hash = updateHash(hash, alpha);

    if (
      Math.abs(red - primaryRed) <= PRIMARY_COLOR_TOLERANCE &&
      Math.abs(green - primaryGreen) <= PRIMARY_COLOR_TOLERANCE &&
      Math.abs(blue - primaryBlue) <= PRIMARY_COLOR_TOLERANCE
    ) {
      primaryColorPixelCount += 1;
    }
  }

  if (visiblePixelCount === 0) throw new Error('Offscreen galaxy snapshot has no visible pixels');

  const bounds = {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
  };

  return {
    visiblePixelCount,
    primaryColorPixelCount,
    primaryColorRatio: round(primaryColorPixelCount / visiblePixelCount),
    coverageRatio: round(visiblePixelCount / (width * height)),
    projectedAspectRatio: round(bounds.width / bounds.height),
    normalizedCentroid: [
      round(xTotal / visiblePixelCount / width),
      round(yTotal / visiblePixelCount / height),
    ],
    bounds,
    maskHash: hash.toString(16).padStart(8, '0'),
  };
}

/**
 * Projects the real seeded GalaxyTheme primitives into a transparent 1920x1080
 * OffscreenCanvas. The transparent mask keeps RGB color measurement independent
 * from the application background while retaining primitive alpha coverage.
 */
export function captureGalaxyOffscreenSnapshot(
  builtTheme: BuiltGalaxyTheme,
  viewport = VISUAL_REGRESSION_VIEWPORT,
): GalaxyVisualSnapshot {
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Offscreen 2D rendering is unavailable');

  context.clearRect(0, 0, viewport.width, viewport.height);
  for (const primitive of builtTheme.geometry.primitives) {
    tracePrimitive(
      context,
      primitive,
      builtTheme.geometry.radius,
      viewport.width,
      viewport.height,
    );
  }

  return {
    themeId: builtTheme.themeId,
    genre: builtTheme.genre,
    fallbackUsed: builtTheme.fallbackUsed,
    shapeMetricKind: builtTheme.shapeMetrics.kind,
    shapeMetrics: builtTheme.shapeMetrics,
    primaryColor: builtTheme.uniforms.primaryColor,
    viewport,
    seed: builtTheme.geometry.seed,
    pixels: readPixelMetrics(
      context,
      builtTheme.uniforms.primaryColor,
      viewport.width,
      viewport.height,
    ),
  };
}

/** Measures both accidental non-target Bloom selection and omitted eligible targets. */
export function measureBloomLeakage(
  selectedTargetKeys: readonly string[],
  eligibleTargetKeys: readonly string[],
  sceneObjectKeys: readonly string[],
): BloomLeakageMetrics {
  const selected = new Set(selectedTargetKeys);
  const eligible = new Set(eligibleTargetKeys);
  const sceneObjects = new Set(sceneObjectKeys);
  const leakedTargetKeys = [...selected]
    .filter((key) => sceneObjects.has(key) && !eligible.has(key))
    .sort();
  const missingTargetKeys = [...eligible]
    .filter((key) => sceneObjects.has(key) && !selected.has(key))
    .sort();

  return {
    selectedTargetCount: selected.size,
    eligibleTargetCount: eligible.size,
    sceneObjectCount: sceneObjects.size,
    leakedTargetKeys,
    missingTargetKeys,
    leakageRatio: selected.size === 0 ? 0 : round(leakedTargetKeys.length / selected.size),
  };
}
