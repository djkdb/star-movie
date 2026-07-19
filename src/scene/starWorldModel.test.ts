import { describe, expect, it } from 'vitest';

import type { Star } from '../domain/models';
import { getStarWorldVisual } from './starWorldModel';

function star(overrides: Partial<Star> = {}): Star {
  return {
    id: overrides.id ?? '10000000-0000-4000-8000-000000000001',
    title: 'Work',
    normalizedTitle: 'work',
    genre: overrides.genre ?? 'SF',
    rating: overrides.rating ?? 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('getStarWorldVisual', () => {
  it('is deterministic for the same work', () => {
    expect(getStarWorldVisual(star())).toEqual(getStarWorldVisual(star()));
  });

  it('namespaces the surface id so it cannot collide with planet species', () => {
    expect(getStarWorldVisual(star()).spec.id.startsWith('starworld:')).toBe(true);
  });

  it('derives the palette from the genre', () => {
    const sf = getStarWorldVisual(star({ genre: 'SF' }));
    const romance = getStarWorldVisual(star({ genre: '로맨스' }));
    expect(sf.spec.baseColor).not.toBe(romance.spec.baseColor);
    expect(sf.spec.baseColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(sf.spec.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(sf.spec.emissiveColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('grows and gains a ring with rating', () => {
    const low = getStarWorldVisual(star({ rating: 2 }));
    const high = getStarWorldVisual(star({ rating: 5 }));
    expect(high.size).toBeGreaterThan(low.size);
    expect(low.ring).toBeUndefined();
    expect(high.ring).toBeDefined();
  });

  it('rejects an empty id', () => {
    expect(() => getStarWorldVisual(star({ id: '' }))).toThrow(RangeError);
  });
});
