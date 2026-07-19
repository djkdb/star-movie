export const SPACE_BACKGROUND_COLOR = '#000104';
export const SPACE_CAMERA_FOV = 60;
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

export type BackgroundLayerKind = 'far' | 'near' | 'band';

export interface BackgroundLayerDefinition {
  kind: BackgroundLayerKind;
  parallaxFactor: number;
  seed: number;
  starCount: number;
}

export const BACKGROUND_LAYER_DEFINITIONS: readonly BackgroundLayerDefinition[] = [
  { kind: 'far', parallaxFactor: 1, seed: 0x4f1bbcdc, starCount: 6_500 },
  { kind: 'near', parallaxFactor: 1.5, seed: 0x16a09e66, starCount: 1_700 },
  { kind: 'band', parallaxFactor: 1, seed: 0x7ede4a1b, starCount: 7_500 },
] as const;

/**
 * Realistic stellar tint distribution: mostly white and blue-white points with
 * a warm minority of yellow, orange, and reddish stars, matching a naked-eye
 * night sky rather than a uniformly blue starfield.
 */
const STAR_COLOR_PALETTE: readonly { color: readonly [number, number, number]; weight: number }[] = [
  { color: [0.62, 0.72, 1.0], weight: 10 },  // hot blue-white
  { color: [0.78, 0.84, 1.0], weight: 17 },  // blue-white
  { color: [0.97, 0.96, 1.0], weight: 31 },  // white
  { color: [1.0, 0.95, 0.9], weight: 21 },   // yellow-white
  { color: [1.0, 0.89, 0.78], weight: 12 },  // yellow-orange
  { color: [1.0, 0.8, 0.6], weight: 6 },     // orange
  { color: [1.0, 0.66, 0.42], weight: 3 },   // reddish
];

const STAR_COLOR_TOTAL_WEIGHT = STAR_COLOR_PALETTE.reduce(
  (total, entry) => total + entry.weight,
  0,
);

export interface BackgroundStarSample {
  position: readonly [number, number, number];
  color: readonly [number, number, number];
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
  /** Billboard roll (radians) so overlapping clouds never read as one circle. */
  rotation: number;
  /** Which procedural cloud texture variant to draw. */
  variant: number;
}

export interface MilkyWayPatchConfig {
  id: string;
  position: readonly [number, number, number];
  scale: readonly [number, number];
  opacity: number;
  color: string;
  /** Billboard roll (radians) so overlapping clouds never read as one circle. */
  rotation: number;
  /** Which procedural cloud texture variant to draw. */
  variant: number;
}

/** Number of distinct procedural cloud textures the scene rotates through. */
export const CLOUD_TEXTURE_VARIANTS = 4;

