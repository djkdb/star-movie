import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SpriteMaterial,
  type Group,
} from 'three';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { BLACKHOLE_POSITION } from './blackholeModel';
import { getStarHaloTexture } from './starSpriteTextures';
import {
  BackgroundMeteorScheduler,
  DEFAULT_FIREWORK_COLOR,
  EffectLifecycleRegistry,
  ParticleEffectController,
  browserParticleTimer,
  type DisposalDiagnostic,
  type ParticleEffectDescriptor,
  type ParticleTimer,
} from './particleManagerModel';

function pseudoRandom(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x1_0000_0000;
}

function particleDirection(seed: number, index: number): readonly [number, number, number] {
  const azimuth = pseudoRandom(seed, index * 3) * Math.PI * 2;
  const elevation = (pseudoRandom(seed, index * 3 + 1) - 0.5) * Math.PI;
  const speed = 0.65 + pseudoRandom(seed, index * 3 + 2) * 0.7;
  return [
    Math.cos(azimuth) * Math.cos(elevation) * speed,
    Math.sin(elevation) * speed,
    Math.sin(azimuth) * Math.cos(elevation) * speed,
  ];
}

function effectColor(kind: ParticleEffectDescriptor['kind']): string {
  switch (kind) {
    case 'fireworks':
      return '#ffe27a';
    case 'meteor-shower':
    case 'background-meteor':
      return '#dff6ff';
    case 'asteroid-impact':
      return '#f97316';
    case 'blackhole-spiral':
      return '#8b5cf6';
    case 'restore-pulse':
      return '#67e8f9';
    case 'milestone-celebration':
      return '#7dd3fc';
    case 'achievement-celebration':
      return '#f0abfc';
  }
}

/**
 * Trajectory shared by the spark heads and their light trails: an explosive
 * launch from the shell's heart that overshoots each spark's slot in the
 * figure and springs back (easeOutBack), a hovering breathe once settled,
 * then a loosening downward dissolve.
 */
const FIREWORK_MOTION_GLSL = `
  // A stable per-spark unit direction for the secondary burst, from its seed.
  vec3 sparkBurstDir(float seed) {
    float a = seed * 6.2831853;
    float z = fract(seed * 91.7) * 2.0 - 1.0;
    float r = sqrt(max(0.0, 1.0 - z * z));
    return vec3(cos(a) * r, sin(a) * r, z);
  }

  vec3 sparkPos(vec3 slot, float t, float seed, float clockTime) {
    float x = clamp(t / 0.3, 0.0, 1.0);
    float c1 = 1.70158;
    float c3 = c1 + 1.0;
    float form = 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0);
    float settled = smoothstep(0.26, 0.4, t);
    vec3 pos = slot * form;
    pos.x += sin(clockTime * 1.2 + seed * 43.0) * 1.1 * settled;
    pos.y += cos(clockTime * 0.9 + seed * 57.0) * 1.1 * settled;

    // Finale: the held figure detonates a second time — each spark pops outward
    // along its own direction, swells, and then rains down under gravity.
    float burst = smoothstep(0.7, 0.86, t);
    pos += sparkBurstDir(seed) * burst * 9.0;
    float fall = smoothstep(0.7, 1.0, t);
    pos *= 1.0 + fall * 0.25;
    pos.y -= fall * fall * 26.0;
    return pos;
  }

  float sparkLife(float clockTime, float delay, float duration) {
    // Normalized life with headroom so the most-delayed spark still
    // completes its full fade before the effect's cleanup timer fires.
    return clamp((clockTime - delay) / max(0.1, duration - 0.9), 0.0, 1.0);
  }
`;

const FIREWORK_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aDelay;
  attribute vec3 aColor;
  attribute float aGlitter;
  attribute float aSeed;
  uniform float uTime;
  uniform float uDuration;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vColor;
  ${FIREWORK_MOTION_GLSL}

  void main() {
    float t = sparkLife(uTime, aDelay, uDuration);
    vec3 pos = sparkPos(position, t, aSeed, uTime);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float settled = smoothstep(0.26, 0.4, t);
    float appear = smoothstep(0.0, 0.04, t);
    // Hold brightness through the second burst, then fade out on the rain-down.
    float fade = 1.0 - smoothstep(0.82, 1.0, t);
    float twinkle = 0.8 + 0.2 * sin(uTime * 8.0 + aSeed * 89.0);
    // Glitter sparks strobe once the figure has formed, like crackle stars.
    float strobe = step(0.35, fract(sin(floor(uTime * 14.0) + aSeed * 61.0) * 43758.5453));
    float crackle = mix(1.0, strobe * 1.6, settled);
    // Secondary-burst flash: every spark briefly re-ignites as the figure detonates.
    float reburst = smoothstep(0.7, 0.75, t) * (1.0 - smoothstep(0.75, 0.9, t));
    vAlpha = appear * fade * mix(twinkle, crackle, aGlitter) * (1.0 + reburst * 1.6);

    // Color evolution: white-hot launch flash -> figure tint -> white-hot second
    // burst -> dim ember.
    vec3 tinted = mix(vec3(1.0), aColor, smoothstep(0.02, 0.3, t));
    tinted = mix(tinted, vec3(1.0), reburst * 0.7);
    vec3 ember = aColor * 0.55 + vec3(0.12, 0.04, 0.0);
    vColor = mix(tinted, ember, smoothstep(0.88, 1.0, t));

    // Cap the screen-space size: nearby sparks otherwise balloon into huge
    // additive quads whose overdraw stalls weaker GPUs into dropped frames.
    float px = aSize * uPixelRatio * (480.0 / max(1.0, -mvPosition.z));
    gl_PointSize = min(px, 72.0 * uPixelRatio);
  }
