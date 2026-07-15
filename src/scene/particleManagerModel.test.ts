import { describe, expect, it, vi } from 'vitest';

import type { RuntimeEvent } from '../domain/models';
import { FakeClock } from '../test/providers';
import {
  ASTEROID_DEBRIS_RANGE,
  ASTEROID_IMPACT_DURATION_SECONDS,
  BACKGROUND_METEOR_DURATION_SECONDS,
  BACKGROUND_METEOR_INTERVAL_SECONDS,
  BackgroundMeteorScheduler,
  BLACKHOLE_SPIRAL_DURATION_SECONDS,
  BLACKHOLE_SPIRAL_ROTATIONS,
  EffectLifecycleRegistry,
  FIREWORK_DURATION_SECONDS,
  FIREWORK_PARTICLE_RANGE,
  METEOR_SHOWER_DURATION_SECONDS,
  METEOR_SHOWER_TRAIL_RANGE,
  ParticleEffectController,
  createParticleEffectsForEvent,
  type ParticleEffectDescriptor,
} from './particleManagerModel';

function event(
  type: string,
  payload: Readonly<Record<string, unknown>>,
): RuntimeEvent {
  return {
    id: `${type}:event`,
    type,
    occurredAt: '2025-01-01T00:00:00.000Z',
    payload,
  };
}

function constantRandom(value: number): () => number {
  return () => value;
}

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

function backgroundEffect(id = 'manual-background'): ParticleEffectDescriptor {
  return {
    id,
    sourceEventId: id,
    kind: 'background-meteor',
    origin: { x: -20, y: 20, z: 0 },
    particleCount: 0,
    trailCount: 1,
    durationSeconds: 0.5,
    rotations: 0,
    seed: 1,
    scaleFrom: 1,
    scaleTo: 1,
  };
}

describe('ParticleManager effect model', () => {
  it('R2.17-R2.18 and R11.1-R11.2 maps committed registrations to bounded fireworks and optional Rating-5 meteor trails', () => {
    const position = { x: 1, y: 2, z: 3 };
    const low = createParticleEffectsForEvent(
      event('work-added', { rating: 1, position }),
      constantRandom(0),
    );
    const high = createParticleEffectsForEvent(
      event('work-added', { rating: 5, position }),
      constantRandom(0.999999),
    );

    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({
      kind: 'fireworks',
      origin: position,
      particleCount: FIREWORK_PARTICLE_RANGE[0],
      durationSeconds: FIREWORK_DURATION_SECONDS,
    });
    expect(high.map(({ kind }) => kind)).toEqual(['fireworks', 'meteor-shower']);
    expect(high[0]!.particleCount).toBe(FIREWORK_PARTICLE_RANGE[1]);
    expect(high[1]).toMatchObject({
      trailCount: METEOR_SHOWER_TRAIL_RANGE[1],
      durationSeconds: METEOR_SHOWER_DURATION_SECONDS,
    });
  });

  it('R4.10, R11.3-R11.4, and R12.5 defines bounded impact and two-turn shrinking spiral effects', () => {
    const position = { x: -2, y: 4, z: 8 };
    const impact = createParticleEffectsForEvent(
      event('work-hard-deleted', { position }),
      constantRandom(0.5),
    )[0]!;
    const spiral = createParticleEffectsForEvent(
      event('work-soft-deleted', { position }),
      constantRandom(0.5),
    )[0]!;

    expect(impact.kind).toBe('asteroid-impact');
    expect(impact.particleCount).toBeGreaterThanOrEqual(ASTEROID_DEBRIS_RANGE[0]);
    expect(impact.particleCount).toBeLessThanOrEqual(ASTEROID_DEBRIS_RANGE[1]);
    expect(impact.durationSeconds).toBe(ASTEROID_IMPACT_DURATION_SECONDS);
    expect(impact).toMatchObject({ scaleFrom: 1, scaleTo: 0 });
    expect(spiral).toMatchObject({
      kind: 'blackhole-spiral',
      durationSeconds: BLACKHOLE_SPIRAL_DURATION_SECONDS,
      rotations: BLACKHOLE_SPIRAL_ROTATIONS,
      scaleFrom: 1,
      scaleTo: 0,
    });
  });

  it('creates completion celebrations for milestone and achievement unlock events', () => {
    expect(
      createParticleEffectsForEvent(event('milestone-unlocked', {}), constantRandom(0))[0],
    ).toMatchObject({ kind: 'milestone-celebration' });
    expect(
      createParticleEffectsForEvent(event('achievement-unlocked', {}), constantRandom(0))[0],
    ).toMatchObject({ kind: 'achievement-celebration' });
  });

  it('R13.4 uses every bounded particle and trail range minimum after degradation', () => {
    const position = { x: 1, y: 2, z: 3 };
    const registration = createParticleEffectsForEvent(
      event('work-added', { rating: 5, position }),
      constantRandom(0.999999),
      { minimumCounts: true },
    );
    const impact = createParticleEffectsForEvent(
      event('work-hard-deleted', { position }),
      constantRandom(0.999999),
      { minimumCounts: true },
    )[0]!;

    expect(registration[0]!.particleCount).toBe(FIREWORK_PARTICLE_RANGE[0]);
    expect(registration[1]!.trailCount).toBe(METEOR_SHOWER_TRAIL_RANGE[0]);
    expect(impact.particleCount).toBe(ASTEROID_DEBRIS_RANGE[0]);
  });

  it('R11.5 expires effects and removes timer, animation, and resource references', () => {
    const clock = new FakeClock();
    const registry = new EffectLifecycleRegistry(clock);
    const controller = new ParticleEffectController(clock, registry, constantRandom(0));
    const resource = { dispose: vi.fn() };
    const cancelAnimation = vi.fn();
    const effect = backgroundEffect();

    controller.start(effect);
    controller.addResource(effect.id, 'geometry', resource);
    registry.addAnimation(effect.id, cancelAnimation);
    expect(registry.snapshot()).toMatchObject({
      effectCount: 1,
      resourceCount: 1,
      timerCount: 1,
      animationCount: 1,
    });

    clock.advanceBy(500);

    expect(controller.getActiveEffects()).toEqual([]);
    expect(registry.snapshot()).toEqual({
      effectCount: 0,
      resourceCount: 0,
      timerCount: 0,
      animationCount: 0,
      quarantineCount: 0,
    });
    expect(resource.dispose).toHaveBeenCalledOnce();
    expect(cancelAnimation).toHaveBeenCalledOnce();
  });

  it('R11.10 retries disposal immediately and quarantines a resource with diagnostics after a repeated failure', () => {
    const clock = new FakeClock();
    const diagnostics = vi.fn();
    const registry = new EffectLifecycleRegistry(clock, diagnostics);
    const eventuallyDisposed = {
      dispose: vi.fn()
        .mockImplementationOnce(() => { throw new Error('first failure'); })
        .mockImplementationOnce(() => undefined),
    };
    const quarantined = {
      dispose: vi.fn(() => { throw new Error('persistent failure'); }),
    };

    registry.open('effect');
    registry.addResource('effect', 'geometry', eventuallyDisposed);
    registry.addResource('effect', 'material', quarantined);
    registry.cleanup('effect');

    expect(eventuallyDisposed.dispose).toHaveBeenCalledTimes(2);
    expect(quarantined.dispose).toHaveBeenCalledTimes(2);
    expect(registry.isQuarantined(eventuallyDisposed)).toBe(false);
    expect(registry.isQuarantined(quarantined)).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      effectId: 'effect',
      resourceKind: 'material',
      attempts: 2,
      message: 'persistent failure',
    }));
    expect(registry.snapshot().quarantineCount).toBe(1);
  });
});

