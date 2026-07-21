import type { Genre } from '../domain/models';

/** A spotlit (selected, or no filter) star keeps its full brightness. */
export const SPOTLIT_STAR_OPACITY = 1;

/**
 * A filtered-out star nearly vanishes so the chosen genre is essentially the
 * only one that exists in the sky — a strong spotlight, not a gentle dim.
 */
export const DIMMED_STAR_OPACITY = 0.05;

/**
 * Resolves a star's opacity under the current genre filter. With no genres
 * selected every star is fully lit; otherwise only stars whose genre is
 * selected stay lit and the rest fade almost to nothing.
 */
export function resolveGenreOpacity(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): number {
  if (selectedGenres.size === 0 || selectedGenres.has(genre)) {
    return SPOTLIT_STAR_OPACITY;
  }
  return DIMMED_STAR_OPACITY;
}

/** Whether the genre filter currently dims this star (used to scale color). */
export function isGenreDimmed(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): boolean {
  return selectedGenres.size > 0 && !selectedGenres.has(genre);
}
