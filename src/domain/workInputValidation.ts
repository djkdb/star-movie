import { z } from 'zod';

import { EMOTION_TAGS, GENRES, type EmotionTag, type Genre, type Rating } from './models';
import { normalizeDisplayText, normalizeText } from './normalization';

export interface WorkInput {
  title: unknown;
  genre: unknown;
  rating: unknown;
  review: unknown;
  watchedDate: unknown;
  director: unknown;
  posterPath?: unknown;
  tmdbId?: unknown;
  watchedWith?: unknown;
  emotion?: unknown;
}

export interface ValidatedWorkInput {
  title: string;
  normalizedTitle: string;
  genre: Genre;
  rating: Rating;
  review: string;
  watchedDate: string;
  director: string;
  normalizedDirector: string;
  posterPath?: string;
  tmdbId?: number;
  watchedWith?: string;
  emotion?: EmotionTag;
}

export type WorkInputValidationResult =
  | { success: true; data: ValidatedWorkInput }
  | { success: false; fieldErrors: Partial<Record<keyof WorkInput, string[]>> };

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

const displayTextSchema = z
  .string()
  .transform(normalizeDisplayText)
  .pipe(z.string().min(1).max(200));

const workInputSchema = z
  .object({
    title: displayTextSchema,
    genre: z.enum(GENRES),
    rating: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    review: z.string().max(100),
    watchedDate: z.string().refine(isRealCalendarDate, 'Invalid calendar date'),
    director: displayTextSchema,
    // Optional TMDB enrichment carried through from autocomplete selection.
    posterPath: z
      .string()
      .regex(/^\/[\w./-]+\.(jpg|jpeg|png|webp)$/i)
      .max(200)
      .optional(),
    tmdbId: z.number().int().positive().optional(),
    // Optional memory fields; the form omits them entirely when left blank.
    watchedWith: z
      .string()
      .transform(normalizeDisplayText)
      .pipe(z.string().min(1).max(100))
      .optional(),
    emotion: z.enum(EMOTION_TAGS).optional(),
  })
  .strict();

/** Validates raw form values and returns the exact display and normalized values to persist. */
export function validateWorkInput(input: WorkInput): WorkInputValidationResult {
  const result = workInputSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      fieldErrors: result.error.flatten().fieldErrors,
    };
  }

  const {
    title, genre, rating, review, watchedDate, director, posterPath, tmdbId,
    watchedWith, emotion,
  } = result.data;
  return {
    success: true,
    data: {
      title,
      normalizedTitle: normalizeText(title),
      genre,
      rating,
      review,
      watchedDate,
      director,
      normalizedDirector: normalizeText(director),
      // Only carry the optional TMDB keys when actually present, so persisted
      // stars never gain `undefined`-valued fields.
      ...(posterPath === undefined ? {} : { posterPath }),
      ...(tmdbId === undefined ? {} : { tmdbId }),
      ...(watchedWith === undefined ? {} : { watchedWith }),
      ...(emotion === undefined ? {} : { emotion }),
    },
  };
}