`;

/**
 * Each spark drags a comet-like light streak: a line from its current position
 * back to where it was a beat ago. Streaks are long while sparks race outward,
 * vanish while the figure hovers, and reappear as it rains apart.
 */
const FIREWORK_TRAIL_VERTEX_SHADER = `
  attribute float aTrail;
  attribute float aDelay;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uTime;
  uniform float uDuration;
  varying float vAlpha;
  varying vec3 vColor;
  ${FIREWORK_MOTION_GLSL}

  void main() {
    float tHead = sparkLife(uTime, aDelay, uDuration);
    float tTail = sparkLife(uTime - 0.22, aDelay, uDuration);
    vec3 head = sparkPos(position, tHead, aSeed, uTime);
    vec3 tail = sparkPos(position, tTail, aSeed, uTime - 0.22);
    vec3 span = tail - head;
    float len = length(span);
    // Cap the streak so settled sparks keep short tails, but allow long comet
    // streaks during the fast launch and the second-burst rain-down.
    if (len > 24.0) span *= 24.0 / len;
    vec3 pos = head + span * aTrail;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);

    float appear = smoothstep(0.0, 0.04, tHead);
    // Trails linger almost to the end so the rain-down leaves comet streaks.
    float fade = 1.0 - smoothstep(0.9, 1.0, tHead);
    // Streak brightness follows speed, so trails blaze while racing outward and
    // again as the figure bursts apart, and rest quietly while it hovers.
    float speedGlow = clamp(len / 4.0, 0.0, 1.0);
    vAlpha = appear * fade * speedGlow * (1.0 - aTrail) * 0.9;

    vec3 tinted = mix(vec3(1.0), aColor, smoothstep(0.02, 0.3, tHead));
    vColor = tinted;
  }
`;

const FIREWORK_TRAIL_FRAGMENT_SHADER = `
  precision highp float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    if (vAlpha <= 0.004) discard;
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

/** Expanding shockwave ring that races out past the figure as it opens. */
const FIREWORK_RING_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uRadius;
  varying float vProgress;

  void main() {
    float p = clamp(uTime / 1.1, 0.0, 1.0);
    float eased = 1.0 - pow(1.0 - p, 3.0);
    vProgress = p;
    // Zero scale before the burst keeps the ring invisible during the climb.
    vec3 pos = position * mix(0.0, 1.35, eased) * uRadius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FIREWORK_RING_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec3 uTint;
  varying float vProgress;

  void main() {
    float alpha = (1.0 - vProgress) * 0.5;
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(mix(vec3(1.0), uTint, vProgress) * 1.2, alpha);
  }
`;

const FIREWORK_FRAGMENT_SHADER = `
  precision highp float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float core = 1.0 - smoothstep(0.0, 0.5, d);
    float alpha = pow(core, 1.6) * vAlpha;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(vColor * (0.85 + 0.75 * core), alpha);
  }
