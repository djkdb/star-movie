import type { Genre, GenreGalaxyThemeId, Vec3 } from '../domain/models';

const TAU = Math.PI * 2;
const DEFAULT_RADIUS = 18;
const DEFAULT_SEED = 0x6d2b79f5;
const PRIMARY_COLOR_CONTRIBUTION = 0.75;
const VISIBLE_OPACITY_THRESHOLD = 0.1;

export type GalaxyPrimitiveKind =
  | 'spiral-arm'
  | 'core-nebula'
  | 'asymmetric-band'
  | 'ellipse'
  | 'prism-face'
  | 'ring'
  | 'radial-ray'
  | 'irregular-cluster'
  | 'particles';

export interface GalaxyPrimitive {
  kind: GalaxyPrimitiveKind;
  color: string;
  opacity: number;
  vertices: readonly Vec3[];
  closed: boolean;
  normal?: Vec3;
  width?: number;
  particleSize?: number;
  monochrome?: boolean;
  distribution?: ShapeMetrics['kind'];
}

export interface GalaxyThemeGeometry {
  radius: number;
  seed: number;
  primitives: readonly GalaxyPrimitive[];
}

export interface GalaxyThemeContext {
  radius: number;
  seed: number;
}

export interface GalaxyThemeUniforms {
  primaryColor: string;
  primaryColorContribution: number;
  intensity: number;
  visibleOpacityThreshold: number;
}

export type ShapeMetrics =
  | {
      kind: 'spiral';
      armCount: number;
      turnsPerArm: readonly number[];
    }
  | {
      kind: 'core-nebula';
      innerRadiusFraction: number;
      innerParticleDensity: number;
      outerParticleDensity: number;
      densityRatio: number;
    }
  | {
      kind: 'asymmetric-bands';
      bandCount: number;
      lengthWidthRatios: readonly number[];
    }
  | {
      kind: 'ellipse';
      majorToMinorAxisRatio: number;
    }
  | {
      kind: 'prism';
      faceCount: number;
      normalDirections: readonly Vec3[];
    }
  | {
      kind: 'rings';
      ringCount: number;
      outerToInnerDiameterRatios: readonly number[];
    }
  | {
      kind: 'radial-rays';
      rayCount: number;
      minimumLengthToCoreRadius: number;
    }
  | {
      kind: 'irregular-clusters';
      clusterCount: number;
      minimumSizeDifference: number;
      relativeSizes: readonly number[];
    };

/**
 * A render-independent strategy contract. Renderers may map line-like primitives
 * to Line/Tube geometry, faces to meshes, and particle primitives to Points.
 */
export interface GalaxyTheme {
  readonly id: GenreGalaxyThemeId;
  readonly genre: Genre;
  readonly primaryColor: string;
  buildGeometry(context?: Partial<GalaxyThemeContext>): GalaxyThemeGeometry;
  uniforms(intensity?: number): GalaxyThemeUniforms;
  shapeMetrics(context?: Partial<GalaxyThemeContext>): ShapeMetrics;
}

export interface BuiltGalaxyTheme {
  themeId: GenreGalaxyThemeId;
  genre: Genre;
  geometry: GalaxyThemeGeometry;
  uniforms: GalaxyThemeUniforms;
  shapeMetrics: ShapeMetrics;
  fallbackUsed: boolean;
  failureReason: string | null;
}

interface ThemeDefinition {
  genre: Genre;
  primaryColor: string;
}

const THEME_DEFINITIONS: Readonly<Record<GenreGalaxyThemeId, ThemeDefinition>> = {
  'blue-spiral': { genre: 'SF', primaryColor: '#3B82F6' },
  'pink-core-nebula': { genre: '로맨스', primaryColor: '#F472B6' },
  'red-asymmetric-bands': { genre: '스릴러', primaryColor: '#DC2626' },
  'gold-elliptical': { genre: '드라마', primaryColor: '#F59E0B' },
  'purple-prism': { genre: '애니', primaryColor: '#A855F7' },
  'yellow-rings': { genre: '코미디', primaryColor: '#FDE047' },
  'orange-burst': { genre: '액션', primaryColor: '#F97316' },
  'teal-irregular-clusters': { genre: '기타', primaryColor: '#14B8A6' },
};

