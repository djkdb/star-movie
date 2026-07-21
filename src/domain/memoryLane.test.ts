import { describe, expect, it } from 'vitest';

import { monthAgoLocalDate, selectMonthAgoMemories } from './memoryLane';
import type { Star } from './models';

function star(watchedDate: string): Star {
  return {
    id: `star-${watchedDate}`,
    title: 'T',
    normalizedTitle: 't',
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate,
    director: 'D',
    normalizedDirector: 'd',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('memory lane', () => {
  it('finds the local date one month back, clamping to shorter months', () => {
    expect(monthAgoLocalDate(new Date(2026, 6, 21))).toBe('2026-06-21');
    expect(monthAgoLocalDate(new Date(2026, 2, 31))).toBe('2026-02-28');
    expect(monthAgoLocalDate(new Date(2026, 0, 15))).toBe('2025-12-15');
  });

  it('selects only works watched exactly one month ago', () => {
    const matches = selectMonthAgoMemories(
      [star('2026-06-21'), star('2026-06-20'), star('2025-06-21')],
      new Date(2026, 6, 21),
    );
    expect(matches.map(({ watchedDate }) => watchedDate)).toEqual(['2026-06-21']);
  });
});
