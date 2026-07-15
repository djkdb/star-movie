import { describe, expect, it } from 'vitest';

import type { Constellation, Star } from '../domain/models';
import {
  CONSTELLATION_HOVER_OPACITY,
  CONSTELLATION_IDLE_OPACITY,
  CONSTELLATION_NAME_FADE_SECONDS,
  createConstellationDraftPreviewPoints,
  createConstellationLineViewModels,
} from './constellationRendererModel';

function star(id: string, x: number): Star {
  return {
    id,
    title: id,
    normalizedTitle: id,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x, y: x + 1, z: x + 2 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function constellation(id: string, starIds: string[]): Constellation {
  return {
    id,
    name: `Name ${id}`,
    starIds,
    color: '#60A5FA',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('constellation renderer model', () => {
  it('R10.1 R10.12 preserves active reference order and hides lines below two references', () => {
    const stars = [star('a', 1), star('b', 5), star('c', 9)];
    const lines = createConstellationLineViewModels([
      constellation('ordered', ['c', 'missing', 'a', 'b']),
      constellation('hidden', ['missing', 'a']),
    ], stars);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: 'ordered',
      activeStarIds: ['c', 'a', 'b'],
      points: [[9, 10, 11], [1, 2, 3], [5, 6, 7]],
    });
  });

  it('R9.2 renders draft points in click order only after two active selections', () => {
    const stars = [star('a', 1), star('b', 5), star('c', 9)];

    expect(createConstellationDraftPreviewPoints(['a'], stars)).toEqual([]);
    expect(createConstellationDraftPreviewPoints(
      ['c', 'missing', 'a', 'b'],
      stars,
    )).toEqual([[9, 10, 11], [1, 2, 3], [5, 6, 7]]);
  });

  it('R10.2-R10.5 exposes exact idle/hover opacity and name transition timing', () => {
    expect(CONSTELLATION_IDLE_OPACITY).toBe(0.5);
    expect(CONSTELLATION_HOVER_OPACITY).toBe(1);
    expect(CONSTELLATION_NAME_FADE_SECONDS).toBe(0.3);
  });
});