export const GENRE_THEME_IDS: Readonly<Record<Genre, GenreGalaxyThemeId>> = {
  SF: 'blue-spiral',
  로맨스: 'pink-core-nebula',
  스릴러: 'red-asymmetric-bands',
  드라마: 'gold-elliptical',
  애니: 'purple-prism',
  코미디: 'yellow-rings',
  액션: 'orange-burst',
  기타: 'teal-irregular-clusters',
};

function normalizeContext(context?: Partial<GalaxyThemeContext>): GalaxyThemeContext {
  const radius = context?.radius ?? DEFAULT_RADIUS;
  const seed = context?.seed ?? DEFAULT_SEED;

  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error('Galaxy theme radius must be a positive finite number');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Galaxy theme seed must be an unsigned 32-bit integer');
  }

  return { radius, seed };
}

function safeFallbackContext(context?: Partial<GalaxyThemeContext>): GalaxyThemeContext {
  try {
    return normalizeContext(context);
  } catch {
    return { radius: DEFAULT_RADIUS, seed: DEFAULT_SEED };
  }
}

function createRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function point(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(left: Vec3, right: Vec3): Vec3 {
  return point(left.x + right.x, left.y + right.y, left.z + right.z);
}

function randomSpherePoint(
  random: () => number,
  minimumRadius: number,
  maximumRadius: number,
): Vec3 {
  const minimumCube = minimumRadius ** 3;
  const maximumCube = maximumRadius ** 3;
  const radius = Math.cbrt(minimumCube + (maximumCube - minimumCube) * random());
  const theta = TAU * random();
  const cosinePhi = 2 * random() - 1;
  const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));
  return point(
    radius * sinePhi * Math.cos(theta),
    radius * cosinePhi,
    radius * sinePhi * Math.sin(theta),
  );
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) return point(0, 1, 0);
  return point(vector.x / length, vector.y / length, vector.z / length);
}

function primitive(
  kind: GalaxyPrimitiveKind,
  color: string,
  vertices: readonly Vec3[],
  options: Partial<Omit<GalaxyPrimitive, 'kind' | 'color' | 'vertices'>> = {},
): GalaxyPrimitive {
  return {
    kind,
    color,
    vertices,
    opacity: options.opacity ?? 0.72,
    closed: options.closed ?? false,
    ...(options.normal === undefined ? {} : { normal: options.normal }),
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.particleSize === undefined ? {} : { particleSize: options.particleSize }),
    ...(options.monochrome === undefined ? {} : { monochrome: options.monochrome }),
    ...(options.distribution === undefined ? {} : { distribution: options.distribution }),
  };
}

function buildSpiralGeometry(context: GalaxyThemeContext, color: string): GalaxyThemeGeometry {
  const armCount = 2;
  const turns = 1.25;
  const samples = 64;
  const arms = Array.from({ length: armCount }, (_, armIndex) => {
    const vertices = Array.from({ length: samples }, (__, sampleIndex) => {
      const progress = sampleIndex / (samples - 1);
      const angle = TAU * turns * progress + (armIndex * TAU) / armCount;
      const radius = context.radius * (0.08 + progress * 0.92);
      return point(
        radius * Math.cos(angle),
        context.radius * 0.035 * Math.sin(angle * 1.7),
        radius * Math.sin(angle),
      );
    });
    return primitive('spiral-arm', color, vertices, { width: context.radius * 0.08 });
  });
  return { ...context, primitives: arms };
}

const ROMANCE_INNER_PARTICLE_COUNT = 96;
const ROMANCE_OUTER_PARTICLE_COUNT = 48;
const ROMANCE_INNER_RADIUS_FRACTION = 0.5;

function buildCoreNebulaGeometry(
  context: GalaxyThemeContext,
  color: string,
): GalaxyThemeGeometry {
  const random = createRandom(context.seed);
  const innerRadius = context.radius * ROMANCE_INNER_RADIUS_FRACTION;
  const inner = Array.from({ length: ROMANCE_INNER_PARTICLE_COUNT }, () =>
    randomSpherePoint(random, 0, innerRadius),
  );
  const outer = Array.from({ length: ROMANCE_OUTER_PARTICLE_COUNT }, () =>
    randomSpherePoint(random, innerRadius, context.radius),
  );
  return {
    ...context,
    primitives: [
      primitive('core-nebula', color, inner, {
        opacity: 0.78,
        particleSize: context.radius * 0.055,
      }),
      primitive('core-nebula', color, outer, {
        opacity: 0.48,
        particleSize: context.radius * 0.04,
      }),
    ],
  };
}