`;

function fireworkRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Cosmic accent hues blended lightly into each spark so the figure shimmers
 * with nebula-like iridescence while its base color still reads clearly.
 */
const COSMIC_ACCENTS: readonly Color[] = [
  new Color('#7cf5ff'), // ion teal
  new Color('#b98bff'), // nebula violet
  new Color('#ff8fd0'), // rose
  new Color('#ffe6a3'), // stardust gold
  new Color('#8fb6ff'), // deep-sky blue
];

/**
 * World-space radius of the backdrop figure. Staged far behind the star field,
 * it spans roughly 60% of the visible sky — a vast panorama, never a local pop.
 */
const FIGURE_RADIUS = 78;

/** Deep backdrop stage: high in the sky, far behind every star and planet. */
const FIGURE_STAGE: readonly [number, number, number] = [0, 34, -130];

/** Seconds the launch rocket climbs before the shell bursts open. */
const LAUNCH_SECONDS = 1.05;

type ShapePoint = readonly [number, number];

/**
 * Evenly distributes `count` jittered points along a polyline (unit space),
 * proportionally to segment length, so strokes read as crisp drawn lines.
 */
function samplePolyline(
  vertices: readonly ShapePoint[],
  count: number,
  random: () => number,
  thickness: number,
  out: ShapePoint[],
): void {
  const segments: Array<{ ax: number; ay: number; bx: number; by: number; length: number }> = [];
  let totalLength = 0;
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const [ax, ay] = vertices[i]!;
    const [bx, by] = vertices[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    segments.push({ ax, ay, bx, by, length });
    totalLength += length;
  }
  if (totalLength === 0) return;
  for (let i = 0; i < count; i += 1) {
    let distance = ((i + random()) / count) * totalLength;
    let segment = segments[segments.length - 1]!;
    for (const candidate of segments) {
      if (distance <= candidate.length) {
        segment = candidate;
        break;
      }
      distance -= candidate.length;
    }
    const t = segment.length === 0 ? 0 : distance / segment.length;
    const nx = -(segment.by - segment.ay) / (segment.length || 1);
    const ny = (segment.bx - segment.ax) / (segment.length || 1);
    const jitter = (random() - 0.5) * 2 * thickness;
    out.push([
      segment.ax + (segment.bx - segment.ax) * t + nx * jitter,
      segment.ay + (segment.by - segment.ay) * t + ny * jitter,
    ]);
  }
}

/** Closed circle/ellipse approximated as a polyline, optionally rotated. */
function ellipseOutline(
  radiusX: number,
  radiusY: number,
  rotation: number,
  segments = 48,
): ShapePoint[] {
  const vertices: ShapePoint[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    vertices.push([x * cos - y * sin, x * sin + y * cos]);
  }
  return vertices;
}

/** Classic five-pointed star outline, tip up, in unit space. */
function starOutline(): ShapePoint[] {
  const vertices: ShapePoint[] = [];
  for (let k = 0; k <= 5; k += 1) {
    const outer = Math.PI / 2 + (k * 2 * Math.PI) / 5;
    vertices.push([Math.cos(outer), Math.sin(outer)]);
    if (k < 5) {
      const inner = outer + Math.PI / 5;
      vertices.push([Math.cos(inner) * 0.42, Math.sin(inner) * 0.42]);
    }
  }
  return vertices;
}

/** Crown silhouette: three peaks over a band, in unit space. */
const CROWN_OUTLINE: readonly ShapePoint[] = [
  [-0.85, -0.5], [-0.85, 0.1], [-0.45, -0.12], [0, 0.55],
  [0.45, -0.12], [0.85, 0.1], [0.85, -0.5], [-0.85, -0.5],
];

/** Jewel dots hovering over the crown's three peak tips. */
const CROWN_JEWELS: readonly ShapePoint[] = [[-0.85, 0.24], [0, 0.7], [0.85, 0.24]];

/** Samples every spark's slot in the requested figure (unit space). */
function sampleShapeTargets(
  shape: NonNullable<ParticleEffectDescriptor['shape']>,
  count: number,
  random: () => number,
): ShapePoint[] {
  const targets: ShapePoint[] = [];
  switch (shape) {
    case 'star':
      samplePolyline(starOutline(), count, random, 0.035, targets);
      break;
    case 'planet': {
      // Planet body plus a wide tilted ring, like the gacha's ringed worlds.
      const bodyCount = Math.round(count * 0.55);
      samplePolyline(ellipseOutline(0.58, 0.58, 0), bodyCount, random, 0.03, targets);
      samplePolyline(
        ellipseOutline(1.05, 0.3, -0.32),
        count - bodyCount,
        random,
        0.025,
        targets,
      );
      break;
    }
    case 'crown': {
      const jewelCount = Math.round(count * 0.12);
      samplePolyline(CROWN_OUTLINE, count - jewelCount, random, 0.03, targets);
      // Jewels are small filled discs above the peaks.
      for (let i = 0; i < jewelCount; i += 1) {
        const [cx, cy] = CROWN_JEWELS[i % CROWN_JEWELS.length]!;
        const angle = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * 0.07;
        targets.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }
      break;
    }
  }
  return targets;
}

interface FireworkGeometries {
  sparks: BufferGeometry;
  trails: BufferGeometry;
}

function buildFireworkGeometries(effect: ParticleEffectDescriptor): FireworkGeometries {
  const random = fireworkRandom(effect.seed);
  const total = Math.max(24, Math.floor(effect.particleCount));
  const shape = effect.shape ?? 'star';
  // A legacy single-scope burst draws the same figure, just small and local.
  const radius = effect.celebrationScope === 'archive' ? FIGURE_RADIUS : 8;
  const targets = sampleShapeTargets(shape, total, random);

  const positions = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const delays = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const glitters = new Float32Array(total);
  const seeds = new Float32Array(total);

  const base = new Color(effect.color ?? DEFAULT_FIREWORK_COLOR);
  // Scratch color reused per spark to avoid allocating hundreds of Colors.
  const sparkColor = new Color();

  for (let index = 0; index < total; index += 1) {
    const [ux, uy] = targets[index % targets.length] ?? [0, 0];
    // The position attribute holds each spark's final slot in the figure; the
    // vertex shader animates the journey from the center out to it.
    positions[index * 3] = ux * radius;
    positions[index * 3 + 1] = uy * radius;
    positions[index * 3 + 2] = (random() - 0.5) * 2.4;
    sizes[index] = 8 + random() * 10;
    // Sparks wait for the rocket to arrive; a tight stagger after that keeps
    // the burst reading as one single great blast.
    delays[index] = LAUNCH_SECONDS + random() * 0.35;
    glitters[index] = random() < 0.35 ? 1 : 0;
    seeds[index] = random();

    // A light cosmic-accent blend keeps the figure iridescent without washing
    // out its identity color; a white-hot minority keeps it lively.
    const accent = COSMIC_ACCENTS[Math.floor(random() * COSMIC_ACCENTS.length)]
      ?? COSMIC_ACCENTS[0]!;
    sparkColor.copy(base).lerp(accent, random() * 0.4);
    const brightness = 0.8 + random() * 0.5;
    const whiteHot = random() < 0.12 ? 0.5 : 0;
    colors[index * 3] = Math.min(1, sparkColor.r * brightness + whiteHot);
    colors[index * 3 + 1] = Math.min(1, sparkColor.g * brightness + whiteHot);
    colors[index * 3 + 2] = Math.min(1, sparkColor.b * brightness + whiteHot);
  }

  const sparks = new BufferGeometry();
  sparks.setAttribute('position', new Float32BufferAttribute(positions, 3));
  sparks.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  sparks.setAttribute('aDelay', new Float32BufferAttribute(delays, 1));
  sparks.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  sparks.setAttribute('aGlitter', new Float32BufferAttribute(glitters, 1));
  sparks.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));

  // The trail geometry duplicates every spark into a head/tail vertex pair;
  // the trail shader stretches each pair into a comet streak along its path.
  const trailPositions = new Float32Array(total * 2 * 3);
  const trailDelays = new Float32Array(total * 2);
  const trailColors = new Float32Array(total * 2 * 3);
  const trailSeeds = new Float32Array(total * 2);
  const trailEnds = new Float32Array(total * 2);
  for (let index = 0; index < total; index += 1) {
    for (let end = 0; end < 2; end += 1) {
      const vertex = index * 2 + end;
      trailPositions[vertex * 3] = positions[index * 3]!;
      trailPositions[vertex * 3 + 1] = positions[index * 3 + 1]!;
      trailPositions[vertex * 3 + 2] = positions[index * 3 + 2]!;
      trailDelays[vertex] = delays[index]!;
      trailColors[vertex * 3] = colors[index * 3]!;
      trailColors[vertex * 3 + 1] = colors[index * 3 + 1]!;
      trailColors[vertex * 3 + 2] = colors[index * 3 + 2]!;
      trailSeeds[vertex] = seeds[index]!;
      trailEnds[vertex] = end;
    }
  }
  const trails = new BufferGeometry();
  trails.setAttribute('position', new Float32BufferAttribute(trailPositions, 3));
  trails.setAttribute('aDelay', new Float32BufferAttribute(trailDelays, 1));
  trails.setAttribute('aColor', new Float32BufferAttribute(trailColors, 3));
  trails.setAttribute('aSeed', new Float32BufferAttribute(trailSeeds, 1));
  trails.setAttribute('aTrail', new Float32BufferAttribute(trailEnds, 1));

  return { sparks, trails };
}

interface FireworksVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

/**
 * GPU-driven drone-show fireworks, staged as a vast deep-background panorama:
 * a launch flash and expanding shockwave ring open the show, then hundreds of
 * sparks — each dragging a comet-like light trail — blast outward and settle
 * into one giant glowing figure (a star for new works, a ringed planet for
 * gacha pulls, a crown for achievements), hover there twinkling, and finally
 * rain apart.
 */
export function FireworksVisual({ controller, effect }: FireworksVisualProps) {
  const elapsedRef = useRef(0);
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const isArchiveShow = effect.celebrationScope === 'archive';
  const figureRadius = isArchiveShow ? FIGURE_RADIUS : 8;

  const { sparks, trails } = useMemo(() => buildFireworkGeometries(effect), [effect]);
  const ringGeometry = useMemo(() => new RingGeometry(0.96, 1, 96), []);
  const sparkMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: FIREWORK_VERTEX_SHADER,
        fragmentShader: FIREWORK_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uDuration: { value: effect.durationSeconds },
          uPixelRatio: { value: pixelRatio },
        },
      }),
    [effect.durationSeconds, pixelRatio],
  );
  const trailMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: FIREWORK_TRAIL_VERTEX_SHADER,
        fragmentShader: FIREWORK_TRAIL_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uDuration: { value: effect.durationSeconds },
        },
      }),
    [effect.durationSeconds],
  );
  const ringMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: FIREWORK_RING_VERTEX_SHADER,
        fragmentShader: FIREWORK_RING_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uRadius: { value: figureRadius * 1.05 },
          uTint: { value: new Color(effect.color ?? DEFAULT_FIREWORK_COLOR) },
        },
      }),
    [effect.color, figureRadius],
  );
  const flashMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: getStarHaloTexture(),
        color: effect.color ?? DEFAULT_FIREWORK_COLOR,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    [effect.color],
  );

  // The climbing shell: a warm-white head dragging a vertical fire trail from
  // the bottom of the sky up to the burst point.
  const rocketRef = useRef<Group>(null);
  const rocketGeometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const rocketTrailMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: METEOR_VERTEX_SHADER,
        fragmentShader: METEOR_FRAGMENT_SHADER,
        uniforms: {
          uTint: { value: new Color('#ffd9a0') },
          uFade: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    [],
  );
  const rocketHeadMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: getStarHaloTexture(),
        color: '#fff3d6',
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    controller.addResource(effect.id, 'geometry', sparks);
    controller.addResource(effect.id, 'geometry', trails);
    controller.addResource(effect.id, 'geometry', ringGeometry);
    controller.addResource(effect.id, 'geometry', rocketGeometry);
    controller.addResource(effect.id, 'material', sparkMaterial);
    controller.addResource(effect.id, 'material', trailMaterial);
    controller.addResource(effect.id, 'material', ringMaterial);
    controller.addResource(effect.id, 'material', flashMaterial);
    controller.addResource(effect.id, 'material', rocketTrailMaterial);
    controller.addResource(effect.id, 'material', rocketHeadMaterial);
    controller.addAnimation(effect.id, () => {
      elapsedRef.current = 0;
    });
  }, [
    controller,
    effect.id,
    sparks,
    trails,
    ringGeometry,
    rocketGeometry,
    sparkMaterial,
    trailMaterial,
    ringMaterial,
    flashMaterial,
    rocketTrailMaterial,
    rocketHeadMaterial,
  ]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const elapsed = elapsedRef.current;
    // Sparks and their comet trails wait out the climb via per-spark delays.
    sparkMaterial.uniforms.uTime!.value = elapsed;
    sparkMaterial.uniforms.uPixelRatio!.value = pixelRatio;
    trailMaterial.uniforms.uTime!.value = elapsed;

    // Flash and shockwave ignite the moment the rocket reaches the apex.
    const sinceBurst = elapsed - LAUNCH_SECONDS;
    ringMaterial.uniforms.uTime!.value = Math.max(0, sinceBurst);
    flashMaterial.opacity = sinceBurst >= 0
      ? Math.pow(Math.max(0, 1 - sinceBurst / 0.55), 1.6) * 0.9
      : 0;

    // The rocket eases up from far below, swaying gently, and winks out at
    // the apex just as the shell bursts.
    const climb = Math.min(1, elapsed / LAUNCH_SECONDS);
    const eased = 1 - Math.pow(1 - climb, 2.2);
    const rocket = rocketRef.current;
    if (rocket !== null) {
      rocket.position.set(Math.sin(climb * 6) * 5 * (1 - climb), -170 * (1 - eased), 0);
      rocket.visible = elapsed < LAUNCH_SECONDS + 0.08;
    }
    const rocketFade =
      Math.min(climb / 0.12, 1) * (1 - Math.max(0, (climb - 0.9) / 0.1));
    rocketTrailMaterial.uniforms.uFade!.value = Math.max(0, rocketFade);
    rocketTrailMaterial.uniforms.uTime!.value = elapsed;
    rocketHeadMaterial.opacity = Math.max(0, rocketFade);
  });

  // The celebration figure is staged on the deep backdrop, not the new work.
  const origin: readonly [number, number, number] = isArchiveShow
    ? FIGURE_STAGE
    : [effect.origin.x, effect.origin.y, effect.origin.z];
  const flashScale = figureRadius * 0.8;

  return (
    <group
      name="particle-effect-fireworks"
      position={origin}
      userData={{
        effectId: effect.id,
        particleCount: effect.particleCount,
        shape: effect.shape ?? 'star',
        celebrationScope: effect.celebrationScope ?? 'single',
      }}
    >
      <points
        frustumCulled={false}
        geometry={sparks}
        material={sparkMaterial}
        name="firework-sparks"
      />
      <lineSegments
        frustumCulled={false}
        geometry={trails}
        material={trailMaterial}
        name="firework-trails"
      />
      <mesh
        frustumCulled={false}
        geometry={ringGeometry}
        material={ringMaterial}
        name="firework-shockwave"
      />
      <sprite
        material={flashMaterial}
        name="firework-flash"
        scale={[flashScale, flashScale, 1]}
      />
      <group name="firework-rocket" ref={rocketRef}>
        {/* Rotated so the meteor shader's head (+x) points straight up. */}
        <group rotation={[0, 0, Math.PI / 2]}>
          <mesh
            frustumCulled={false}
            geometry={rocketGeometry}
            material={rocketTrailMaterial}
            scale={[30, 3, 1]}
          />
          <sprite
            material={rocketHeadMaterial}
            position={[15, 0, 0]}
            scale={[8, 8, 1]}
          />
        </group>
      </group>
    </group>
  );
}

const METEOR_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const METEOR_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTint;
  uniform float uFade;
  uniform float uTime;

  void main() {
    // Head at x=1, tail at x=0; the trail tapers and dims toward the tail.
    float head = pow(vUv.x, 2.4);
    float taper = 3.0 + 10.0 * (1.0 - vUv.x);
    float across = exp(-pow((vUv.y - 0.5) * taper, 2.0));
    // Lengthwise shimmer so the trail flickers like burning debris.
    float shimmer = 0.85 + 0.15 * sin(vUv.x * 46.0 - uTime * 34.0);
    float alpha = head * across * shimmer * uFade;
    if (alpha <= 0.004) discard;
    // White-hot head cooling into the icy tint along the tail.
    vec3 color = mix(uTint, vec3(1.0), pow(vUv.x, 5.0));
    gl_FragColor = vec4(color * (0.8 + 0.7 * head), alpha);
  }
`;

