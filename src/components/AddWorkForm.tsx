import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { todayLocalDate } from '../domain/memoryLane';
import { EMOTION_TAGS, GENRES, type Rating } from '../domain/models';
import { RATING_GLOW_COLORS } from '../domain/ratingGlow';
import {
  validateWorkInput,
  type WorkInput,
} from '../domain/workInputValidation';
import { posterUrl, type MovieSuggestion } from '../services/tmdbClient';
import type { ArchiveStoreApi, DomainError } from '../store/archiveStore';
import { TmdbAttribution } from './TmdbAttribution';
import { StarGlyph } from './WorkMetadata';
import { fetchMovieDirector, useMovieSuggestions } from './useMovieSuggestions';
import { FilmFrameIcon } from './icons';

/** The six user-facing fields; posterPath/tmdbId are metadata, not inputs. */
type FormField = 'title' | 'genre' | 'rating' | 'review' | 'watchedDate' | 'director';

/** TMDB metadata attached when a work is picked from autocomplete. */
interface SelectedMovie {
  tmdbId: number;
  posterPath: string | null;
}

type Draft = Record<FormField, string> & {
  watchedWith: string;
  emotion: string;
};

/**
 * How many previously-recorded directors are offered as one-tap chips. Enough
 * to cover the names a regular logger reaches for, few enough that the row
 * never becomes a second list to read.
 */
const RECENT_DIRECTOR_COUNT = 5;

type FieldErrors = Partial<Record<FormField, string>>;

/** Visual order, so "focus the first invalid field" means the topmost one. */
const FIELD_ORDER: readonly FormField[] = [
  'title',
  'genre',
  'rating',
  'director',
  'watchedDate',
  'review',
];

const FIELD_ERROR_MESSAGES: Record<FormField, string> = {
  title: '제목은 앞뒤 공백을 제외하고 1자 이상 200자 이하로 입력해 주세요.',
  genre: '장르는 목록의 8개 값 중 하나를 선택해 주세요.',
  rating: '별점은 1부터 5까지의 정수로 선택해 주세요.',
  review: '감상평은 100자 이하로 입력해 주세요.',
  watchedDate: '감상일은 달력에 존재하는 YYYY-MM-DD 날짜로 입력해 주세요.',
  director: '감독은 앞뒤 공백을 제외하고 1자 이상 200자 이하로 입력해 주세요.',
};

/**
 * A fresh draft. 감상일 starts on today because that is what it almost always
 * is — a film is logged the night it is watched — and leaving it blank made a
 * required field out of a near-certainty, one more thing standing between a
 * first-time visitor and their first star.
 */
function createEmptyDraft(today: Date = new Date()): Draft {
  return {
    title: '',
    genre: '',
    rating: '',
    review: '',
    watchedDate: todayLocalDate(today),
    director: '',
    watchedWith: '',
    emotion: '',
  };
}

function mapFieldErrors(
  fieldErrors: Partial<Record<string, string[]>>,
): FieldErrors {
  const mapped: FieldErrors = {};
  for (const field of FIELD_ORDER) {
    if ((fieldErrors[field]?.length ?? 0) > 0) {
      mapped[field] = FIELD_ERROR_MESSAGES[field];
    }
  }
  return mapped;
}

function createWorkInput(
  draft: Draft,
  selected: SelectedMovie | null,
): WorkInput {
  return {
    title: draft.title,
    genre: draft.genre,
    rating: draft.rating === '' ? '' : Number(draft.rating),
    review: draft.review,
    watchedDate: draft.watchedDate,
    director: draft.director,
    ...(selected?.posterPath != null ? { posterPath: selected.posterPath } : {}),
    ...(selected !== null ? { tmdbId: selected.tmdbId } : {}),
    ...(draft.watchedWith.trim().length > 0 ? { watchedWith: draft.watchedWith } : {}),
    ...(draft.emotion.length > 0 ? { emotion: draft.emotion } : {}),
  };
}

function isValidationError(error: DomainError): error is Extract<DomainError, { code: 'VALIDATION' }> {
  return error.code === 'VALIDATION';
}

export interface AddWorkFormProps {
  store: ArchiveStoreApi;
}