function buildAsymmetricBandsGeometry(
  context: GalaxyThemeContext,
  color: string,
): GalaxyThemeGeometry {
  const specifications = [
    { length: 1.55, width: 0.32, angle: 0.18, offset: point(-0.12, 0.08, 0) },
    { length: 1.25, width: 0.27, angle: 1.12, offset: point(0.18, -0.12, 0.08) },
    { length: 1.42, width: 0.3, angle: 2.35, offset: point(0.05, 0.2, -0.12) },
  ] as const;

  const bands = specifications.map((specification) => {
    const halfLength = (context.radius * specification.length) / 2;
    const offset = point(
      specification.offset.x * context.radius,
      specification.offset.y * context.radius,
      specification.offset.z * context.radius,
    );
    const direction = point(Math.cos(specification.angle), 0.16, Math.sin(specification.angle));
    const vertices = Array.from({ length: 16 }, (_, index) => {
      const progress = index / 15 - 0.5;
      const bend = Math.sin(progress * Math.PI) * context.radius * 0.12;
      return add(
        offset,
        point(
          direction.x * halfLength * progress * 2,
          direction.y * halfLength * progress * 2 + bend,
          direction.z * halfLength * progress * 2,
        ),
      );
    });
    return primitive('asymmetric-band', color, vertices, {
      width: specification.width * context.radius,
      opacity: 0.64,
    });
  });

  return { ...context, primitives: bands };
}

function buildEllipticalGeometry(
  context: GalaxyThemeContext,
  color: string,
): GalaxyThemeGeometry {
  const axisRatio = 1.8;
  const majorRadius = context.radius;
  const minorRadius = majorRadius / axisRatio;
  const vertices = Array.from({ length: 96 }, (_, index) => {
    const angle = (TAU * index) / 96;
    return point(
      majorRadius * Math.cos(angle),
      minorRadius * 0.18 * Math.sin(angle * 2),
      minorRadius * Math.sin(angle),
    );
  });
  return {
    ...context,
    primitives: [
      primitive('ellipse', color, vertices, {
        closed: true,
        width: context.radius * 0.18,
      }),
    ],
  };
}

const PRISM_NORMALS: readonly Vec3[] = [
  normalize(point(0, 1, 0.35)),
  normalize(point(0.82, 0.22, 0.52)),
  normalize(point(-0.7, 0.38, 0.6)),
  normalize(point(0.2, -0.72, 0.66)),
];

function buildPrismGeometry(context: GalaxyThemeContext, color: string): GalaxyThemeGeometry {
  const radius = context.radius * 0.72;
  const faces = PRISM_NORMALS.map((normal, index) => {
    const phase = (TAU * index) / PRISM_NORMALS.length;
    const vertices = [
      point(radius * Math.cos(phase), radius * 0.9, radius * Math.sin(phase)),
      point(
        radius * Math.cos(phase + TAU / 3),
        -radius * 0.65,
        radius * Math.sin(phase + TAU / 3),
      ),
      point(
        radius * Math.cos(phase - TAU / 3),
        -radius * 0.65,
        radius * Math.sin(phase - TAU / 3),
      ),
    ];
    return primitive('prism-face', color, vertices, {
      closed: true,
      normal,
      opacity: 0.42,
    });
  });
  return { ...context, primitives: faces };
}

function buildRingGeometry(context: GalaxyThemeContext, color: string): GalaxyThemeGeometry {
  const ringSpecifications = [
    { radius: 0.62, tilt: 0.18, diameterRatio: 1.8 },
    { radius: 0.92, tilt: -0.31, diameterRatio: 1.6 },
  ] as const;
  const rings = ringSpecifications.map((specification, ringIndex) => {
    const vertices = Array.from({ length: 72 }, (_, index) => {
      const angle = (TAU * index) / 72;
      const radius = context.radius * specification.radius;
      return point(
        radius * Math.cos(angle),
        radius * Math.sin(angle) * Math.sin(specification.tilt),
        radius * Math.sin(angle) * Math.cos(specification.tilt) + ringIndex * context.radius * 0.04,
      );
    });
    return primitive('ring', color, vertices, {
      closed: true,
      width: (context.radius * specification.radius * 2) / specification.diameterRatio,
      opacity: 0.7,
    });
  });
  return { ...context, primitives: rings };
}

