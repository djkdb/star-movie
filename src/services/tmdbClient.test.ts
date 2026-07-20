import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildMovieCreditsUrl,
  buildMovieSearchUrl,
  isTmdbConfigured,
  parseDirectorName,
  parseMovieSuggestions,
  posterUrl,
} from './tmdbClient';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tmdbClient URL building', () => {
  it('includes the key, Korean language, and encoded query in the search URL', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'secret-key');
    const url = new URL(buildMovieSearchUrl('기생충 & 살인'));
    expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/search/movie');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
    expect(url.searchParams.get('language')).toBe('ko-KR');
    expect(url.searchParams.get('query')).toBe('기생충 & 살인');
    expect(url.searchParams.get('include_adult')).toBe('false');
  });

  it('targets the movie credits endpoint by id', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'secret-key');
    const url = new URL(buildMovieCreditsUrl(496243));
    expect(url.pathname).toBe('/3/movie/496243/credits');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
  });

  it('throws when the key is missing so callers never issue an unauthed request', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', '');
    expect(() => buildMovieSearchUrl('duck')).toThrow(/not configured/);
    expect(isTmdbConfigured()).toBe(false);
  });

  it('reports configured when a non-empty key is present', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'secret-key');
    expect(isTmdbConfigured()).toBe(true);
  });
});

describe('posterUrl', () => {
  it('builds a sized CDN URL from a poster path', () => {
    expect(posterUrl('/abc.jpg', 'w200')).toBe('https://image.tmdb.org/t/p/w200/abc.jpg');
    expect(posterUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w200/abc.jpg');
    expect(posterUrl('/abc.jpg', 'w92')).toBe('https://image.tmdb.org/t/p/w92/abc.jpg');
  });

  it('returns null for missing or malformed paths', () => {
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl(undefined)).toBeNull();
    expect(posterUrl('abc.jpg')).toBeNull();
  });
});

describe('parseMovieSuggestions', () => {
  it('normalizes rows and maps the primary genre to an app genre', () => {
    const suggestions = parseMovieSuggestions({
      results: [
        {
          id: 496243,
          title: '기생충',
          release_date: '2019-05-30',
          poster_path: '/pos.jpg',
          genre_ids: [35, 53, 18],
        },
      ],
    });
    expect(suggestions).toEqual([
      { tmdbId: 496243, title: '기생충', year: 2019, posterPath: '/pos.jpg', genre: '코미디' },
    ]);
  });

  it('falls back to original_title and tolerates missing fields', () => {
    const suggestions = parseMovieSuggestions({
      results: [
        { id: 1, original_title: 'Dune', release_date: null, genre_ids: [878] },
        { id: 2, title: '   ' }, // blank title with no fallback → dropped
        { title: '제목만' }, // no id → dropped
        'garbage',
      ],
    });
    expect(suggestions).toEqual([
      { tmdbId: 1, title: 'Dune', year: null, posterPath: null, genre: 'SF' },
    ]);
  });

  it('returns an empty list for non-object or resultless payloads', () => {
    expect(parseMovieSuggestions(null)).toEqual([]);
    expect(parseMovieSuggestions({})).toEqual([]);
    expect(parseMovieSuggestions({ results: 'nope' })).toEqual([]);
  });

  it('maps unknown genre ids to null rather than guessing', () => {
    const [only] = parseMovieSuggestions({ results: [{ id: 7, title: 'X', genre_ids: [99999] }] });
    expect(only?.genre).toBeNull();
  });
});

describe('parseDirectorName', () => {
  it('returns the first crew member whose job is Director', () => {
    expect(
      parseDirectorName({
        crew: [
          { job: 'Writer', name: 'Someone' },
          { job: 'Director', name: '봉준호' },
          { job: 'Director', name: 'Second' },
        ],
      }),
    ).toBe('봉준호');
  });

  it('returns null when no director is present or the shape is wrong', () => {
    expect(parseDirectorName({ crew: [{ job: 'Writer', name: 'A' }] })).toBeNull();
    expect(parseDirectorName({ crew: 'nope' })).toBeNull();
    expect(parseDirectorName(null)).toBeNull();
  });
});
