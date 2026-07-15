import { describe, expect, it } from 'vitest';

import {
  FakeClock,
  FakeLocalStorageAdapter,
  FixedCurrentTimeProvider,
  IncrementingUuidProvider,
  SeededPrng,
  SequenceUuidProvider,
} from './providers';
import {
  assertWebGlLifecycleReturnedToBaseline,
  createEmptyWebGlLifecycleSnapshot,
  createTestProviders,
} from './fixtures';

describe('deterministic test providers', () => {
  it('R2.9 executes equal-deadline timers deterministically and supports cancellation', () => {
    const clock = new FakeClock(100);
    const calls: string[] = [];
    clock.setTimeout(() => calls.push('first'), 10);
    const cancelled = clock.setTimeout(() => calls.push('cancelled'), 5);
    clock.setTimeout(() => calls.push('second'), 10);
    clock.clearTimeout(cancelled);

    clock.advanceBy(10);

    expect(calls).toEqual(['first', 'second']);
    expect(clock.now()).toBe(110);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it('R2.9 provides deterministic UUID and current-time sequences', () => {
    const ids = new IncrementingUuidProvider(10n);
    const time = new FixedCurrentTimeProvider('2025-02-03T04:05:06.000Z');

    expect(ids.next()).toBe('00000000-0000-4000-8000-00000000000a');
    expect(ids.next()).toBe('00000000-0000-4000-8000-00000000000b');
    expect(time.nowIso()).toBe('2025-02-03T04:05:06.000Z');
    expect(time.now()).not.toBe(time.now());
  });

  it('R8.13 injects storage failures without mutating existing data', () => {
    const storage = new FakeLocalStorageAdapter({ initial: { archive: 'before' } });
    storage.failWrites = true;

    expect(() => storage.setItem('archive', 'after')).toThrow('Injected localStorage write failure');
    storage.failWrites = false;
    expect(storage.snapshot()).toEqual({ archive: 'before' });
  });

  it('R11.5 reports leaked WebGL resources, RAFs, and timers', () => {
    const baseline = createEmptyWebGlLifecycleSnapshot();
    expect(() => assertWebGlLifecycleReturnedToBaseline(baseline, baseline)).not.toThrow();
    expect(() =>
      assertWebGlLifecycleReturnedToBaseline(baseline, { ...baseline, textures: 1 }),
    ).toThrow('textures');
  });

  it('R13.2 builds isolated provider fixtures and accepts overrides', () => {
    const uuid = new SequenceUuidProvider(['custom-id']);
    const first = createTestProviders({ uuid });
    const second = createTestProviders();

    expect(first.uuid.next()).toBe('custom-id');
    first.storage.setItem('key', 'value');
    expect(second.storage.getItem('key')).toBeNull();
  });
});

describe('seeded PRNG', () => {
  it('R2.9 emits a stable sequence in the half-open unit interval', () => {
    const first = new SeededPrng(1234);
    const second = new SeededPrng(1234);
    const sequence = Array.from({ length: 20 }, () => first.next());

    expect(sequence).toEqual(Array.from({ length: 20 }, () => second.next()));
    expect(sequence.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