function buildBurstGeometry(context: GalaxyThemeContext, color: string): GalaxyThemeGeometry {
  const rayCount = 10;
  const coreRadius = context.radius * 0.25;
  const rayLength = coreRadius * 1.75;
  const rays = Array.from({ length: rayCount }, (_, index) => {
    const azimuth = (TAU * index) / rayCount;
    const elevation = ((index % 3) - 1) * 0.24;
    const cosineElevation = Math.cos(elevation);
    const direction = point(
      Math.cos(azimuth) * cosineElevation,
      Math.sin(elevation),
      Math.sin(azimuth) * cosineElevation,
    );
    return primitive(
      'radial-ray',
      color,
      [
        point(0, 0, 0),
        point(direction.x * rayLength, direction.y * rayLength, direction.z * rayLength),
      ],
      { width: context.radius * 0.045, opacity: 0.86 },
    );
  });
  return { ...context, primitives: rays };
}

const IRREGULAR_CLUSTER_SIZES = [0.72, 1, 1.38] as const;

function buildIrregularClusterGeometry(
  context: GalaxyThemeContext,
  color: string,
): GalaxyThemeGeometry {
  const random = createRandom(context.seed);
  const centers = [
    point(-0.5, 0.18, -0.2),
    point(0.32, -0.28, 0.36),
    point(0.18, 0.42, -0.38),
  ] as const;
  const clusters = centers.map((relativeCenter, index) => {
    const relativeSize = IRREGULAR_CLUSTER_SIZES[index];
    if (relativeSize === undefined) throw new Error('Missing irregular cluster size');
    const clusterRadius = context.radius * 0.22 * relativeSize;
    const center = point(
      relativeCenter.x * context.radius,
      relativeCenter.y * context.radius,
      relativeCenter.z * context.radius,
    );
    const vertices = Array.from({ length: 28 + index * 7 }, () =>
      add(center, randomSpherePoint(random, 0, clusterRadius)),
    );
    return primitive('irregular-cluster', color, vertices, {
      particleSize: context.radius * 0.045 * relativeSize,
      opacity: 0.66,
    });
  });
  return { ...context, primitives: clusters };
}

function buildGeometryForTheme(
  id: GenreGalaxyThemeId,
  context: GalaxyThemeContext,
  color: string,
): GalaxyThemeGeometry {
  switch (id) {
    case 'blue-spiral':
      return buildSpiralGeometry(context, color);
    case 'pink-core-nebula':
      return buildCoreNebulaGeometry(context, color);
    case 'red-asymmetric-bands':
      return buildAsymmetricBandsGeometry(context, color);
    case 'gold-elliptical':
      return buildEllipticalGeometry(context, color);
    case 'purple-prism':
      return buildPrismGeometry(context, color);
    case 'yellow-rings':
      return buildRingGeometry(context, color);
    case 'orange-burst':
      return buildBurstGeometry(context, color);
    case 'teal-irregular-clusters':
      return buildIrregularClusterGeometry(context, color);
  }
}

function sphereVolume(radius: number): number {
  return (4 / 3) * Math.PI * radius ** 3;
}

