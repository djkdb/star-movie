export const SPACE_BACKGROUND_COLOR = '#03040a';
export const SPACE_CAMERA_FOV = 75;
export const SPACE_CAMERA_MAX_DISTANCE = 1_000;
export const TWINKLE_AMPLITUDE = 0.3;
export const MIN_TWINKLE_PERIOD_SECONDS = 1;
export const MAX_TWINKLE_PERIOD_SECONDS = 4;
export const MIN_NEBULA_COUNT = 1;
export const MAX_NEBULA_COUNT = 3;
export const MIN_NEBULA_OPACITY = 0.1;
export const MAX_NEBULA_OPACITY = 0.5;
export const NEBULA_COLOR_START = '#0b1030';
export const NEBULA_COLOR_END = '#1a1550';

const TWO_PI = Math.PI * 2;
const PARALLAX_STRENGTH = 0.08;

export type BackgroundLayerKind = 'far' | 'near';

export interface BackgroundLayerDefinition {
  kind: BackgroundLayerKind;
  parallaxFactor: 1 | 1.5;
  seed: number;
  starCount: number;
}

export const BACKGROUND_LAYER_DEFINITIONS: readonly BackgroundLayerDefinition[] = [
  { kind: 'far', parallaxFactor: 1, seed: 0x4f1bbcdc, starCount: 700 },
  { kind: 'near', parallaxFactor: 1.5, seed: 0x16a09e66, starCount: 350 },
] as const;

export interface BackgroundStarSample {
  position: readonly [number, number, number];
  twinklePeriodSeconds: number;
  twinklePhaseRadians: number;
  baseOpacity: number;
  size: number;
}

export interface NebulaConfig {
  id: string;
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  opacity: number;
  color: string;
}

interface DirectionLike {
  x: number;
  y: number;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function createBackgroundStars(
  definition: BackgroundLayerDefinition,
): BackgroundStarSample[] {
  const random = createRandom(definition.seed);
  const isFar = definition.kind === 'far';
  const minimumDepth = isFar ? 650 : 300;
  const depthRange = isFar ? 180 : 100;

  return Array.from({ length: definition.starCount }, () => {
    const depth = minimumDepth + random() * depthRange;
    return {
      position: [
        (random() - 0.5) * depth * 1.7,
        (random() - 0.5) * depth * 1.15,
        -depth,
      ],
      twinklePeriodSeconds:
        MIN_TWINKLE_PERIOD_SECONDS +
        random() * (MAX_TWINKLE_PERIOD_SECONDS - MIN_TWINKLE_PERIOD_SECONDS),
      twinklePhaseRadians: random() * TWO_PI,
      baseOpacity: 0.45 + random() * 0.45,
      size: (isFar ? 1 : 1.4) + random() * (isFar ? 1.5 : 2.2),
    };
  });
}

export function twinkleMultiplier(
  elapsedVisibleSeconds: number,
  periodSeconds: number,
  phaseRadians: number,
): number {
  return (
    1 +
    TWINKLE_AMPLITUDE *
      Math.sin((elapsedVisibleSeconds / periodSeconds) * TWO_PI + phaseRadians)
  );
}

export function calculateParallaxOffset(
  cameraDirection: DirectionLike,
  parallaxFactor: number,
): readonly [number, number] {
  return [
    cameraDirection.x * PARALLAX_STRENGTH * parallaxFactor,
    cameraDirection.y * PARALLAX_STRENGTH * parallaxFactor,
  ];
}

function interpolateNebulaColor(amount: number): string {
  const start = [0x0b, 0x10, 0x30] as const;
  const end = [0x1a, 0x15, 0x50] as const;
  const channels = start.map((channel, index) =>
    Math.round(channel + (end[index]! - channel) * amount),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function createNebulaConfigs(
  seed = 1,
  requestedCount?: number,
): NebulaConfig[] {
  const random = createRandom(seed);
  const count = requestedCount ?? MIN_NEBULA_COUNT + (seed >>> 0) % MAX_NEBULA_COUNT;
  if (!Number.isInteger(count) || count < MIN_NEBULA_COUNT || count > MAX_NEBULA_COUNT) {
    throw new RangeError('Nebula count must be an integer from 1 through 3');
  }

  return Array.from({ length: count }, (_, index) => {
    const depth = 430 + random() * 170;
    const width = 130 + random() * 150;
    return {
      id: `nebula-${seed >>> 0}-${index}`,
      position: [
        (random() - 0.5) * depth * 0.95,
        (random() - 0.5) * depth * 0.55,
        -depth,
      ],
      scale: [width, width * (0.55 + random() * 0.35), 1],
      opacity:
        MIN_NEBULA_OPACITY +
        random() * (MAX_NEBULA_OPACITY - MIN_NEBULA_OPACITY),
      color: interpolateNebulaColor(random()),
    };
  });
}
