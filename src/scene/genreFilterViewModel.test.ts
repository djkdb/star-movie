import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { Star } from '../domain/models';
import {
  createGenreFilterSceneViewModel,
  GENRE_FILTER_TWEEN_DURATION_SECONDS,
  toggleGenreSelection,
} from './genreFilterViewModel';

function createStar(id: string, genre: Star['genre']): Star {
  return {
    id,
    title: id,
    normalizedTitle: id,
    genre,
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('Genre Filter scene view model', () => {
  it('R6.1 R6.8 R6.10 toggles one Genre without changing other selections', () => {
    const first = toggleGenreSelection(new Set(['SF']), '드라마');
    expect(first).toEqual(new Set(['SF', '드라마']));

    const second = toggleGenreSelection(first, 'SF');
    expect(second).toEqual(new Set(['드라마']));

    expect(toggleGenreSelection(second, '드라마')).toEqual(new Set());
  });

  it('R6.2-R6.7 creates 0.4 second transitions to selected and unselected targets', () => {
    const state = createDefaultStore();
    const stars = [createStar('sf', 'SF'), createStar('drama', '드라마')];
    const viewModel = createGenreFilterSceneViewModel(
      stars,
      state.persisted.galaxies,
      new Set(['SF']),
    );

    expect(viewModel.stars).toEqual([
      { id: 'sf', genre: 'SF', target: 1, tween: null },
      {
        id: 'drama',
        genre: '드라마',
        target: 0.15,
        tween: { from: 1, to: 0.15, durationSeconds: GENRE_FILTER_TWEEN_DURATION_SECONDS },
      },
    ]);
    expect(viewModel.galaxies.find(({ genre }) => genre === 'SF')).toMatchObject({
      target: 1.5,
      tween: { from: 1, to: 1.5, durationSeconds: 0.4 },
    });
    expect(viewModel.galaxies.find(({ genre }) => genre === '드라마')).toMatchObject({
      target: 0.25,
      tween: { from: 1, to: 0.25, durationSeconds: 0.4 },
    });
  });

  it('R6.11-R6.16 creates no tween whenever every current value already equals its target', () => {
    const state = createDefaultStore();
    const stars = [createStar('sf', 'SF'), createStar('drama', '드라마')];
    const galaxyValues = new Map(
      state.persisted.galaxies
        .filter(({ kind }) => kind.type === 'genre')
        .map((galaxy) => [
          galaxy.id,
          galaxy.kind.type === 'genre' && galaxy.kind.genre === 'SF' ? 1.5 : 0.25,
        ]),
    );
    const viewModel = createGenreFilterSceneViewModel(
      stars,
      state.persisted.galaxies,
      new Set(['SF']),
      {
        starOpacityById: new Map([['sf', 1], ['drama', 0.15]]),
        galaxyIntensityById: galaxyValues,
      },
    );

    expect(viewModel.stars.every(({ tween }) => tween === null)).toBe(true);
    expect(viewModel.galaxies.every(({ tween }) => tween === null)).toBe(true);

    const reset = createGenreFilterSceneViewModel(
      stars,
      state.persisted.galaxies,
      new Set(),
      {
        starOpacityById: new Map([['sf', 1], ['drama', 1]]),
        galaxyIntensityById: new Map(
          state.persisted.galaxies.map(({ id }) => [id, 1]),
        ),
      },
    );
    expect(reset.stars.every(({ tween }) => tween === null)).toBe(true);
    expect(reset.galaxies.every(({ tween }) => tween === null)).toBe(true);
  });
});