function shapeMetricsForTheme(
  id: GenreGalaxyThemeId,
  context: GalaxyThemeContext,
): ShapeMetrics {
  switch (id) {
    case 'blue-spiral':
      return { kind: 'spiral', armCount: 2, turnsPerArm: [1.25, 1.25] };
    case 'pink-core-nebula': {
      const innerRadius = context.radius * ROMANCE_INNER_RADIUS_FRACTION;
      const innerVolume = sphereVolume(innerRadius);
      const outerVolume = sphereVolume(context.radius) - innerVolume;
      const innerParticleDensity = ROMANCE_INNER_PARTICLE_COUNT / innerVolume;
      const outerParticleDensity = ROMANCE_OUTER_PARTICLE_COUNT / outerVolume;
      return {
        kind: 'core-nebula',
        innerRadiusFraction: ROMANCE_INNER_RADIUS_FRACTION,
        innerParticleDensity,
        outerParticleDensity,
        densityRatio: innerParticleDensity / outerParticleDensity,
      };
    }
    case 'red-asymmetric-bands':
      return {
        kind: 'asymmetric-bands',
        bandCount: 3,
        lengthWidthRatios: [1.55 / 0.32, 1.25 / 0.27, 1.42 / 0.3],
      };
    case 'gold-elliptical':
      return { kind: 'ellipse', majorToMinorAxisRatio: 1.8 };
    case 'purple-prism':
      return { kind: 'prism', faceCount: PRISM_NORMALS.length, normalDirections: PRISM_NORMALS };
    case 'yellow-rings':
      return { kind: 'rings', ringCount: 2, outerToInnerDiameterRatios: [1.8, 1.6] };
    case 'orange-burst':
      return { kind: 'radial-rays', rayCount: 10, minimumLengthToCoreRadius: 1.75 };
    case 'teal-irregular-clusters': {
      const smallest = Math.min(...IRREGULAR_CLUSTER_SIZES);
      const largest = Math.max(...IRREGULAR_CLUSTER_SIZES);
      return {
        kind: 'irregular-clusters',
        clusterCount: 3,
        minimumSizeDifference: (largest - smallest) / smallest,
        relativeSizes: IRREGULAR_CLUSTER_SIZES,
      };
    }
  }
}

function createUniforms(primaryColor: string, intensity = 1): GalaxyThemeUniforms {
  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new Error('Galaxy theme intensity must be a non-negative finite number');
  }
  return {
    primaryColor,
    primaryColorContribution: PRIMARY_COLOR_CONTRIBUTION,
    intensity,
    visibleOpacityThreshold: VISIBLE_OPACITY_THRESHOLD,
  };
}

function createTheme(id: GenreGalaxyThemeId): GalaxyTheme {
  const definition = THEME_DEFINITIONS[id];
  return Object.freeze({
    id,
    genre: definition.genre,
    primaryColor: definition.primaryColor,
    buildGeometry(context?: Partial<GalaxyThemeContext>) {
      return buildGeometryForTheme(id, normalizeContext(context), definition.primaryColor);
    },
    uniforms(intensity?: number) {
      return createUniforms(definition.primaryColor, intensity);
    },
    shapeMetrics(context?: Partial<GalaxyThemeContext>) {
      return shapeMetricsForTheme(id, normalizeContext(context));
    },
  });
}

export const GALAXY_THEMES: Readonly<Record<GenreGalaxyThemeId, GalaxyTheme>> = Object.freeze({
  'blue-spiral': createTheme('blue-spiral'),
  'pink-core-nebula': createTheme('pink-core-nebula'),
  'red-asymmetric-bands': createTheme('red-asymmetric-bands'),
  'gold-elliptical': createTheme('gold-elliptical'),
  'purple-prism': createTheme('purple-prism'),
  'yellow-rings': createTheme('yellow-rings'),
  'orange-burst': createTheme('orange-burst'),
  'teal-irregular-clusters': createTheme('teal-irregular-clusters'),
});

export function getGalaxyTheme(themeId: GenreGalaxyThemeId): GalaxyTheme {
  return GALAXY_THEMES[themeId];
}

function isHeartPrimitive(primitiveValue: GalaxyPrimitive): boolean {
  return String(primitiveValue.kind).toLocaleLowerCase('en-US').includes('heart');
}

function assertThemeGeometry(theme: GalaxyTheme, geometry: GalaxyThemeGeometry): void {
  if (geometry.primitives.length === 0) throw new Error('Galaxy theme produced no primitives');

  let visibleVertices = 0;
  let primaryVertices = 0;
  for (const currentPrimitive of geometry.primitives) {
    if (currentPrimitive.vertices.length === 0) {
      throw new Error('Galaxy theme produced an empty primitive');
    }
    if (currentPrimitive.opacity < VISIBLE_OPACITY_THRESHOLD || currentPrimitive.opacity > 1) {
      throw new Error('Galaxy theme primitive opacity is outside the visible range');
    }
    if (theme.genre === '로맨스' && isHeartPrimitive(currentPrimitive)) {
      throw new Error('Romance galaxy heart primitives are forbidden');
    }
    visibleVertices += currentPrimitive.vertices.length;
    if (currentPrimitive.color.toUpperCase() === theme.primaryColor.toUpperCase()) {
      primaryVertices += currentPrimitive.vertices.length;
    }
  }

  if (visibleVertices === 0 || primaryVertices / visibleVertices < 0.5) {
    throw new Error('Galaxy theme primary color contribution is below 50%');
  }
}

