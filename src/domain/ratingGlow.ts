import type { Rating } from './models';

/**
 * The colour a star glows at each rating — dim slate at 1, warm gold at 5.
 * Shared so the WorkCard's glow and the rating picker preview the exact same
 * hue: the picker becomes a promise of the star you are about to place.
 */
export const RATING_GLOW_COLORS: Readonly<Record<Rating, string>> = {
  1: '#6a7290',
  2: '#9aa8d0',
  3: '#cfe0ff',
  4: '#ffe9b8',
  5: '#fff8e0',
};
