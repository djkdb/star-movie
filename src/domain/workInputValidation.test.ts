import { describe, expect, it } from 'vitest';

import { validateWorkInput } from './workInputValidation';

describe('work input validation', () => {
  it('R2.2 R2.8 R2.16 trims and normalizes valid Unicode title and director values', () => {
    const result = validateWorkInput({
      title: '  CAFE\u0301  ',
      genre: 'SF',
      rating: 5,
      review: '',
      watchedDate: '2024-02-29',
      director: '  BONG JOON-HO  ',
    });

    expect(result).toEqual({
      success: true,
      data: {
        title: 'CAFÉ',
        normalizedTitle: 'café',
        genre: 'SF',
        rating: 5,
        review: '',
        watchedDate: '2024-02-29',
        director: 'BONG JOON-HO',
        normalizedDirector: 'bong joon-ho',
      },
    });
  });

  it('R2.5 R2.6 R2.14 rejects oversized reviews, impossible dates, and whitespace-only required text', () => {
    const result = validateWorkInput({
      title: ' \t\n ',
      genre: 'SF',
      rating: 3,
      review: '가'.repeat(101),
      watchedDate: '2023-02-29',
      director: '   ',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors.title).toBeDefined();
      expect(result.fieldErrors.review).toBeDefined();
      expect(result.fieldErrors.watchedDate).toBeDefined();
      expect(result.fieldErrors.director).toBeDefined();
    }
  });
});