/** Travel vector matching the legacy trail path (down-right across the sky). */
const METEOR_TRAVEL = { x: 65, y: -32 } as const;
const METEOR_ANGLE = Math.atan2(METEOR_TRAVEL.y, METEOR_TRAVEL.x);

interface MeteorStreak {
  offset: readonly [number, number, number];
  delayFraction: number;
  length: number;
  width: number;
}

interface MeteorVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

/**
 * Shooting stars rendered as tapered light streaks with a white-hot glowing
 * head, replacing the old box-chain trails. A meteor shower spawns several
 * parallel streaks with slight offsets and staggered starts.
 */
export function MeteorVisual({ controller, effect }: MeteorVisualProps) {
  const groupRefs = useRef<(Group | null)[]>([]);
  const elapsedRef = useRef(0);

  const streaks = useMemo<MeteorStreak[]>(() => {
    const random = fireworkRandom(effect.seed);
    return Array.from({ length: Math.max(1, effect.trailCount) }, (_, index) => ({
      offset: [
        -index * 7 + (random() - 0.5) * 4,
        index * 3 + (random() - 0.5) * 3,
        (random() - 0.5) * 2,
      ] as const,
      delayFraction: index === 0 ? 0 : index * 0.1 + random() * 0.05,
      length: 11 + random() * 5,
      width: 0.55 + random() * 0.35,
    }));
  }, [effect.seed, effect.trailCount]);

  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const trailMaterials = useMemo(
    () => streaks.map(() =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: METEOR_VERTEX_SHADER,
        fragmentShader: METEOR_FRAGMENT_SHADER,
        uniforms: {
          uTint: { value: new Color(effectColor(effect.kind)) },
          uFade: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    ),
    [effect.kind, streaks],
  );
  const headMaterials = useMemo(
    () => streaks.map(() =>
      new SpriteMaterial({
        map: getStarHaloTexture(),
        color: '#f2faff',
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    ),
    [streaks],
  );

  useEffect(() => {
    controller.addResource(effect.id, 'geometry', geometry);
    for (const material of trailMaterials) {
      controller.addResource(effect.id, 'material', material);
    }
    for (const material of headMaterials) {
      controller.addResource(effect.id, 'material', material);
    }
    controller.addAnimation(effect.id, () => {
      elapsedRef.current = 0;
    });
  }, [controller, effect.id, geometry, headMaterials, trailMaterials]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const progress = Math.min(1, elapsedRef.current / effect.durationSeconds);

    streaks.forEach((streak, index) => {
      const local = Math.min(
        1,
        Math.max(0, (progress - streak.delayFraction) / Math.max(0.2, 1 - streak.delayFraction)),
      );
      // Quick ignition, long graceful fade-out.
      const fade = Math.min(local / 0.12, 1) * (1 - Math.max(0, (local - 0.72) / 0.28));

      const trailMaterial = trailMaterials[index];
      if (trailMaterial !== undefined) {
        trailMaterial.uniforms.uFade!.value = Math.max(0, fade);
        trailMaterial.uniforms.uTime!.value = elapsedRef.current;
      }
      const headMaterial = headMaterials[index];
      if (headMaterial !== undefined) headMaterial.opacity = Math.max(0, fade) * 0.9;

      const group = groupRefs.current[index];
      if (group !== null && group !== undefined) {
        group.position.set(
          effect.origin.x + streak.offset[0] + METEOR_TRAVEL.x * local,
          effect.origin.y + streak.offset[1] + METEOR_TRAVEL.y * local,
          effect.origin.z + streak.offset[2],
        );
      }
    });
  });

  return (
    <group
      name={`particle-effect-${effect.kind}`}
      userData={{ effectId: effect.id, trailCount: effect.trailCount }}
    >
      {streaks.map((streak, index) => (
        <group
          key={`${effect.id}:streak:${index}`}
          ref={(element) => {
            groupRefs.current[index] = element;
          }}
          rotation={[0, 0, METEOR_ANGLE]}
        >
          <mesh
            geometry={geometry}
            material={trailMaterials[index]}
            name="meteor-trail"
            scale={[streak.length, streak.width * 3.4, 1]}
          />
          <sprite
            material={headMaterials[index]}
            name="meteor-head"
            position={[streak.length * 0.48, 0, 0]}
            scale={[streak.width * 3.6, streak.width * 3.6, 1]}
          />
        </group>
      ))}
    </group>
  );
}

interface EffectVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

function EffectVisual({ controller, effect }: EffectVisualProps) {
  const groupRef = useRef<Group>(null);
  const elapsedRef = useRef(0);
  const hasCore =
    effect.kind === 'asteroid-impact' ||
    effect.kind === 'blackhole-spiral' ||
    effect.kind === 'restore-pulse';
  const visualCount = effect.particleCount;
  const directions = useMemo(
    () => Array.from({ length: visualCount }, (_, index) => particleDirection(effect.seed, index)),
    [effect.seed, visualCount],
  );
  const cancelAnimation = useCallback(() => {
    elapsedRef.current = 0;
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      controller.addResource(effect.id, 'geometry', object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        controller.addResource(effect.id, 'material', material);
      }
    });
    controller.addAnimation(effect.id, cancelAnimation);
  }, [cancelAnimation, controller, effect.id]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const progress = Math.min(1, elapsedRef.current / effect.durationSeconds);
    const remaining = 1 - progress;
    const group = groupRef.current;
    if (group === null) return;

    if (effect.kind === 'blackhole-spiral') {
      const angle = progress * Math.max(2, effect.rotations) * Math.PI * 2;
      const baseX = effect.origin.x + (BLACKHOLE_POSITION.x - effect.origin.x) * progress;
      const baseY = effect.origin.y + (BLACKHOLE_POSITION.y - effect.origin.y) * progress;
      const baseZ = effect.origin.z + (BLACKHOLE_POSITION.z - effect.origin.z) * progress;
      group.position.set(
        baseX + Math.cos(angle) * 3 * remaining,
        baseY + Math.sin(angle) * 3 * remaining,
        baseZ,
      );
      group.rotation.z = angle;
      group.scale.setScalar(Math.max(0.001, remaining));
    } else if (effect.kind === 'restore-pulse') {
      group.position.set(effect.origin.x, effect.origin.y, effect.origin.z);
      const scale = effect.scaleFrom + (effect.scaleTo - effect.scaleFrom) * progress;
      group.scale.setScalar(Math.max(0.001, scale));
    } else {
      group.position.set(effect.origin.x, effect.origin.y, effect.origin.z);
      group.children.forEach((child, index) => {
        if (child.name === 'effect-core') {
          const scale = effect.scaleFrom + (effect.scaleTo - effect.scaleFrom) * progress;
          child.scale.setScalar(Math.max(0.001, scale));
          return;
        }
        const direction = directions[index];
        if (direction === undefined) return;
        const distance = progress * 8;
        child.position.set(
          direction[0] * distance,
          direction[1] * distance,
          direction[2] * distance,
        );
      });
    }

    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.opacity = remaining;
    });
  });

  return (
    <group
      name={`particle-effect-${effect.kind}`}
      ref={groupRef}
      userData={{
        effectId: effect.id,
        particleCount: effect.particleCount,
        trailCount: effect.trailCount,
      }}
    >
      {directions.map((direction, index) => (
        <mesh
          key={`${effect.id}:particle:${index}`}
          name="effect-particle"
          position={
            effect.kind === 'blackhole-spiral'
              ? [direction[0] * 2.5, direction[1] * 2.5, direction[2]]
              : [0, 0, 0]
          }
        >
          <sphereGeometry args={[effect.kind === 'asteroid-impact' ? 0.18 : 0.12, 6, 4]} />
          <meshBasicMaterial
            blending={AdditiveBlending}
            color={effectColor(effect.kind)}
            depthWrite={false}
            opacity={1}
            transparent
            toneMapped={false}
          />
        </mesh>
      ))}
      {hasCore ? (
        <mesh name="effect-core">
          <sphereGeometry args={[0.9, 14, 10]} />
          <meshBasicMaterial
            blending={AdditiveBlending}
            color={effectColor(effect.kind)}
            depthWrite={false}
            transparent
            toneMapped={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Compiles the firework and meteor shader programs (plus the sprite program)
 * on the very first frame by drawing fully-transparent one-vertex stand-ins.
 * Without this, the first burst or shooting star pays the GLSL compile cost
 * mid-animation, which can black-flash a frame on slower GPUs.
 */
function EffectShaderWarmup() {
  const fireworkGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, -900, 0], 3));
    geometry.setAttribute('aDir', new Float32BufferAttribute([0, 1, 0], 3));
    geometry.setAttribute('aSpeed', new Float32BufferAttribute([1], 1));
    geometry.setAttribute('aSize', new Float32BufferAttribute([1], 1));
    geometry.setAttribute('aDelay', new Float32BufferAttribute([9_999], 1));
    geometry.setAttribute('aColor', new Float32BufferAttribute([1, 1, 1], 3));
    geometry.setAttribute('aGravity', new Float32BufferAttribute([0], 1));
    geometry.setAttribute('aGlitter', new Float32BufferAttribute([0], 1));
    return geometry;
  }, []);
  const fireworkMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: FIREWORK_VERTEX_SHADER,
        fragmentShader: FIREWORK_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uDuration: { value: 1 },
          uPixelRatio: { value: 1 },
          uSpread: { value: 1 },
        },
      }),
    [],
  );
  const meteorGeometry = useMemo(() => new PlaneGeometry(0.01, 0.01), []);
  const meteorMaterial = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: METEOR_VERTEX_SHADER,
        fragmentShader: METEOR_FRAGMENT_SHADER,
        uniforms: {
          uTint: { value: new Color('#ffffff') },
          uFade: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    [],
  );
  const headMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: getStarHaloTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => {
    fireworkGeometry.dispose();
    fireworkMaterial.dispose();
    meteorGeometry.dispose();
    meteorMaterial.dispose();
    headMaterial.dispose();
  }, [fireworkGeometry, fireworkMaterial, headMaterial, meteorGeometry, meteorMaterial]);

  return (
    <group name="effect-shader-warmup" position={[0, -900, 0]}>
      <points frustumCulled={false} geometry={fireworkGeometry} material={fireworkMaterial} />
      <mesh frustumCulled={false} geometry={meteorGeometry} material={meteorMaterial} />
      <sprite material={headMaterial} scale={[0.01, 0.01, 1]} />
    </group>
  );
}