interface DirectionLike {
  x: number;
  y: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
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

/** Standard-normal sample via Box–Muller on the seeded generator. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

function pickStarColor(random: () => number): readonly [number, number, number] {
  let remaining = random() * STAR_COLOR_TOTAL_WEIGHT;
  for (const entry of STAR_COLOR_PALETTE) {
    remaining -= entry.weight;
    if (remaining <= 0) return entry.color;
  }
  return STAR_COLOR_PALETTE[STAR_COLOR_PALETTE.length - 1]!.color;
}

function normalizeVector(vector: Vec3Like): Vec3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) return { x: 0, y: 1, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Uniform direction on the unit sphere. */
function randomDirection(random: () => number): Vec3Like {
  const cosPhi = 2 * random() - 1;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const theta = TWO_PI * random();
  return { x: sinPhi * Math.cos(theta), y: cosPhi, z: sinPhi * Math.sin(theta) };
}

/**
 * The galactic band plane. The normal is tilted so the band sweeps a tall
 * diagonal arc across the default camera framing, like the Milky Way in a
 * wide-field sky photograph.
 */
const BAND_NORMAL = normalizeVector({ x: 0.92, y: 0.3, z: 0.25 });
const BAND_U = normalizeVector(cross(BAND_NORMAL, { x: 0, y: 1, z: 0 }));
const BAND_V = cross(BAND_NORMAL, BAND_U);

interface LayerShape {
  minimumRadius: number;
  maximumRadius: number;
  sizeBase: number;
  sizeRange: number;
  opacityBase: number;
  opacityRange: number;
}

const LAYER_SHAPES: Readonly<Record<BackgroundLayerKind, LayerShape>> = {
  far: {
    minimumRadius: 700,
    maximumRadius: 950,
    sizeBase: 1.3,
    sizeRange: 2.3,
    opacityBase: 0.5,
    opacityRange: 0.5,
  },
  near: {
    minimumRadius: 380,
    maximumRadius: 620,
    sizeBase: 1.6,
    sizeRange: 3.1,
    opacityBase: 0.55,
    opacityRange: 0.45,
  },
  band: {
    minimumRadius: 780,
    maximumRadius: 930,
    sizeBase: 0.9,
    sizeRange: 1.4,
    opacityBase: 0.2,
    opacityRange: 0.45,
  },
};

function sampleStarPosition(
  kind: BackgroundLayerKind,
  random: () => number,
  shape: LayerShape,
): readonly [number, number, number] {
  const radius =
    shape.minimumRadius + random() * (shape.maximumRadius - shape.minimumRadius);

  if (kind === 'band') {
    // Cluster along the galactic great circle with gaussian thickness and a
    // sparse wider halo so the band edge stays soft.
    const angle = TWO_PI * random();
    const thickness = random() < 0.82 ? 0.06 : 0.16;
    const offset = gaussian(random) * radius * thickness;
    return [
      radius * (Math.cos(angle) * BAND_U.x + Math.sin(angle) * BAND_V.x) + BAND_NORMAL.x * offset,
      radius * (Math.cos(angle) * BAND_U.y + Math.sin(angle) * BAND_V.y) + BAND_NORMAL.y * offset,
      radius * (Math.cos(angle) * BAND_U.z + Math.sin(angle) * BAND_V.z) + BAND_NORMAL.z * offset,
    ];
  }

  const direction = randomDirection(random);
  return [direction.x * radius, direction.y * radius, direction.z * radius];
}

export function createBackgroundStars(
  definition: BackgroundLayerDefinition,
): BackgroundStarSample[] {
  const random = createRandom(definition.seed);
  const shape = LAYER_SHAPES[definition.kind];

  return Array.from({ length: definition.starCount }, () => {
    // A skewed size distribution: most stars stay tiny, a rare few flare up.
    const magnitude = random() ** 2.6;
    return {
      position: sampleStarPosition(definition.kind, random, shape),
      color: pickStarColor(random),
      twinklePeriodSeconds:
        MIN_TWINKLE_PERIOD_SECONDS +
        random() * (MAX_TWINKLE_PERIOD_SECONDS - MIN_TWINKLE_PERIOD_SECONDS),
      twinklePhaseRadians: random() * TWO_PI,
      baseOpacity: shape.opacityBase + random() * shape.opacityRange,
      size: shape.sizeBase + magnitude * shape.sizeRange,
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
      rotation: random() * TWO_PI,
      variant: Math.floor(random() * CLOUD_TEXTURE_VARIANTS) % CLOUD_TEXTURE_VARIANTS,
    };
  });
}

const MILKY_WAY_PATCH_COUNT = 96;

function interpolateMilkyWayColor(amount: number): string {
  // Desaturated warm-gray range so the diffuse glow reads as unresolved
  // starlight rather than a colored nebula.
  const start = [0x4c, 0x51, 0x60] as const;
  const end = [0x8b, 0x92, 0xa4] as const;
  const channels = start.map((channel, index) =>
    Math.round(channel + (end[index]! - channel) * amount),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Uneven "cloud complexes" the Milky Way patches clump around. */
const MILKY_WAY_KNOT_COUNT = 6;

/**
 * Deterministic diffuse-glow patches loosely following the galactic band. Rather
 * than sitting evenly on one radius (which reads as a compass-drawn ring), the
 * patches clump around a handful of unevenly spaced cloud complexes, scatter at
 * widely varied depths, and leave gaps — so the Milky Way reads as irregular,
 * three-dimensional nebulosity. A quarter are scattered freely for diffuse fill.
 */
export function createMilkyWayPatchConfigs(seed = 0x7ede4a1b): MilkyWayPatchConfig[] {
  const random = createRandom(seed ^ 0x51ed270b);
  const knotAngles = Array.from({ length: MILKY_WAY_KNOT_COUNT }, () => random() * TWO_PI);

  return Array.from({ length: MILKY_WAY_PATCH_COUNT }, (_, index) => {
    // Most patches gather into cloud complexes; the rest scatter for diffuse fill.
    const angle =
      random() < 0.72
        ? knotAngles[Math.floor(random() * MILKY_WAY_KNOT_COUNT)]! + gaussian(random) * 0.32
        : random() * TWO_PI;
    // Depth varies widely so the band has volume instead of lying on one shell.
    const radius = 600 + random() * 420;
    // Uneven cross-band scatter with occasional far tufts feathers the edges.
    const offset = gaussian(random) * radius * (random() < 0.72 ? 0.06 : 0.15);
    const width = 150 + random() * 340;
    return {
      id: `milkyway-${index}`,
      position: [
        radius * (Math.cos(angle) * BAND_U.x + Math.sin(angle) * BAND_V.x) + BAND_NORMAL.x * offset,
        radius * (Math.cos(angle) * BAND_U.y + Math.sin(angle) * BAND_V.y) + BAND_NORMAL.y * offset,
        radius * (Math.cos(angle) * BAND_U.z + Math.sin(angle) * BAND_V.z) + BAND_NORMAL.z * offset,
      ],
      // Elongated, varied aspect so each tuft is a wisp rather than a disc.
      scale: [width, width * (0.3 + random() * 0.35)],
      opacity: 0.035 + random() * 0.06,
      color: interpolateMilkyWayColor(random()),
      rotation: random() * TWO_PI,
      variant: Math.floor(random() * CLOUD_TEXTURE_VARIANTS) % CLOUD_TEXTURE_VARIANTS,
    };
  });
}
