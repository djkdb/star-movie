import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { EMOTION_TAGS, GENRES } from '../domain/models';
import {
  validateWorkInput,
  type WorkInput,
} from '../domain/workInputValidation';
import { posterUrl, type MovieSuggestion } from '../services/tmdbClient';
import type { ArchiveStoreApi, DomainError } from '../store/archiveStore';
import { TmdbAttribution } from './TmdbAttribution';
import { fetchMovieDirector, useMovieSuggestions } from './useMovieSuggestions';

/** The six user-facing fields; posterPath/tmdbId are metadata, not inputs. */
type FormField = 'title' | 'genre' | 'rating' | 'review' | 'watchedDate' | 'director';
type DirectorMode = 'existing' | 'custom';

/** TMDB metadata attached when a work is picked from autocomplete. */
interface SelectedMovie {
  tmdbId: number;
  posterPath: string | null;
}

type Draft = Record<Exclude<FormField, 'director'>, string> & {
  existingDirector: string;
  customDirector: string;
  watchedWith: string;
  emotion: string;
};

type FieldErrors = Partial<Record<FormField, string>>;

const FIELD_ORDER: readonly FormField[] = [
  'title',
  'genre',
  'rating',
  'review',
  'watchedDate',
  'director',
];

const FIELD_ERROR_MESSAGES: Record<FormField, string> = {
  title: '제목은 앞뒤 공백을 제외하고 1자 이상 200자 이하로 입력해 주세요.',
  genre: '장르는 목록의 8개 값 중 하나를 선택해 주세요.',
  rating: '별점은 1부터 5까지의 정수로 선택해 주세요.',
  review: '감상평은 100자 이하로 입력해 주세요.',
  watchedDate: '감상일은 달력에 존재하는 YYYY-MM-DD 날짜로 입력해 주세요.',
  director: '감독은 앞뒤 공백을 제외하고 1자 이상 200자 이하로 입력해 주세요.',
};

const EMPTY_DRAFT: Draft = {
  title: '',
  genre: '',
  rating: '',
  review: '',
  watchedDate: '',
  existingDirector: '',
  customDirector: '',
  watchedWith: '',
  emotion: '',
};

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

function selectedDirector(draft: Draft, mode: DirectorMode): string {
  return mode === 'existing' ? draft.existingDirector : draft.customDirector;
}

function createWorkInput(
  draft: Draft,
  mode: DirectorMode,
  selected: SelectedMovie | null,
): WorkInput {
  return {
    title: draft.title,
    genre: draft.genre,
    rating: draft.rating === '' ? '' : Number(draft.rating),
    review: draft.review,
    watchedDate: draft.watchedDate,
    director: selectedDirector(draft, mode),
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [directorMode, setDirectorMode] = useState<DirectorMode>('custom');
  const [errors, setErrors] = useState<FieldErrors>({});
  const fieldRefs = useRef<Partial<Record<FormField, HTMLElement | null>>>({});

  // TMDB autocomplete: suggestions for the current title, the pick's metadata,
  // and open/highlight state for the combobox dropdown.
  const [selectedMovie, setSelectedMovie] = useState<SelectedMovie | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sheenActive, setSheenActive] = useState(false);
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

  const directors = useMemo(() => {
    const byNormalizedName = new Map<string, string>();
    for (const star of stars) {
      if (!byNormalizedName.has(star.normalizedDirector)) {
        byNormalizedName.set(star.normalizedDirector, star.director);
      }
    }
    return [...byNormalizedName.values()].sort((left, right) =>
      left.localeCompare(right, 'ko'),
    );
  }, [stars]);

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Optional memory fields never carry validation errors to clear.
    if (field === 'watchedWith' || field === 'emotion') return;
    const errorField =
      field === 'existingDirector' || field === 'customDirector' ? 'director' : field;
    setErrors((current) => {
      if (current[errorField] === undefined) return current;
      const next = { ...current };
      delete next[errorField];
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
      customDirector: '',
    }));
    setDirectorMode('custom');
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
        setDraft((current) => ({ ...current, customDirector: name }));
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

  const handleDirectorModeChange = (mode: DirectorMode) => {
    setDirectorMode(mode);
    setErrors((current) => {
      if (current.director === undefined) return current;
      const next = { ...current };
      delete next.director;
      return next;
    });
    if (mode === 'existing' && draft.existingDirector === '' && directors[0] !== undefined) {
      setDraft((current) => ({ ...current, existingDirector: directors[0] ?? '' }));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = createWorkInput(draft, directorMode, selectedMovie);
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

    // First light: fly to the very first star while its fireworks bloom.
    if (wasEmptySky) {
      store.getState().commands.requestCameraFocus({
        type: 'star',
        starId: result.value.starId,
      });
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
    setDraft(EMPTY_DRAFT);
    setDirectorMode('custom');
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
                        <span aria-hidden="true" className="autocomplete-option-thumb is-empty">🎬</span>
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
          <label htmlFor="work-rating">별점</label>
          <select
            {...errorProps('rating')}
            id="work-rating"
            ref={(node) => { fieldRefs.current.rating = node; }}
            value={draft.rating}
            onChange={(event) => updateDraft('rating', event.target.value)}
          >
            <option value="">별점 선택</option>
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>{rating}점</option>
            ))}
          </select>
          {errors.rating !== undefined && <p id="rating-error" className="field-error">{errors.rating}</p>}
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

        <fieldset className="form-field director-field">
          <legend>감독</legend>
          <label htmlFor="director-mode">감독 입력 방식</label>
          <select
            id="director-mode"
            value={directorMode}
            onChange={(event) => handleDirectorModeChange(event.target.value as DirectorMode)}
          >
            <option value="custom">직접 입력</option>
            <option value="existing" disabled={directors.length === 0}>기존 감독 선택</option>
          </select>

          {directorMode === 'existing' ? (
            <>
              <label htmlFor="existing-director">기존 감독</label>
              <select
                {...errorProps('director')}
                id="existing-director"
                ref={(node) => { fieldRefs.current.director = node; }}
                value={draft.existingDirector}
                onChange={(event) => updateDraft('existingDirector', event.target.value)}
              >
                {directors.map((director) => (
                  <option key={director} value={director}>{director}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="custom-director">직접 입력 감독</label>
              <input
                {...errorProps('director')}
                id="custom-director"
                maxLength={200}
                ref={(node) => { fieldRefs.current.director = node; }}
                value={draft.customDirector}
                onChange={(event) => updateDraft('customDirector', event.target.value)}
              />
            </>
          )}
          {errors.director !== undefined && <p id="director-error" className="field-error">{errors.director}</p>}
        </fieldset>

        <button
          className={`primary-action form-field-wide${sheenActive ? ' sheen-run' : ''}`}
          onAnimationEnd={(event) => {
            if (event.animationName === 'sheen-sweep') setSheenActive(false);
          }}
          type="submit"
        >
          별로 등록하기
        </button>
      </form>
    </section>
  );
}
