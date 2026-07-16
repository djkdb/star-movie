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
  fireworkSparksPerBurst,
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
  attribute vec3 aDir;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aDelay;
  attribute vec3 aColor;
  attribute float aGravity;
  attribute float aGlitter;
  uniform float uTime;
  uniform float uDuration;
  uniform float uPixelRatio;
  uniform float uSpread;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float t = max(0.0, uTime - aDelay);
    float life = clamp(t / uDuration, 0.0, 1.0);
    // Fast initial expansion easing out, like sparks losing momentum to drag.
    float expo = 1.0 - pow(1.0 - life, 2.3);
    float dist = aSpeed * expo * uSpread;
    vec3 gravity = vec3(0.0, -aGravity * t * t, 0.0);
    vec3 worldPos = position + aDir * dist + gravity;

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float appear = smoothstep(0.0, 0.04, t);
    float fade = 1.0 - smoothstep(0.45, 1.0, life);
    float twinkle = 0.72 + 0.28 * sin(uTime * 42.0 + aDelay * 30.0 + aSpeed * 12.0);
    // Glitter sparks strobe hard through the back half of their life, like
    // crackle stars in a real shell.
    float strobe = step(0.4, fract(sin(floor(uTime * 24.0) + aDelay * 57.0) * 43758.5453));
    float crackle = mix(1.0, strobe * 1.7, smoothstep(0.3, 0.55, life));
    vAlpha = appear * fade * mix(twinkle, crackle, aGlitter);

    // Color evolution: white-hot flash -> genre tint -> dim ember.
    vec3 ember = aColor * vec3(0.6, 0.32, 0.16) + vec3(0.2, 0.05, 0.0);
    vec3 tinted = mix(vec3(1.0), aColor, smoothstep(0.03, 0.28, life));
    vColor = mix(tinted, ember, smoothstep(0.62, 1.0, life));

    float shrink = 1.0 - 0.45 * life;
    // Cap the screen-space size: nearby sparks otherwise balloon into huge
    // additive quads whose overdraw stalls weaker GPUs into dropped frames.
    float px = aSize * shrink * uPixelRatio * (210.0 / max(1.0, -mvPosition.z));
    gl_PointSize = min(px, 42.0 * uPixelRatio);
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

type FireworkBurstShape = 'peony' | 'ring' | 'willow';

function pickBurstShape(roll: number): FireworkBurstShape {
  if (roll < 0.45) return 'peony';
  if (roll < 0.75) return 'ring';
  return 'willow';
}

