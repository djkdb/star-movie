import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GENRES } from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import { validateWorkInput, type WorkInput } from '../../src/domain/workInputValidation';

const whitespaceArbitrary = fc.constantFrom('', ' ', '  ', '\t', '\n', ' \t\n');
const unicodeTokenArbitrary = fc.constantFrom(
  'a',
  'Z',
  '가',
  '한',
  '中',
  'é',
  'e\u0301',
  'ß',
  '😀',
  '🎬',
);

const unicodeTextArbitrary = fc.oneof(
  fc.string({ maxLength: 205 }),
  fc.array(unicodeTokenArbitrary, { maxLength: 205 }).map((tokens) => tokens.join('')),
  fc.constantFrom(
    '',
    ' ',
    'a'.repeat(199),
    'a'.repeat(200),
    'a'.repeat(201),
    '가'.repeat(199),
    '가'.repeat(200),
    '가'.repeat(201),
    'Cafe\u0301',
  ),
);

const paddedUnicodeTextArbitrary = fc
  .tuple(whitespaceArbitrary, unicodeTextArbitrary, whitespaceArbitrary)
  .map(([leading, value, trailing]) => `${leading}${value}${trailing}`);

const reviewArbitrary = fc.oneof(
  fc.string({ maxLength: 105 }),
  fc.constantFrom('', '가'.repeat(99), '가'.repeat(100), '가'.repeat(101), '🎬'.repeat(50), '🎬'.repeat(51)),
);

const validDateArbitrary = fc
  .date({ min: new Date('1900-01-01T00:00:00.000Z'), max: new Date('2100-12-31T00:00:00.000Z') })
  .map((date) => date.toISOString().slice(0, 10));
const invalidDateArbitrary = fc.oneof(
  fc.constantFrom('', '2024-2-29', '2023-02-29', '2024-00-10', '2024-13-01', '2024-04-31', 'not-a-date'),
  fc.tuple(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 })).map(
    ([year, month]) => `${year}-${String(month).padStart(2, '0')}-32`,
  ),
);
const dateArbitrary = fc.oneof(validDateArbitrary, invalidDateArbitrary);

const genreArbitrary = fc.oneof(
  fc.constantFrom(...GENRES),
  fc.constantFrom('', 'sf', '공포', 'SF ', 0, null, undefined),
);
const ratingArbitrary = fc.oneof(
  fc.constantFrom(1, 2, 3, 4, 5),
  fc.constantFrom(-1, 0, 1.5, 6, '1', null, undefined, Number.NaN),
);

const workInputArbitrary: fc.Arbitrary<WorkInput> = fc.record({
  title: paddedUnicodeTextArbitrary,
  genre: genreArbitrary,
  rating: ratingArbitrary,
  review: reviewArbitrary,
  watchedDate: dateArbitrary,
  director: paddedUnicodeTextArbitrary,
});

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (monthLengths[month - 1] ?? 0);
}

function isValidInput(input: WorkInput): boolean {
  const title = typeof input.title === 'string' ? normalizeDisplayText(input.title) : '';
  const director = typeof input.director === 'string' ? normalizeDisplayText(input.director) : '';
  return (
    title.length >= 1 &&
    title.length <= 200 &&
    GENRES.some((genre) => genre === input.genre) &&
    typeof input.rating === 'number' &&
    Number.isInteger(input.rating) &&
    input.rating >= 1 &&
    input.rating <= 5 &&
    typeof input.review === 'string' &&
    input.review.length <= 100 &&
    isRealDate(input.watchedDate) &&
    director.length >= 1 &&
    director.length <= 200
  );
}

// Feature: space-movie-archive, Property 2: 입력 정규화 및 검증의 폐쇄성
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.14, 2.16**
describe('Property 2: input normalization and validation closure', () => {
  it('R2.2 R2.3 R2.4 R2.5 R2.6 R2.8 R2.14 R2.16 accepts exactly valid inputs and returns canonical persisted text', () => {
    fc.assert(
      fc.property(workInputArbitrary, (input) => {
        const result = validateWorkInput(input);
        expect(result.success).toBe(isValidInput(input));

        if (result.success) {
          const expectedTitle = normalizeDisplayText(input.title as string);
          const expectedDirector = normalizeDisplayText(input.director as string);
          expect(result.data.title).toBe(expectedTitle);
          expect(result.data.director).toBe(expectedDirector);
          expect(result.data.normalizedTitle).toBe(normalizeText(expectedTitle));
          expect(result.data.normalizedDirector).toBe(normalizeText(expectedDirector));
          expect(GENRES).toContain(result.data.genre);
          expect(Number.isInteger(result.data.rating)).toBe(true);
          expect(result.data.rating).toBeGreaterThanOrEqual(1);
          expect(result.data.rating).toBeLessThanOrEqual(5);
          expect(result.data.review.length).toBeLessThanOrEqual(100);
          expect(isRealDate(result.data.watchedDate)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
