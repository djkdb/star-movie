/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Free read-only TMDB v3 API key enabling movie title/director autocomplete. */
  readonly VITE_TMDB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