function createEmergencyPoints(id: GenreGalaxyThemeId, context: GalaxyThemeContext): Vec3[] {
  const themeIndex = Object.keys(THEME_DEFINITIONS).indexOf(id);
  const lobeCount = themeIndex + 2;
  return Array.from({ length: 64 }, (_, index) => {
    const progress = index / 63;
    const angle = TAU * progress * lobeCount;
    const radius = context.radius * (0.18 + 0.72 * progress);
    return point(
      radius * Math.cos(angle),
      context.radius * 0.12 * Math.sin(angle * 0.5),
      radius * Math.sin(angle),
    );
  });
}

function createParticleFallback(
  theme: GalaxyTheme,
  context: GalaxyThemeContext,
  metrics: ShapeMetrics,
): GalaxyThemeGeometry {
  let vertices: Vec3[];
  try {
    vertices = buildGeometryForTheme(theme.id, context, theme.primaryColor).primitives.flatMap(
      (currentPrimitive) => [...currentPrimitive.vertices],
    );
  } catch {
    vertices = createEmergencyPoints(theme.id, context);
  }

  return {
    ...context,
    primitives: [
      primitive('particles', theme.primaryColor, vertices, {
        opacity: 0.72,
        particleSize: context.radius * 0.05,
        monochrome: true,
        distribution: metrics.kind,
      }),
    ],
  };
}

/**
 * Isolates a failed theme and returns an always-visible, monochrome point cloud.
 * The fallback samples the original theme distribution, preserving its unique
 * quantitative shape signature while removing shader/material failure points.
 */
export function buildGalaxyThemeSafely(
  theme: GalaxyTheme,
  context?: Partial<GalaxyThemeContext>,
  intensity = 1,
): BuiltGalaxyTheme {
  try {
    const normalizedContext = normalizeContext(context);
    const geometry = theme.buildGeometry(normalizedContext);
    const uniforms = theme.uniforms(intensity);
    const shapeMetrics = theme.shapeMetrics(normalizedContext);
    if (uniforms.primaryColorContribution < 0.5) {
      throw new Error('Galaxy theme primary color contribution is below 50%');
    }
    assertThemeGeometry(theme, geometry);
    return {
      themeId: theme.id,
      genre: theme.genre,
      geometry,
      uniforms,
      shapeMetrics,
      fallbackUsed: false,
      failureReason: null,
    };
  } catch (error) {
    const fallbackContext = safeFallbackContext(context);
    const definition = THEME_DEFINITIONS[theme.id];
    const reliableTheme = GALAXY_THEMES[theme.id];
    const metrics = shapeMetricsForTheme(theme.id, fallbackContext);
    const fallbackTheme: GalaxyTheme = {
      ...reliableTheme,
      primaryColor: definition.primaryColor,
    };
    return {
      themeId: theme.id,
      genre: definition.genre,
      geometry: createParticleFallback(fallbackTheme, fallbackContext, metrics),
      uniforms: {
        primaryColor: definition.primaryColor,
        primaryColorContribution: 1,
        intensity: Number.isFinite(intensity) && intensity >= 0 ? intensity : 1,
        visibleOpacityThreshold: VISIBLE_OPACITY_THRESHOLD,
      },
      shapeMetrics: metrics,
      fallbackUsed: true,
      failureReason: error instanceof Error ? error.message : 'Unknown galaxy theme failure',
    };
  }
}

export function buildGalaxyThemeById(
  themeId: GenreGalaxyThemeId,
  context?: Partial<GalaxyThemeContext>,
  intensity = 1,
): BuiltGalaxyTheme {
  return buildGalaxyThemeSafely(getGalaxyTheme(themeId), context, intensity);
}