function buildFireworkGeometry(effect: ParticleEffectDescriptor): BufferGeometry {
  const random = fireworkRandom(effect.seed);
  const burstCount = Math.max(1, effect.burstCount ?? 1);
  const perBurst = fireworkSparksPerBurst(effect.particleCount, burstCount);
  const total = perBurst * burstCount;

  const positions = new Float32Array(total * 3);
  const directions = new Float32Array(total * 3);
  const speeds = new Float32Array(total);
  const sizes = new Float32Array(total);
  const delays = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const gravities = new Float32Array(total);
  const glitters = new Float32Array(total);

  const base = new Color(effect.color ?? DEFAULT_FIREWORK_COLOR);
  const isArchiveShow = effect.celebrationScope === 'archive';
  // Archive celebrations scatter shells across the whole visible sky so the
  // show fills the screen; a lone single-scope burst stays on its own work.
  const spreadX = isArchiveShow ? 52 : burstCount > 1 ? 22 : 0;
  const spreadY = isArchiveShow ? 28 : burstCount > 1 ? 12 : 0;
  const spreadZ = isArchiveShow ? 22 : burstCount > 1 ? 10 : 0;
  const sparkScale = isArchiveShow ? 1.25 : 1;

  let index = 0;
  for (let burst = 0; burst < burstCount; burst += 1) {
    const originX = (random() - 0.5) * 2 * spreadX;
    const originY = (random() - 0.5) * 2 * spreadY + (burst > 0 ? 4 : 0);
    const originZ = (random() - 0.5) * 2 * spreadZ;
    // Stagger the shells so they crackle open one after another; the archive
    // show rolls its volleys across a longer window like a real finale.
    const burstDelay = burst === 0
      ? random() * (isArchiveShow ? 0.5 : 0.12)
      : 0.1 + random() * (isArchiveShow ? 1.4 : 0.65);
    // Each shell opens with its own character: classic spherical peony, a
    // tilted ring, or a drooping willow with heavy trailing sparks.
    const shape = pickBurstShape(random());

    // Random ring plane for 'ring' shells.
    const normalTheta = 2 * Math.PI * random();
    const normalCosPhi = 2 * random() - 1;
    const normalSinPhi = Math.sqrt(Math.max(0, 1 - normalCosPhi * normalCosPhi));
    const nx = normalSinPhi * Math.cos(normalTheta);
    const ny = normalCosPhi;
    const nz = normalSinPhi * Math.sin(normalTheta);
    // Orthonormal basis (u, v) spanning the ring plane.
    let ux = 1;
    const uy = 0;
    let uz = 0;
    if (Math.abs(ny) < 0.9) {
      const planeLength = Math.hypot(nz, nx);
      ux = nz / planeLength;
      uz = -nx / planeLength;
    }
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    for (let particle = 0; particle < perBurst; particle += 1) {
      let dirX: number;
      let dirY: number;
      let dirZ: number;
      let radial: number;
      let gravity: number;

      if (shape === 'ring') {
        const angle = 2 * Math.PI * random();
        const jitter = (random() - 0.5) * 0.24;
        dirX = Math.cos(angle) * ux + Math.sin(angle) * vx + nx * jitter;
        dirY = Math.cos(angle) * uy + Math.sin(angle) * vy + ny * jitter;
        dirZ = Math.cos(angle) * uz + Math.sin(angle) * vz + nz * jitter;
        radial = 0.75 + random() * 0.3;
        gravity = 2.4;
      } else {
        const theta = 2 * Math.PI * random();
        const cosinePhi = 2 * random() - 1;
        const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));
        dirX = sinePhi * Math.cos(theta);
        dirY = cosinePhi;
        dirZ = sinePhi * Math.sin(theta);
        if (shape === 'willow') {
          // Slower sparks pulled down hard: long weeping trails.
          radial = 0.45 + random() * 0.35;
          gravity = 5.4 + random() * 2.2;
        } else {
          // Peony: shell-biased radius with a few faster outliers.
          radial = 0.55 + random() * 0.5;
          gravity = 2.6 + random() * 0.9;
        }
      }

      positions[index * 3] = originX;
      positions[index * 3 + 1] = originY;
      positions[index * 3 + 2] = originZ;
      directions[index * 3] = dirX;
      directions[index * 3 + 1] = dirY;
      directions[index * 3 + 2] = dirZ;
      speeds[index] = radial;
      sizes[index] = (4.5 + random() * 7) * sparkScale;
      delays[index] = burstDelay + random() * 0.08;
      gravities[index] = gravity;
      glitters[index] = random() < 0.3 ? 1 : 0;

      // Per-spark brightness jitter plus a warm-white hot core minority.
      const brightness = 0.7 + random() * 0.6;
      const whiteHot = random() < 0.15 ? 0.5 : 0;
      colors[index * 3] = Math.min(1, base.r * brightness + whiteHot);
      colors[index * 3 + 1] = Math.min(1, base.g * brightness + whiteHot);
      colors[index * 3 + 2] = Math.min(1, base.b * brightness + whiteHot);
      index += 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDir', new Float32BufferAttribute(directions, 3));
  geometry.setAttribute('aSpeed', new Float32BufferAttribute(speeds, 1));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aDelay', new Float32BufferAttribute(delays, 1));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aGravity', new Float32BufferAttribute(gravities, 1));
  geometry.setAttribute('aGlitter', new Float32BufferAttribute(glitters, 1));
  return geometry;
}

interface FireworksVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

/**
 * GPU-driven genre-colored fireworks. Each work bursts into one or more shells
 * (more shells for genres you have watched more of) that fan out, arc down under
 * gravity, twinkle, and fade — a wide, celebratory panorama rather than a single
 * yellow pop.
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
          // Show shells balloon far wider so a burst can swallow the screen.
          uSpread: { value: isArchiveShow ? 17 : 9.5 },
        },
      }),
    [effect.durationSeconds, isArchiveShow, pixelRatio],
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

  // The personal show centers on the sky as a whole, not the new work.
  const origin: readonly [number, number, number] = isArchiveShow
    ? [0, 6, -10]
    : [effect.origin.x, effect.origin.y, effect.origin.z];

  return (
    <points
      geometry={geometry}
      material={material}
      name="particle-effect-fireworks"
      position={origin}
      ref={pointsRef}
      userData={{
        effectId: effect.id,
        particleCount: effect.particleCount,
        burstCount: effect.burstCount ?? 1,
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
