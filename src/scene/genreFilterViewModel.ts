import type { Galaxy, Genre, Star } from '../domain/models';

export const GENRE_FILTER_TWEEN_DURATION_SECONDS = 0.4;
export const SELECTED_STAR_OPACITY = 1;
export const UNSELECTED_STAR_OPACITY = 0.15;
export const DEFAULT_GALAXY_INTENSITY = 1;
export const SELECTED_GALAXY_INTENSITY = 1.5;
export const UNSELECTED_GALAXY_INTENSITY = 0.25;

export interface NumericTween {
  from: number;
  to: number;
  durationSeconds: number;
}

export interface FilterVisualTarget {
  target: number;
  tween: NumericTween | null;
}

export interface StarFilterViewModel extends FilterVisualTarget {
  id: string;
  genre: Genre;
}

export interface GalaxyFilterViewModel extends FilterVisualTarget {
  id: string;
  genre: Genre;
}

export interface GenreFilterSceneViewModel {
  stars: StarFilterViewModel[];
  galaxies: GalaxyFilterViewModel[];
}

export interface CurrentGenreFilterVisuals {
  starOpacityById?: ReadonlyMap<string, number>;
  galaxyIntensityById?: ReadonlyMap<string, number>;
}

export function toggleGenreSelection(
  selectedGenres: ReadonlySet<Genre>,
  genre: Genre,
): Set<Genre> {
  const next = new Set(selectedGenres);
  if (next.has(genre)) next.delete(genre);
  else next.add(genre);
  return next;
}

function createVisualTarget(current: number, target: number): FilterVisualTarget {
  return {
    target,
    tween: Object.is(current, target)
      ? null
      : {
          from: current,
          to: target,
          durationSeconds: GENRE_FILTER_TWEEN_DURATION_SECONDS,
        },
  };
}

function targetStarOpacity(genre: Genre, selectedGenres: ReadonlySet<Genre>): number {
  if (selectedGenres.size === 0 || selectedGenres.has(genre)) {
    return SELECTED_STAR_OPACITY;
  }
  return UNSELECTED_STAR_OPACITY;
}

function targetGalaxyIntensity(
  genre: Genre,
  selectedGenres: ReadonlySet<Genre>,
): number {
  if (selectedGenres.size === 0) return DEFAULT_GALAXY_INTENSITY;
  return selectedGenres.has(genre)
    ? SELECTED_GALAXY_INTENSITY
    : UNSELECTED_GALAXY_INTENSITY;
}

/**
 * Builds target-aware visual transitions for Genre filtering. Current values that
 * already equal their target deliberately produce no tween.
 */
export function createGenreFilterSceneViewModel(
  stars: readonly Star[],
  galaxies: readonly Galaxy[],
  selectedGenres: ReadonlySet<Genre>,
  current: CurrentGenreFilterVisuals = {},
): GenreFilterSceneViewModel {
  return {
    stars: stars.map((star) => {
      const target = targetStarOpacity(star.genre, selectedGenres);
      const currentOpacity = current.starOpacityById?.get(star.id)
        ?? DEFAULT_GALAXY_INTENSITY;
      return {
        id: star.id,
        genre: star.genre,
        ...createVisualTarget(currentOpacity, target),
      };
    }),
    galaxies: galaxies.flatMap((galaxy) => {
      if (galaxy.kind.type !== 'genre') return [];
      const target = targetGalaxyIntensity(galaxy.kind.genre, selectedGenres);
      const currentIntensity = current.galaxyIntensityById?.get(galaxy.id)
        ?? DEFAULT_GALAXY_INTENSITY;
      return [{
        id: galaxy.id,
        genre: galaxy.kind.genre,
        ...createVisualTarget(currentIntensity, target),
      }];
    }),
  };
}
