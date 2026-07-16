import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  Points,
  ShaderMaterial,
  type Group,
} from 'three';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { BLACKHOLE_POSITION } from './blackholeModel';
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
  attribute vec3 aDir;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aDelay;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uDuration;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float t = max(0.0, uTime - aDelay);
    float life = clamp(t / uDuration, 0.0, 1.0);
    // Fast initial expansion easing out, like sparks losing momentum to drag.
    float expo = 1.0 - pow(1.0 - life, 2.3);
    float dist = aSpeed * expo * 9.5;
    vec3 gravity = vec3(0.0, -3.0 * t * t, 0.0);
    vec3 worldPos = position + aDir * dist + gravity;

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float appear = smoothstep(0.0, 0.05, t);
    float fade = 1.0 - smoothstep(0.5, 1.0, life);
    float twinkle = 0.7 + 0.3 * sin(uTime * 42.0 + aDelay * 30.0 + aSpeed * 12.0);
    vAlpha = appear * fade * twinkle;
    vColor = aColor;
    gl_PointSize = aSize * uPixelRatio * (210.0 / max(1.0, -mvPosition.z));
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

function buildFireworkGeometry(effect: ParticleEffectDescriptor): BufferGeometry {
  const random = fireworkRandom(effect.seed);
  const burstCount = Math.max(1, effect.burstCount ?? 1);
  const perBurst = Math.max(1, effect.particleCount);
  const total = perBurst * burstCount;

  const positions = new Float32Array(total * 3);
  const directions = new Float32Array(total * 3);
  const speeds = new Float32Array(total);
  const sizes = new Float32Array(total);
  const delays = new Float32Array(total);
  const colors = new Float32Array(total * 3);

  const base = new Color(effect.color ?? DEFAULT_FIREWORK_COLOR);
  // Multiple bursts spread across the sky for that "festival" panorama; a lone
  // burst stays centered on the work's own position.
  const spreadX = burstCount > 1 ? 22 : 0;
  const spreadY = burstCount > 1 ? 12 : 0;
  const spreadZ = burstCount > 1 ? 10 : 0;

  let index = 0;
  for (let burst = 0; burst < burstCount; burst += 1) {
    const originX = (random() - 0.5) * 2 * spreadX;
    const originY = (random() - 0.5) * 2 * spreadY + (burst > 0 ? 4 : 0);
    const originZ = (random() - 0.5) * 2 * spreadZ;
    // Stagger the shells so they crackle open one after another.
    const burstDelay = burst === 0 ? random() * 0.12 : 0.1 + random() * 0.65;

    for (let particle = 0; particle < perBurst; particle += 1) {
      const theta = 2 * Math.PI * random();
      const cosinePhi = 2 * random() - 1;
      const sinePhi = Math.sqrt(Math.max(0, 1 - cosinePhi * cosinePhi));
      // Bias toward a shell (uniform-ish radius) with a few faster outliers.
      const radial = 0.55 + random() * 0.5;

      positions[index * 3] = originX;
      positions[index * 3 + 1] = originY;
      positions[index * 3 + 2] = originZ;
      directions[index * 3] = sinePhi * Math.cos(theta);
      directions[index * 3 + 1] = cosinePhi;
      directions[index * 3 + 2] = sinePhi * Math.sin(theta);
      speeds[index] = radial;
      sizes[index] = 4.5 + random() * 7;
      delays[index] = burstDelay + random() * 0.08;

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
function FireworksVisual({ controller, effect }: FireworksVisualProps) {
  const pointsRef = useRef<Points>(null);
  const elapsedRef = useRef(0);
  const pixelRatio = useThree((state) => state.viewport.dpr);

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

  return (
    <points
      geometry={geometry}
      material={material}
      name="particle-effect-fireworks"
      position={[effect.origin.x, effect.origin.y, effect.origin.z]}
      ref={pointsRef}
      userData={{
        effectId: effect.id,
        particleCount: effect.particleCount,
        burstCount: effect.burstCount ?? 1,
      }}
    />
  );
}

interface EffectVisualProps {
  controller: ParticleEffectController;
  effect: ParticleEffectDescriptor;
}

function EffectVisual({ controller, effect }: EffectVisualProps) {
  const groupRef = useRef<Group>(null);
  const elapsedRef = useRef(0);
  const isTrail = effect.kind === 'meteor-shower' || effect.kind === 'background-meteor';
  const hasCore =
    effect.kind === 'asteroid-impact' ||
    effect.kind === 'blackhole-spiral' ||
    effect.kind === 'restore-pulse';
  const visualCount = isTrail ? effect.trailCount : effect.particleCount;
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
    } else if (isTrail) {
      group.position.set(
        effect.origin.x + progress * 65,
        effect.origin.y - progress * 32,
        effect.origin.z,
      );
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
          name={isTrail ? 'effect-trail' : 'effect-particle'}
          position={
            effect.kind === 'blackhole-spiral'
              ? [direction[0] * 2.5, direction[1] * 2.5, direction[2]]
              : isTrail
                ? [-index * 5, index * 1.5, index * 0.2]
                : [0, 0, 0]
          }
        >
          {isTrail
            ? <boxGeometry args={[10, 0.12, 0.12]} />
            : <sphereGeometry args={[effect.kind === 'asteroid-impact' ? 0.18 : 0.12, 6, 4]} />}
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
      {effects.map((effect) =>
        effect.kind === 'fireworks' ? (
          <FireworksVisual controller={controller} effect={effect} key={effect.id} />
        ) : (
          <EffectVisual controller={controller} effect={effect} key={effect.id} />
        ),
      )}
    </group>
  );
}
