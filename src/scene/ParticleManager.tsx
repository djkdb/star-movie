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
  Points,
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

  void main() {
    // Normalize each spark's life over the effect window, leaving headroom so
    // the most-delayed spark still completes its full fade before cleanup.
    float t = clamp((uTime - aDelay) / max(0.1, uDuration - 0.9), 0.0, 1.0);
    // Formation: sparks race out from the shell's heart to their slot in the
    // figure, easing to a stop like drones settling into a light show.
    float form = 1.0 - pow(1.0 - clamp(t / 0.3, 0.0, 1.0), 3.0);
    float settled = smoothstep(0.26, 0.4, t);
    vec3 pos = position * form;
    // The formed figure hovers and breathes like a drone constellation.
    pos.x += sin(uTime * 1.3 + aSeed * 43.0) * 0.45 * settled;
    pos.y += cos(uTime * 1.1 + aSeed * 57.0) * 0.45 * settled;
    // Finale: the figure loosens, swells, and sinks as its sparks burn out.
    float fall = smoothstep(0.72, 1.0, t);
    pos *= 1.0 + fall * 0.22;
    pos.y -= fall * fall * 8.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float appear = smoothstep(0.0, 0.05, t);
    float fade = 1.0 - smoothstep(0.76, 1.0, t);
    float twinkle = 0.8 + 0.2 * sin(uTime * 8.0 + aSeed * 89.0);
    // Glitter sparks strobe once the figure has formed, like crackle stars.
    float strobe = step(0.35, fract(sin(floor(uTime * 14.0) + aSeed * 61.0) * 43758.5453));
    float crackle = mix(1.0, strobe * 1.6, settled);
    vAlpha = appear * fade * mix(twinkle, crackle, aGlitter);

    // Color evolution: white-hot launch flash -> figure tint -> dim ember.
    vec3 tinted = mix(vec3(1.0), aColor, smoothstep(0.02, 0.3, t));
    vec3 ember = aColor * 0.55 + vec3(0.12, 0.04, 0.0);
    vColor = mix(tinted, ember, smoothstep(0.82, 1.0, t));

    // Cap the screen-space size: nearby sparks otherwise balloon into huge
    // additive quads whose overdraw stalls weaker GPUs into dropped frames.
    float px = aSize * uPixelRatio * (300.0 / max(1.0, -mvPosition.z));
    gl_PointSize = min(px, 64.0 * uPixelRatio);
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

/** World-space radius of the backdrop figure (about 40% of the visible sky). */
const FIGURE_RADIUS = 26;

/** Backdrop stage: centered high in the sky, behind the stars and blackhole. */
const FIGURE_STAGE: readonly [number, number, number] = [0, 10, -40];

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

function buildFireworkGeometry(effect: ParticleEffectDescriptor): BufferGeometry {
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
    sizes[index] = 5.5 + random() * 6.5;
    delays[index] = random() * 0.5;
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

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aDelay', new Float32BufferAttribute(delays, 1));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aGlitter', new Float32BufferAttribute(glitters, 1));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  return geometry;
}

interface FireworksVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

/**
 * GPU-driven drone-show fireworks: a burst of sparks races out from a central
 * flash and settles into one giant glowing figure on the backdrop sky — a star
 * for new works, a ringed planet for gacha pulls, a crown for achievements —
 * hovers there twinkling, then loosens and sinks away.
 */
export function FireworksVisual({ controller, effect }: FireworksVisualProps) {
  const pointsRef = useRef<Points>(null);
  const elapsedRef = useRef(0);
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const isArchiveShow = effect.celebrationScope === 'archive';

  const geometry = useMemo(() => buildFireworkGeometry(effect), [effect]);
  const material = useMemo(
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

  useEffect(() => {
    controller.addResource(effect.id, 'geometry', geometry);
    controller.addResource(effect.id, 'material', material);
    controller.addAnimation(effect.id, () => {
      elapsedRef.current = 0;
    });
  }, [controller, effect.id, geometry, material]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    material.uniforms.uTime!.value = elapsedRef.current;
    material.uniforms.uPixelRatio!.value = pixelRatio;
  });

  // The celebration figure is staged on the backdrop sky, not the new work.
  const origin: readonly [number, number, number] = isArchiveShow
    ? FIGURE_STAGE
    : [effect.origin.x, effect.origin.y, effect.origin.z];

  return (
    <points
      frustumCulled={false}
      geometry={geometry}
      material={material}
      name="particle-effect-fireworks"
      position={origin}
      ref={pointsRef}
      userData={{
        effectId: effect.id,
        particleCount: effect.particleCount,
        shape: effect.shape ?? 'star',
        celebrationScope: effect.celebrationScope ?? 'single',
      }}
    />
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
