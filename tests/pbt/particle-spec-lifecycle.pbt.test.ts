// Feature: space-movie-archive, Property 17: 파티클 사양과 수명주기
// **Validates: Requirements 2.17, 2.18, 11.1, 11.2, 11.3, 11.4, 11.5, 13.7, 13.8**
import fc from 'fast-check';
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';

import type { Rating, RuntimeEvent, Vec3 } from '../../src/domain/models';
import {
  ASTEROID_DEBRIS_RANGE,
  ASTEROID_IMPACT_DURATION_SECONDS,
  BLACKHOLE_SPIRAL_DURATION_SECONDS,
  BLACKHOLE_SPIRAL_ROTATIONS,
  EffectLifecycleRegistry,
  FIREWORK_DURATION_SECONDS,
  FIREWORK_PARTICLE_RANGE,
  METEOR_SHOWER_DURATION_SECONDS,
  METEOR_SHOWER_TRAIL_RANGE,
  ParticleEffectController,
  createParticleEffectsForEvent,
  type EffectResourceKind,
  type ParticleEffectDescriptor,
} from '../../src/scene/particleManagerModel';
import { ThreeResourceRegistry } from '../../src/scene/threeResourceRegistry';
import { FakeClock, SeededPrng } from '../../src/test/providers';

type CompletionCase =
  | { type: 'work-added'; rating: Rating }
  | { type: 'work-hard-deleted' }
  | { type: 'work-soft-deleted' };

const completionCaseArbitrary: fc.Arbitrary<CompletionCase> = fc.oneof(
  fc.integer({ min: 1, max: 5 }).map((rating) => ({
    type: 'work-added' as const,
    rating: rating as Rating,
  })),
  fc.constant({ type: 'work-hard-deleted' as const }),
  fc.constant({ type: 'work-soft-deleted' as const }),
);

const positionArbitrary = fc.record({
  x: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
  y: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
  z: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
});

const propertyInputArbitrary = fc.record({
  completion: completionCaseArbitrary,
  position: positionArbitrary,
  seed: fc.integer({ min: 0, max: 0xffff_ffff }),
  sharedReferenceCount: fc.integer({ min: 1, max: 8 }),
});

function completionEvent(
  completion: CompletionCase,
  position: Vec3,
  seed: number,
): RuntimeEvent {
  return {
    id: `completion:${completion.type}:${seed}`,
    type: completion.type,
    occurredAt: '2025-01-01T00:00:00.000Z',
    payload: completion.type === 'work-added'
      ? { position, rating: completion.rating }
      : { position },
  };
}

function expectEffectSpecification(
  completion: CompletionCase,
  effects: readonly ParticleEffectDescriptor[],
  position: Vec3,
): void {
  for (const effect of effects) {
    expect(effect.origin).toEqual(position);
    expect(effect.seed).toBeGreaterThanOrEqual(0);
    expect(effect.seed).toBeLessThanOrEqual(0xffff_ffff);
  }

  if (completion.type === 'work-added') {
    expect(effects.map(({ kind }) => kind)).toEqual(
      completion.rating === 5
        ? ['fireworks', 'meteor-shower']
        : ['fireworks'],
    );
    const fireworks = effects[0]!;
    expect(fireworks.particleCount).toBeGreaterThanOrEqual(FIREWORK_PARTICLE_RANGE[0]);
    expect(fireworks.particleCount).toBeLessThanOrEqual(FIREWORK_PARTICLE_RANGE[1]);
    expect(fireworks.trailCount).toBe(0);
    expect(fireworks.durationSeconds).toBe(FIREWORK_DURATION_SECONDS);

    if (completion.rating === 5) {
      const meteorShower = effects[1]!;
      expect(meteorShower.particleCount).toBe(0);
      expect(meteorShower.trailCount).toBeGreaterThanOrEqual(METEOR_SHOWER_TRAIL_RANGE[0]);
      expect(meteorShower.trailCount).toBeLessThanOrEqual(METEOR_SHOWER_TRAIL_RANGE[1]);
      expect(meteorShower.durationSeconds).toBe(METEOR_SHOWER_DURATION_SECONDS);
    }
    return;
  }

  expect(effects).toHaveLength(1);
  const effect = effects[0]!;
  if (completion.type === 'work-hard-deleted') {
    expect(effect.kind).toBe('asteroid-impact');
    expect(effect.particleCount).toBeGreaterThanOrEqual(ASTEROID_DEBRIS_RANGE[0]);
    expect(effect.particleCount).toBeLessThanOrEqual(ASTEROID_DEBRIS_RANGE[1]);
    expect(effect.durationSeconds).toBe(ASTEROID_IMPACT_DURATION_SECONDS);
    expect(effect.scaleFrom).toBe(1);
    expect(effect.scaleTo).toBe(0);
    return;
  }

  expect(effect.kind).toBe('blackhole-spiral');
  expect(effect.durationSeconds).toBe(BLACKHOLE_SPIRAL_DURATION_SECONDS);
  expect(effect.rotations).toBeGreaterThanOrEqual(BLACKHOLE_SPIRAL_ROTATIONS);
  expect(effect.scaleFrom).toBe(1);
  expect(effect.scaleTo).toBe(0);
}

