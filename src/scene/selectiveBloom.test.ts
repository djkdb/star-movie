import { describe, expect, it } from 'vitest';

import type { Constellation, Star } from '../domain/models';
import {
  createSelectiveBloomViewModel,
  SelectiveBloomPass,
} from './selectiveBloom';

function star(id: string): Star {
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
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function constellation(id: string, starIds: string[]): Constellation {
  return {
    id,
    name: id,
    starIds,
    color: '#ffffff',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('selective Bloom view model', () => {
  it('R13.6 selects every Star and only constellations with at least two active references', () => {
    const stars = [star('a'), star('b')];
    const model = createSelectiveBloomViewModel(stars, [
      constellation('active', ['a', 'missing', 'b']),
      constellation('inactive', ['missing', 'a']),
    ]);

    expect(model).toEqual({
      enabled: true,
      targetKeys: ['star:a', 'star:b', 'constellation:active'],
    });
  });

  it('R13.9 disables Bloom when neither Stars nor active constellation lines exist', () => {
    expect(createSelectiveBloomViewModel([], [
      constellation('empty', ['missing-a', 'missing-b']),
    ])).toEqual({ enabled: false, targetKeys: [] });
    expect(SelectiveBloomPass({ enabled: false })).toBeNull();
  });
});
