import { describe, expect, it } from 'vitest';

import type { Genre } from '../domain/models';
import {
  DIMMED_STAR_OPACITY,
  SPOTLIT_STAR_OPACITY,
  isGenreDimmed,
  resolveGenreOpacity,
} from './genreSpotlight';

const set = (...genres: Genre[]): ReadonlySet<Genre> => new Set(genres);

describe('genre spotlight', () => {
  it('keeps every star lit when no genre is selected', () => {
    expect(resolveGenreOpacity('SF', set())).toBe(SPOTLIT_STAR_OPACITY);
    expect(isGenreDimmed('SF', set())).toBe(false);
  });

  it('lights selected genres and nearly hides the rest', () => {
    const selected = set('SF', '액션');
    expect(resolveGenreOpacity('SF', selected)).toBe(SPOTLIT_STAR_OPACITY);
    expect(resolveGenreOpacity('액션', selected)).toBe(SPOTLIT_STAR_OPACITY);
    expect(resolveGenreOpacity('로맨스', selected)).toBe(DIMMED_STAR_OPACITY);
    expect(isGenreDimmed('로맨스', selected)).toBe(true);
    expect(isGenreDimmed('SF', selected)).toBe(false);
  });
});
