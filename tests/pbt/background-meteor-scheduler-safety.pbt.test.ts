// Feature: space-movie-archive, Property 18: 배경 유성 scheduler 안전성
// **Validates: Requirements 11.6, 11.7, 11.8, 11.9**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_METEOR_DURATION_SECONDS,
  BACKGROUND_METEOR_INTERVAL_SECONDS,
  BackgroundMeteorScheduler,
  EffectLifecycleRegistry,
  ParticleEffectController,
  type ParticleEffectDescriptor,
} from '../../src/scene/particleManagerModel';
import { FakeClock, SeededPrng } from '../../src/test/providers';

interface VisibilityStep {
  visible: boolean;
  advanceMs: number;
}

const visibilityStepArbitrary: fc.Arbitrary<VisibilityStep> = fc.record({
  visible: fc.boolean(),
  advanceMs: fc.integer({ min: 0, max: 50_000 }),
});

const scenarioArbitrary = fc
  .tuple(
    fc.integer({ min: 0, max: 0xffff_ffff }),
    fc.array(visibilityStepArbitrary, { maxLength: 12 }),
    fc.integer({ min: 40_000, max: 80_000 }),
  )
  .map(([seed, transitions, hiddenDurationMs]) => ({
    seed,
    steps: [
      ...transitions,
      { visible: false, advanceMs: hiddenDurationMs },
      { visible: true, advanceMs: 41_000 },
    ] satisfies VisibilityStep[],
  }));

function expectBoundedEffect(effect: ParticleEffectDescriptor): void {
  expect(effect.kind).toBe('background-meteor');
  expect(effect.durationSeconds).toBeGreaterThanOrEqual(
    BACKGROUND_METEOR_DURATION_SECONDS[0],
  );
  expect(effect.durationSeconds).toBeLessThanOrEqual(
    BACKGROUND_METEOR_DURATION_SECONDS[1],
  );
}

describe('Property 18: background meteor scheduler safety', () => {
  it('R11.6 R11.7 R11.8 R11.9 keeps intervals, lifetimes, concurrency, hidden suppression, and resume delays safe across visibility transitions', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ seed, steps }) => {
        const clock = new FakeClock();
        const registry = new EffectLifecycleRegistry(clock);
        const controller = new ParticleEffectController(clock, registry, () => 0);
        const prng = new SeededPrng(seed);
        let randomCallCount = 0;
        const random = (): number => {
          randomCallCount += 1;
          return prng.next();
        };

        let modelVisible = false;
        let expectedFirstSpawnAt: number | null = null;
        let previousSpawnAt: number | null = null;
        let maximumConcurrentMeteors = 0;
        const spawnTimes: number[] = [];

        controller.subscribe((effects) => {
          maximumConcurrentMeteors = Math.max(
            maximumConcurrentMeteors,
            effects.filter(({ kind }) => kind === 'background-meteor').length,
          );
        });

        const scheduler = new BackgroundMeteorScheduler({
          timer: clock,
          random,
          spawn: (effect, onExpired) => {
            expect(modelVisible).toBe(true);
            expectBoundedEffect(effect);

            const spawnedAt = clock.now();
            spawnTimes.push(spawnedAt);
            if (expectedFirstSpawnAt !== null) {
              expect(spawnedAt).toBeCloseTo(expectedFirstSpawnAt, 8);
              expectedFirstSpawnAt = null;
            } else if (previousSpawnAt !== null) {
              const intervalSeconds = (spawnedAt - previousSpawnAt) / 1_000;
              expect(intervalSeconds).toBeGreaterThanOrEqual(
                BACKGROUND_METEOR_INTERVAL_SECONDS[0],
              );
              expect(intervalSeconds).toBeLessThanOrEqual(
                BACKGROUND_METEOR_INTERVAL_SECONDS[1],
              );
            }
            previousSpawnAt = spawnedAt;

            return controller.start(effect, () => {
              expect(clock.now() - spawnedAt).toBeCloseTo(
                effect.durationSeconds * 1_000,
                8,
              );
              onExpired();
            });
          },
          cancel: (effectId) => controller.cancel(effectId),
        });

        for (const step of steps) {
          const visibilityChanged = modelVisible !== step.visible;
          const randomCallsBeforeTransition = randomCallCount;
          scheduler.setVisible(step.visible);

          if (visibilityChanged) {
            modelVisible = step.visible;
            if (modelVisible) {
              const snapshot = scheduler.snapshot();
              const delaySeconds = snapshot.lastScheduledDelaySeconds;
              expect(snapshot.pending).toBe(true);
              expect(snapshot.activeMeteorId).toBeNull();
              expect(delaySeconds).not.toBeNull();
              expect(delaySeconds!).toBeGreaterThanOrEqual(
                BACKGROUND_METEOR_INTERVAL_SECONDS[0],
              );
              expect(delaySeconds!).toBeLessThanOrEqual(
                BACKGROUND_METEOR_INTERVAL_SECONDS[1],
              );
              expect(randomCallCount).toBe(randomCallsBeforeTransition + 1);
              expectedFirstSpawnAt = clock.now() + delaySeconds! * 1_000;
              previousSpawnAt = null;
            } else {
              expect(scheduler.snapshot()).toMatchObject({
                visible: false,
                pending: false,
                activeMeteorId: null,
              });
              expect(controller.getActiveEffects()).toEqual([]);
              expectedFirstSpawnAt = null;
              previousSpawnAt = null;
            }
          } else {
            expect(randomCallCount).toBe(randomCallsBeforeTransition);
          }

          const spawnCountBeforeAdvance = spawnTimes.length;
          clock.advanceBy(step.advanceMs);
          if (!modelVisible) {
            expect(spawnTimes).toHaveLength(spawnCountBeforeAdvance);
            expect(controller.getActiveEffects()).toEqual([]);
          }
        }

        expect(spawnTimes.length).toBeGreaterThan(0);
        expect(maximumConcurrentMeteors).toBeLessThanOrEqual(1);

        scheduler.setVisible(false);
        modelVisible = false;
        const spawnCountBeforeFinalHiddenWait = spawnTimes.length;
        clock.advanceBy(BACKGROUND_METEOR_INTERVAL_SECONDS[1] * 1_000);
        expect(spawnTimes).toHaveLength(spawnCountBeforeFinalHiddenWait);
        expect(controller.getActiveEffects()).toEqual([]);

        scheduler.dispose();
        controller.dispose();
      }),
      { numRuns: 100 },
    );
  });
});