export function AddWorkForm({ store }: AddWorkFormProps) {
  const stars = useStore(store, (state) => state.persisted.stars);
  const watchlistPrefill = useStore(store, (state) => state.runtime.watchlistPrefill);
  const appliedPrefillId = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(createEmptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const fieldRefs = useRef<Partial<Record<FormField, HTMLElement | null>>>({});

  // TMDB autocomplete: suggestions for the current title, the pick's metadata,
  // and open/highlight state for the combobox dropdown.
  const [selectedMovie, setSelectedMovie] = useState<SelectedMovie | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sheenActive, setSheenActive] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const directorFetchToken = useRef(0);
  const { suggestions, loading, enabled: autocompleteEnabled } =
    useMovieSuggestions(suggestOpen ? draft.title : '');

  // A watchlist promotion arrives as a prefill: seed the draft once per entry
  // so the user only adds the rating, date and review to condense the nebula.
  useEffect(() => {
    if (watchlistPrefill === null) return;
    if (appliedPrefillId.current === watchlistPrefill.entryId) return;
    appliedPrefillId.current = watchlistPrefill.entryId;
    setDraft((current) => ({
      ...current,
      title: watchlistPrefill.title,
      genre: watchlistPrefill.genre,
    }));
    setSelectedMovie(
      watchlistPrefill.tmdbId === undefined
        ? null
        : {
            tmdbId: watchlistPrefill.tmdbId,
            posterPath: watchlistPrefill.posterPath ?? null,
          },
    );
    setSuggestOpen(false);
    setActiveIndex(-1);
  }, [watchlistPrefill]);

  // Most recently recorded first: the director you are logging again is far
  // more likely to be the one from last night than the one from last spring.
  const recentDirectors = useMemo(() => {
    const byNormalizedName = new Map<string, string>();
    for (const star of [...stars].reverse()) {
      if (!byNormalizedName.has(star.normalizedDirector)) {
        byNormalizedName.set(star.normalizedDirector, star.director);
      }
    }
    return [...byNormalizedName.values()].slice(0, RECENT_DIRECTOR_COUNT);
  }, [stars]);

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Optional memory fields never carry validation errors to clear.
    if (field === 'watchedWith' || field === 'emotion') return;
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  // Typing in the title box reopens autocomplete and drops any prior TMDB pick,
  // so a stale poster never rides along with an edited title.
  const handleTitleChange = (value: string) => {
    updateDraft('title', value);
    setSelectedMovie(null);
    setSuggestOpen(true);
    setActiveIndex(-1);
  };

  const applySuggestion = (suggestion: MovieSuggestion) => {
    setDraft((current) => ({
      ...current,
      title: suggestion.title,
      genre: suggestion.genre ?? current.genre,
      director: '',
    }));
    setSelectedMovie({ tmdbId: suggestion.tmdbId, posterPath: suggestion.posterPath });
    setSuggestOpen(false);
    setActiveIndex(-1);
    setErrors((current) => {
      const next = { ...current };
      delete next.title;
      delete next.genre;
      delete next.director;
      return next;
    });
    // Backfill the director from the movie's credits without blocking the UI;
    // a newer pick invalidates an older, slower in-flight lookup.
    const token = ++directorFetchToken.current;
    void fetchMovieDirector(suggestion.tmdbId).then((name) => {
      if (name !== null && directorFetchToken.current === token) {
        setDraft((current) => ({ ...current, director: name }));
      }
    });
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      const picked = suggestions[activeIndex];
      if (picked !== undefined) {
        event.preventDefault();
        applySuggestion(picked);
      }
    } else if (event.key === 'Escape') {
      setSuggestOpen(false);
      setActiveIndex(-1);
    }
  };

  const focusFirstError = (nextErrors: FieldErrors) => {
    const firstField = FIELD_ORDER.find((field) => nextErrors[field] !== undefined);
    if (firstField !== undefined) fieldRefs.current[firstField]?.focus();
  };

  const reportValidationErrors = (
    fieldErrors: Partial<Record<string, string[]>>,
  ) => {
    const nextErrors = mapFieldErrors(fieldErrors);
    setErrors(nextErrors);
    focusFirstError(nextErrors);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = createWorkInput(draft, selectedMovie);
    const validation = validateWorkInput(input);
    if (!validation.success) {
      reportValidationErrors(validation.fieldErrors);
      return;
    }

    const wasEmptySky = store.getState().persisted.stars.length === 0;
    const result = store.getState().commands.addWork(input);
    if (!result.ok) {
      if (isValidationError(result.error)) {
        reportValidationErrors(result.error.fieldErrors);
      }
      return;
    }

    // Fly to the new star every time, not only the first. Watching a star
    // arrive is the whole reason the archive is a sky — and it was happening
    // exactly once per universe, so every record after the first landed as a
    // line of toast text with nothing to look at.
    store.getState().commands.requestCameraFocus({
      type: 'star',
      starId: result.value.starId,
    });

    if (wasEmptySky) {
      store.getState().commands.pushGentleToast(
        '첫 별이 떠올랐습니다',
        '당신의 우주가 시작됐어요. 이야기가 쌓일수록 하늘이 넓어집니다.',
      );
    } else {
      // Every star birth deserves a nod, not just the first.
      store.getState().commands.pushGentleToast(
        '별이 하나 늘었어요',
        `『${draft.title.trim()}』이(가) 하늘에 자리를 잡았습니다.`,
      );
    }
    setSheenActive(true);
    setDraft(createEmptyDraft());
    setErrors({});
    setSelectedMovie(null);
    setSuggestOpen(false);
    setActiveIndex(-1);
    // A successful log condenses the promoted nebula into this new star.
    if (watchlistPrefill !== null) {
      store.getState().commands.removeFromWatchlist(watchlistPrefill.entryId);
      store.getState().commands.clearWatchlistPrefill();
      appliedPrefillId.current = null;
    }
  };

  const posterPreview = posterUrl(selectedMovie?.posterPath, 'w200');
  const listboxId = 'work-title-suggestions';
  const showList = autocompleteEnabled && suggestOpen && draft.title.trim().length >= 2;

  const errorProps = (field: FormField) => ({
    'aria-invalid': errors[field] === undefined ? undefined : true,
    'aria-describedby': errors[field] === undefined ? undefined : `${field}-error`,
  });

  return (
    <section className="add-work-panel" aria-labelledby="add-work-heading">
      <h2 id="add-work-heading">작품 추가</h2>
      <form className="add-work-form" noValidate onSubmit={handleSubmit}>
        <div className="form-field work-title-field">
          <label htmlFor="work-title">제목</label>
          <div className="autocomplete-shell">
            {posterPreview !== null && (
              <img
                alt=""
                aria-hidden="true"
                className="autocomplete-poster-thumb"
                src={posterPreview}
              />
            )}
            <input
              {...errorProps('title')}
              aria-activedescendant={
                showList && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-controls={showList ? listboxId : undefined}
              aria-expanded={showList}
              autoComplete="off"
              className={posterPreview !== null ? 'has-poster' : undefined}
              id="work-title"
              maxLength={200}
              placeholder="예: 인터스텔라"
              ref={(node) => { fieldRefs.current.title = node; }}
              role="combobox"
              value={draft.title}
              onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
              onChange={(event) => handleTitleChange(event.target.value)}
              onFocus={() => { if (draft.title.trim().length >= 2) setSuggestOpen(true); }}
              onKeyDown={handleTitleKeyDown}
            />
            {showList && (
              <ul className="autocomplete-list" id={listboxId} role="listbox">
                {loading && suggestions.length === 0 && (
                  <li className="autocomplete-status" aria-disabled="true">검색 중…</li>
                )}
                {!loading && suggestions.length === 0 && (
                  <li className="autocomplete-status" aria-disabled="true">검색 결과가 없어요</li>
                )}
                {suggestions.map((suggestion, index) => {
                  const thumb = posterUrl(suggestion.posterPath, 'w92');
                  return (
                    <li
                      key={suggestion.tmdbId}
                      aria-selected={index === activeIndex}
                      className={`autocomplete-option${index === activeIndex ? ' is-active' : ''}`}
                      id={`${listboxId}-${index}`}
                      role="option"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySuggestion(suggestion);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      {thumb !== null ? (
                        <img alt="" aria-hidden="true" className="autocomplete-option-thumb" src={thumb} />
                      ) : (
                        <span className="autocomplete-option-thumb is-empty"><FilmFrameIcon size={18} /></span>
                      )}
                      <span className="autocomplete-option-title">{suggestion.title}</span>
                      {suggestion.year !== null && (
                        <span className="autocomplete-option-year">{suggestion.year}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {autocompleteEnabled && (
            <>
              <p className="autocomplete-hint">제목을 입력하면 추천이 떠요. 골라 누르면 감독·포스터가 채워집니다.</p>
              <TmdbAttribution variant="inline" />
            </>
          )}
          {errors.title !== undefined && <p id="title-error" className="field-error">{errors.title}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="work-genre">장르</label>
          <select
            {...errorProps('genre')}
            id="work-genre"
            ref={(node) => { fieldRefs.current.genre = node; }}
            value={draft.genre}
            onChange={(event) => updateDraft('genre', event.target.value)}
          >
            <option value="">장르 선택</option>
            {GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
          </select>
          {errors.genre !== undefined && <p id="genre-error" className="field-error">{errors.genre}</p>}
        </div>

        <div className="form-field">
          <span className="form-field-label" id="work-rating-label">별점</span>
          <div
            aria-describedby={errors.rating === undefined ? undefined : 'rating-error'}
            aria-invalid={errors.rating === undefined ? undefined : true}
            aria-labelledby="work-rating-label"
            className="rating-picker"
            role="radiogroup"
          >
            {[1, 2, 3, 4, 5].map((rating) => {
              const filled = rating <= (hoverRating || Number(draft.rating || 0));
              return (
                <label
                  className={`rating-star${filled ? ' is-filled' : ''}`}
                  key={rating}
                  onMouseEnter={() => setHoverRating(rating)}
                  onMouseLeave={() => setHoverRating(0)}
                  style={{ '--rating-glow': RATING_GLOW_COLORS[rating as Rating] } as CSSProperties}
                >
                  <input
                    checked={draft.rating === String(rating)}
                    className="visually-hidden"
                    name="rating"
                    onChange={() => updateDraft('rating', String(rating))}
                    ref={rating === 1 ? (node) => { fieldRefs.current.rating = node; } : undefined}
                    type="radio"
                    value={rating}
                  />
                  <span aria-hidden="true" className="rating-star-glyph">
                    <StarGlyph filled={filled} />
                  </span>
                  <span className="visually-hidden">{rating}점</span>
                </label>
              );
            })}
          </div>
          {errors.rating !== undefined && <p id="rating-error" className="field-error">{errors.rating}</p>}
        </div>

        {/* One field, not three. 감독 used to open with "감독 입력 방식" — a
            question about this form rather than about the film — and only then
            offer a box to type in. The names already in the archive are better
            offered as something to tap than as a mode to switch into. */}
        <div className="form-field director-field">
          <label htmlFor="work-director">감독</label>
          <input
            {...errorProps('director')}
            id="work-director"
            maxLength={200}
            placeholder="예: 봉준호"
            ref={(node) => { fieldRefs.current.director = node; }}
            value={draft.director}
            onChange={(event) => updateDraft('director', event.target.value)}
          />
          {recentDirectors.length > 0 && draft.director.trim() === '' && (
            <div className="director-recent">
              <span className="director-recent-label" id="recent-director-label">
                최근 기록한 감독
              </span>
              <div className="director-recent-chips" role="group" aria-labelledby="recent-director-label">
                {recentDirectors.map((director) => (
                  <button
                    className="director-chip"
                    key={director}
                    type="button"
                    onClick={() => updateDraft('director', director)}
                  >
                    {director}
                  </button>
                ))}
              </div>
            </div>
          )}
          {errors.director !== undefined && <p id="director-error" className="field-error">{errors.director}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="work-watched-date">감상일</label>
          <input
            {...errorProps('watchedDate')}
            id="work-watched-date"
            ref={(node) => { fieldRefs.current.watchedDate = node; }}
            type="date"
            value={draft.watchedDate}
            onChange={(event) => updateDraft('watchedDate', event.target.value)}
          />
          {errors.watchedDate !== undefined && <p id="watchedDate-error" className="field-error">{errors.watchedDate}</p>}
        </div>

        <div className="form-field form-field-wide">
          <label htmlFor="work-review">감상평</label>
          <textarea
            {...errorProps('review')}
            id="work-review"
            maxLength={100}
            ref={(node) => { fieldRefs.current.review = node; }}
            rows={3}
            value={draft.review}
            onChange={(event) => updateDraft('review', event.target.value)}
          />
          <span className="character-count" aria-live="off">{draft.review.length}/100</span>
          {errors.review !== undefined && <p id="review-error" className="field-error">{errors.review}</p>}
        </div>

        <details className="form-extra form-field-wide">
          <summary>그날의 기억 더하기<span className="optional-hint">(선택)</span></summary>
          <div className="form-extra-body">
            <div className="form-field">
              <label htmlFor="work-watched-with">함께 본 사람 <span className="optional-hint">(선택)</span></label>
              <input
                id="work-watched-with"
                maxLength={100}
                placeholder="예: 혼자, 가족, 영화 동아리"
                value={draft.watchedWith}
                onChange={(event) => updateDraft('watchedWith', event.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="work-emotion">그날의 감정 <span className="optional-hint">(선택)</span></label>
              <select
                id="work-emotion"
                value={draft.emotion}
                onChange={(event) => updateDraft('emotion', event.target.value)}
              >
                <option value="">선택 안 함</option>
                {EMOTION_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>

          </div>
        </details>

        <div className="form-submit-bar form-field-wide">
          <button
            className={`primary-action${sheenActive ? ' sheen-run' : ''}`}
            onAnimationEnd={(event) => {
              if (event.animationName === 'sheen-sweep') setSheenActive(false);
            }}
            type="submit"
          >
            별로 등록하기
          </button>
        </div>
      </form>
    </section>
  );
}
