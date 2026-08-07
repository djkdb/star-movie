import type { Genre, Rating } from '../domain/models';
import { GENRE_STAR_HUES } from '../scene/starVisualModel';

/**
 * Genre used to be marked with a unicode glyph (◉ ✦ ▲ ◆ …). Those render
 * differently on every platform, cannot be aligned or weighted, and at the
 * ~11px these appear at no pictogram reads anyway — which is why Letterboxd
 * marks genre with nothing but text.
 *
 * The dot carries the colour that genre's stars actually glow in the sky, so
 * the list and the universe are the same index rather than two vocabularies.
 */
export function GenreDot({ genre }: { genre: Genre }) {
  return (
    <svg
      aria-hidden="true"
      className="genre-dot"
      height="8"
      viewBox="0 0 8 8"
      width="8"
    >
      <circle cx="4" cy="4" fill={GENRE_STAR_HUES[genre]} r="3" />
    </svg>
  );
}

export function GenreBadge({ genre }: { genre: Genre }) {
  return (
    <span aria-label={`장르 ${genre}`} className="genre-badge">
      <GenreDot genre={genre} />
      <span>{genre}</span>
    </span>
  );
}

/** One star on the same 24px grid and 1.5 stroke as the dock glyphs. */
function StarGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`star-glyph${filled ? ' is-filled' : ''}`}
      fill={filled ? 'currentColor' : 'none'}
      height="13"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width="13"
    >
      <path d="M12 3.2 14.7 9l6.3.9-4.6 4.4 1.1 6.3L12 17.6 6.5 20.6l1.1-6.3L3 9.9 9.3 9Z" />
    </svg>
  );
}

export function RatingDisplay({ rating }: { rating: Rating }) {
  return (
    <span aria-label={`별점 ${rating}점`} className="rating-icons">
      <span aria-hidden="true" className="rating-stars">
        {[1, 2, 3, 4, 5].map((step) => (
          <StarGlyph filled={step <= rating} key={step} />
        ))}
      </span>
      <span className="rating-text">{rating}/5</span>
    </span>
  );
}

export { StarGlyph };
