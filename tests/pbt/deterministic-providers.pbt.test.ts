import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FakeClock, SeededPrng } from '../../src/test/providers';

// Feature: space-movie-archive, deterministic provider infrastructure
// **Validates: Requirements 2.9, 13.2**
describe('deterministic provider properties', () => {
  it('R2.9 identical seeds always produce identical bounded PRNG sequences', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 200 }), (seed, length) => {
        const first = new SeededPrng(seed);
        const second = new SeededPrng(seed);
        const left = Array.from({ length }, () => first.next());
        const right = Array.from({ length }, () => second.next());
        expect(left).toEqual(right);
        expect(left.every((value) => value >= 0 && value < 1)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('R13.2 advancing a fake clock executes every due timer exactly once', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 10_000 }), { maxLength: 100 }),
        fc.integer({ min: 0, max: 10_000 }),
        (deadlines, advance) => {
          const clock = new FakeClock();
          const observed: number[] = [];
          deadlines.forEach((deadline) => clock.setTimeout(() => observed.push(deadline), deadline));
          clock.advanceBy(advance);
          expect(observed).toEqual(deadlines.filter((value) => value <= advance).sort((a, b) => a - b));
          expect(clock.pendingTimerCount()).toBe(deadlines.filter((value) => value > advance).length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
