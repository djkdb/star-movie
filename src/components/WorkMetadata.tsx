import type { Genre, Rating } from '../domain/models';

export const GENRE_ICONS: Readonly<Record<Genre, string>> = {
  SF: '◉',
  로맨스: '✦',
  스릴러: '▲',
  드라마: '◆',
  애니: '✧',
  코미디: '☀',
  액션: '⚡',
  기타: '●',
};

export function GenreBadge({ genre }: { genre: Genre }) {
  return (
    <span aria-label={`장르 ${genre}`} className="genre-badge">
      <span aria-hidden="true" className="genre-icon">{GENRE_ICONS[genre]}</span>
      <span>{genre}</span>
    </span>
  );
}

export function RatingDisplay({ rating }: { rating: Rating }) {
  return (
    <span aria-label={`별점 ${rating}점`} className="rating-icons">
      <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
      <span className="rating-text">{rating}/5</span>
    </span>
  );
}
