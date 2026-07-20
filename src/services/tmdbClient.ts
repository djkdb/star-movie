import { GENRES, type Genre } from '../domain/models';

/**
 * Thin, dependency-free helpers for The Movie Database (TMDB) v3 REST API.
 *
 * Everything here is pure — URL construction, defensive response parsing, and
 * genre mapping — so it unit-tests without a network. The actual `fetch`
 * orchestration (debounce, abort) lives in the `useMovieSuggestions` hook.
 *
 * A free read-only API key is required at runtime, supplied via the
 * `VITE_TMDB_API_KEY` environment variable. Without it the autocomplete stays
 * silently disabled and manual entry is unaffected.
 */

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Poster render sizes offered by the TMDB image CDN, smallest first. */
export type PosterSize = 'w92' | 'w154' | 'w200' | 'w342';

/** A normalized, UI-ready movie suggestion distilled from a TMDB search hit. */
export interface MovieSuggestion {
  tmdbId: number;
  title: string;
  /** Four-digit release year, or null when TMDB has no release date. */
  year: number | null;
  /** TMDB poster path (e.g. "/abc.jpg"), or null when none exists. */
  posterPath: string | null;
  /** Best-effort mapping to one of the app's fixed genres, or null. */
  genre: Genre | null;
}

/**
 * TMDB genre id → the app's fixed Korean genre. TMDB's ids are stable, so a
 * new work's primary genre can be pre-filled from a picked suggestion.
 * @see https://developer.themoviedb.org/reference/genre-movie-list
 */
const TMDB_GENRE_TO_GENRE: Readonly<Record<number, Genre>> = {
  878: 'SF',
  10749: '로맨스',
  53: '스릴러',
  9648: '스릴러', // Mystery
  18: '드라마',
  16: '애니',
  35: '코미디',
  28: '액션',
  12: '액션', // Adventure
};

function readTmdbKey(): string | null {
  const key = import.meta.env.VITE_TMDB_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null;
}

/** Whether a runtime TMDB key is configured; drives the autocomplete on/off. */
export function isTmdbConfigured(): boolean {
  return readTmdbKey() !== null;
}

function apiUrl(path: string, params: Record<string, string>): string {
  const key = readTmdbKey();
  if (key === null) throw new Error('TMDB API key is not configured');
  const search = new URLSearchParams({
    api_key: key,
    language: 'ko-KR',
    ...params,
  });
  return `${TMDB_API_BASE}${path}?${search.toString()}`;
}

/** Search URL for as-you-type title matches (adult content excluded). */
export function buildMovieSearchUrl(query: string): string {
  return apiUrl('/search/movie', {
    query,
    include_adult: 'false',
    page: '1',
  });
}

/** Credits URL used to resolve a picked movie's director. */
export function buildMovieCreditsUrl(tmdbId: number): string {
  return apiUrl(`/movie/${tmdbId}/credits`, {});
}

/** Full CDN URL for a poster path at the given size, or null when absent. */
export function posterUrl(
  posterPath: string | null | undefined,
  size: PosterSize = 'w200',
): string | null {
  if (typeof posterPath !== 'string' || !posterPath.startsWith('/')) return null;
  return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
}

function readYear(releaseDate: unknown): number | null {
  if (typeof releaseDate !== 'string') return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(releaseDate);
  return match === null ? null : Number(match[1]);
}

function mapGenreIds(genreIds: unknown): Genre | null {
  if (!Array.isArray(genreIds)) return null;
  for (const id of genreIds) {
    if (typeof id === 'number') {
      const mapped = TMDB_GENRE_TO_GENRE[id];
      if (mapped !== undefined) return mapped;
    }
  }
  return null;
}

/**
 * Defensively distills a `/search/movie` response into suggestions. Rows
 * missing a numeric id or a usable title are dropped; the caller can assume
 * every returned suggestion is renderable.
 */
export function parseMovieSuggestions(json: unknown): MovieSuggestion[] {
  if (typeof json !== 'object' || json === null) return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const suggestions: MovieSuggestion[] = [];
  for (const row of results) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    const tmdbId = record.id;
    if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId)) continue;
    const title =
      typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim()
        : typeof record.original_title === 'string'
          ? record.original_title.trim()
          : '';
    if (title.length === 0) continue;
    suggestions.push({
      tmdbId,
      title,
      year: readYear(record.release_date),
      posterPath:
        typeof record.poster_path === 'string' && record.poster_path.startsWith('/')
          ? record.poster_path
          : null,
      genre: mapGenreIds(record.genre_ids),
    });
  }
  return suggestions;
}

/** Extracts the director's name from a `/movie/{id}/credits` response. */
export function parseDirectorName(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const crew = (json as { crew?: unknown }).crew;
  if (!Array.isArray(crew)) return null;
  for (const member of crew) {
    if (typeof member !== 'object' || member === null) continue;
    const record = member as Record<string, unknown>;
    if (
      record.job === 'Director' &&
      typeof record.name === 'string' &&
      record.name.trim().length > 0
    ) {
      return record.name.trim();
    }
  }
  return null;
}

/** Guards the genre mapping so callers only ever see a valid app genre. */
export function isAppGenre(value: string | null): value is Genre {
  return value !== null && (GENRES as readonly string[]).includes(value);
}