function expectEffectExpiresAndReleasesReferences(effect: ParticleEffectDescriptor): void {
  const clock = new FakeClock();
  const registry = new EffectLifecycleRegistry(clock);
  const controller = new ParticleEffectController(clock, registry, () => 0);
  const resourceKinds: readonly EffectResourceKind[] = ['geometry', 'material', 'texture'];
  const resources = resourceKinds.map((kind) => ({ kind, disposeCount: 0 }));
  let animationCancellationCount = 0;

  expect(controller.start(effect)).toBe(true);
  resources.forEach((resource) => {
    controller.addResource(effect.id, resource.kind, {
      dispose: () => {
        resource.disposeCount += 1;
      },
    });
  });
  controller.addAnimation(effect.id, () => {
    animationCancellationCount += 1;
  });

  expect(registry.snapshot()).toEqual({
    effectCount: 1,
    resourceCount: 3,
    timerCount: 1,
    animationCount: 1,
    quarantineCount: 0,
  });

  const halfDurationMs = effect.durationSeconds * 500;
  clock.advanceBy(halfDurationMs);
  expect(controller.getActiveEffects()).toEqual([effect]);
  expect(resources.map(({ disposeCount }) => disposeCount)).toEqual([0, 0, 0]);
  expect(animationCancellationCount).toBe(0);

  clock.advanceBy(halfDurationMs);
  expect(controller.getActiveEffects()).toEqual([]);
  expect(registry.snapshot()).toEqual({
    effectCount: 0,
    resourceCount: 0,
    timerCount: 0,
    animationCount: 0,
    quarantineCount: 0,
  });
  expect(clock.pendingTimerCount()).toBe(0);
  expect(resources.map(({ disposeCount }) => disposeCount)).toEqual([1, 1, 1]);
  expect(animationCancellationCount).toBe(1);
}

function expectReferenceCountedDisposal(referenceCount: number): void {
  const registry = new ThreeResourceRegistry();
  const geometry = new BufferGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  let geometryDisposals = 0;
  let materialDisposals = 0;
  let textureDisposals = 0;
  geometry.dispose = () => { geometryDisposals += 1; };
  material.dispose = () => { materialDisposals += 1; };
  texture.dispose = () => { textureDisposals += 1; };

  const releases = Array.from(
    { length: referenceCount },
    () => registry.trackObject(new Mesh(geometry, material)),
  );
  expect(registry.getReferenceCount(geometry)).toBe(referenceCount);
  expect(registry.getReferenceCount(material)).toBe(referenceCount);
  expect(registry.getReferenceCount(texture)).toBe(referenceCount);

  releases.forEach((release, index) => {
    release();
    const remaining = referenceCount - index - 1;
    expect(registry.getReferenceCount(geometry)).toBe(remaining);
    expect(registry.getReferenceCount(material)).toBe(remaining);
    expect(registry.getReferenceCount(texture)).toBe(remaining);
    const expectedDisposals = remaining === 0 ? 1 : 0;
    expect(geometryDisposals).toBe(expectedDisposals);
    expect(materialDisposals).toBe(expectedDisposals);
    expect(textureDisposals).toBe(expectedDisposals);
  });
}

describe('Property 17: particle specification and lifecycle', () => {
  it('R2.17 R2.18 R11.1-R11.5 R13.7-R13.8 keeps completion effects bounded and releases only expired or unreferenced resources', () => {
    fc.assert(
      fc.property(
        propertyInputArbitrary,
        ({ completion, position, seed, sharedReferenceCount }) => {
          const event = completionEvent(completion, position, seed);
          const random = new SeededPrng(seed);
          const effects = createParticleEffectsForEvent(event, () => random.next());

          expectEffectSpecification(completion, effects, position);
          effects.forEach(expectEffectExpiresAndReleasesReferences);
          expectReferenceCountedDisposal(sharedReferenceCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