export interface ParticleManagerProps {
  store: ArchiveStoreApi;
  minimumParticleCounts?: boolean;
  random?: () => number;
  timer?: ParticleTimer;
  onDisposalDiagnostic?: (diagnostic: DisposalDiagnostic) => void;
}

/**
 * Starts effects only from committed completion events. Event IDs are marked before
 * consumption, while the controller also rejects duplicate descriptor IDs.
 */
export function ParticleManager({
  store,
  minimumParticleCounts = false,
  random = Math.random,
  timer = browserParticleTimer,
  onDisposalDiagnostic,
}: ParticleManagerProps) {
  const completionEvents = useStore(store, (state) => state.runtime.completionEvents);
  const handledEventIds = useRef(new Set<string>());
  const registry = useMemo(
    () => new EffectLifecycleRegistry(timer, (diagnostic) => {
      onDisposalDiagnostic?.(diagnostic);
    }),
    [onDisposalDiagnostic, timer],
  );
  const controller = useMemo(
    () => new ParticleEffectController(timer, registry, random),
    [random, registry, timer],
  );
  const [effects, setEffects] = useState<readonly ParticleEffectDescriptor[]>([]);
  const scheduler = useMemo(() => new BackgroundMeteorScheduler({
    timer,
    random,
    spawn: (effect, onExpired) => controller.start(effect, onExpired),
    cancel: (effectId) => controller.cancel(effectId),
  }), [controller, random, timer]);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setEffects);
    return () => {
      unsubscribe();
    };
  }, [controller]);

  useEffect(() => {
    for (const event of completionEvents) {
      if (handledEventIds.current.has(event.id)) continue;
      handledEventIds.current.add(event.id);
      controller.startEvent(event, { minimumCounts: minimumParticleCounts });
      store.getState().commands.consumeCompletionEvent(event.id);
    }
  }, [completionEvents, controller, minimumParticleCounts, store]);

  const updateVisibility = useCallback(() => {
    scheduler.setVisible(document.visibilityState === 'visible');
  }, [scheduler]);
  useEffect(() => {
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      scheduler.dispose();
      controller.dispose();
    };
  }, [controller, scheduler, updateVisibility]);

  return (
    <group name="particle-effects">
      <EffectShaderWarmup />
      {effects.map((effect) => {
        if (effect.kind === 'fireworks') {
          return <FireworksVisual controller={controller} effect={effect} key={effect.id} />;
        }
        if (effect.kind === 'meteor-shower' || effect.kind === 'background-meteor') {
          return <MeteorVisual controller={controller} effect={effect} key={effect.id} />;
        }
        return <EffectVisual controller={controller} effect={effect} key={effect.id} />;
      })}
    </group>
  );
}
