import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  Mesh,
  type Group,
} from 'three';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { BLACKHOLE_POSITION } from './blackholeModel';
import {
  BackgroundMeteorScheduler,
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

function effectColor(effect: ParticleEffectDescriptor): string {
  if (effect.color !== undefined) return effect.color;
  switch (effect.kind) {
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
        if (effect.kind === 'fireworks') {
          // Ease-out burst with gravity so sparks shoot out then arc down.
          const spread = (1 - remaining * remaining) * 11;
          const gravity = progress * progress * 4.5;
          child.position.set(
            direction[0] * spread,
            direction[1] * spread - gravity,
            direction[2] * spread,
          );
          return;
        }
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
            color={effectColor(effect)}
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
            color={effectColor(effect)}
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
      {effects.map((effect) => (
        <EffectVisual controller={controller} effect={effect} key={effect.id} />
      ))}
    </group>
  );
}
