import { isTmdbConfigured } from '../services/tmdbClient';

/** The exact notice TMDB's API Terms of Use require to be shown prominently. */
export const TMDB_ATTRIBUTION_NOTICE =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

/**
 * The TMDB brand logo, rebuilt as an inline SVG in TMDB's official gradient
 * (#90CEA1 → #01B4E4). Using their logo to identify use of the API is required
 * by the terms; swap in the official asset from
 * https://www.themoviedb.org/about/logos-attribution for pixel-perfect branding.
 */
function TmdbLogo() {
  return (
    <svg
      aria-label="TMDB"
      className="tmdb-logo"
      role="img"
      viewBox="0 0 100 14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="tmdb-brand" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#90CEA1" />
          <stop offset="1" stopColor="#01B4E4" />
        </linearGradient>
      </defs>
      <rect width="100" height="14" rx="2.4" fill="url(#tmdb-brand)" />
      <text
        x="50"
        y="10.4"
        textAnchor="middle"
        fill="#0d253f"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.4"
        fontWeight="800"
        letterSpacing="0.6"
      >
        TMDB
      </text>
    </svg>
  );
}

export interface TmdbAttributionProps {
  /** 'block' for a credits section, 'inline' for a compact contextual credit. */
  variant?: 'block' | 'inline';
}

/**
 * Required TMDB attribution: the brand logo plus the mandated notice. Renders
 * only when a TMDB key is configured, i.e. exactly when the API is in use.
 */
export function TmdbAttribution({ variant = 'block' }: TmdbAttributionProps) {
  if (!isTmdbConfigured()) return null;
  return (
    <div className={`tmdb-attribution tmdb-attribution-${variant}`}>
      <a
        aria-label="The Movie Database (TMDB)"
        className="tmdb-attribution-mark"
        href="https://www.themoviedb.org/"
        rel="noreferrer noopener"
        target="_blank"
      >
        <TmdbLogo />
      </a>
      <p className="tmdb-notice">{TMDB_ATTRIBUTION_NOTICE}</p>
    </div>
  );
}
