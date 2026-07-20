import { useEffect, useRef, useState } from 'react';

import {
  buildMovieCreditsUrl,
  buildMovieSearchUrl,
  isTmdbConfigured,
  parseDirectorName,
  parseMovieSuggestions,
  type MovieSuggestion,
} from '../services/tmdbClient';

/** Wait after the last keystroke before querying, to spare the API and the UI. */
const DEBOUNCE_MS = 320;
/** Shorter queries match too much to be useful and waste requests. */
const MIN_QUERY_LENGTH = 2;

export interface MovieSuggestionsState {
  suggestions: readonly MovieSuggestion[];
  loading: boolean;
  /** False when no TMDB key is configured; the form then hides autocomplete. */
  enabled: boolean;
}

/**
 * Debounced TMDB title search. Emits suggestions for the current query, cancels
 * in-flight requests when the query changes or the component unmounts, and stays
 * inert (enabled: false) when no API key is configured so manual entry is never
 * disrupted.
 */
export function useMovieSuggestions(query: string): MovieSuggestionsState {
  const enabled = isTmdbConfigured();
  const [suggestions, setSuggestions] = useState<readonly MovieSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(buildMovieSearchUrl(trimmed), { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          if (controller.signal.aborted) return;
          setSuggestions(parseMovieSuggestions(json));
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSuggestions([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { suggestions, loading, enabled };
}

/**
 * Resolves a picked movie's director via the credits endpoint. Returns null on
 * any failure so the caller can leave the director field for manual entry.
 */
export async function fetchMovieDirector(tmdbId: number): Promise<string | null> {
  try {
    const response = await fetch(buildMovieCreditsUrl(tmdbId));
    if (!response.ok) return null;
    return parseDirectorName(await response.json());
  } catch {
    return null;
  }
}