describe('background meteor scheduler', () => {
  it('R11.6-R11.9 uses bounded fresh intervals and durations with at most one active meteor', () => {
    const clock = new FakeClock();
    const registry = new EffectLifecycleRegistry(clock);
    const controller = new ParticleEffectController(clock, registry, constantRandom(0));
    const random = sequenceRandom([0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1]);
    let maximumConcurrentMeteors = 0;
    controller.subscribe((effects) => {
      maximumConcurrentMeteors = Math.max(
        maximumConcurrentMeteors,
        effects.filter(({ kind }) => kind === 'background-meteor').length,
      );
    });
    const scheduler = new BackgroundMeteorScheduler({
      timer: clock,
      random,
      spawn: (effect, onExpired) => controller.start(effect, onExpired),
      cancel: (effectId) => controller.cancel(effectId),
    });

    scheduler.setVisible(true);
    expect(scheduler.snapshot().lastScheduledDelaySeconds).toBe(
      BACKGROUND_METEOR_INTERVAL_SECONDS[0],
    );
    clock.advanceBy(BACKGROUND_METEOR_INTERVAL_SECONDS[0] * 1_000 - 1);
    expect(controller.getActiveEffects()).toHaveLength(0);
    clock.advanceBy(1);

    const active = controller.getActiveEffects();
    expect(active).toHaveLength(1);
    expect(active[0]!.durationSeconds).toBeGreaterThanOrEqual(
      BACKGROUND_METEOR_DURATION_SECONDS[0],
    );
    expect(active[0]!.durationSeconds).toBeLessThanOrEqual(
      BACKGROUND_METEOR_DURATION_SECONDS[1],
    );
    clock.advanceBy(active[0]!.durationSeconds * 1_000);
    expect(controller.getActiveEffects()).toHaveLength(0);
    expect(scheduler.snapshot().pending).toBe(true);
    expect(maximumConcurrentMeteors).toBe(1);

    scheduler.setVisible(false);
    expect(scheduler.snapshot()).toMatchObject({
      visible: false,
      pending: false,
      activeMeteorId: null,
    });
    clock.advanceBy(60_000);
    expect(controller.getActiveEffects()).toHaveLength(0);

    scheduler.setVisible(true);
    const resumedDelay = scheduler.snapshot().lastScheduledDelaySeconds!;
    expect(resumedDelay).toBeGreaterThanOrEqual(BACKGROUND_METEOR_INTERVAL_SECONDS[0]);
    expect(resumedDelay).toBeLessThanOrEqual(BACKGROUND_METEOR_INTERVAL_SECONDS[1]);
  });

  it('cancels an active background meteor immediately when the page becomes hidden', () => {
    const clock = new FakeClock();
    const registry = new EffectLifecycleRegistry(clock);
    const controller = new ParticleEffectController(clock, registry, constantRandom(0));
    const scheduler = new BackgroundMeteorScheduler({
      timer: clock,
      random: constantRandom(0),
      spawn: (effect, onExpired) => controller.start(effect, onExpired),
      cancel: (effectId) => controller.cancel(effectId),
    });

    scheduler.setVisible(true);
    clock.advanceBy(15_000);
    expect(controller.getActiveEffects()).toHaveLength(1);
    scheduler.setVisible(false);

    expect(controller.getActiveEffects()).toEqual([]);
    expect(clock.pendingTimerCount()).toBe(0);
  });
});
