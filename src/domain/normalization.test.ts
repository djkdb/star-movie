import { describe, expect, it } from 'vitest';

import {
  createUniqueWorkKey,
  getStarUniqueWorkKey,
  normalizeDisplayText,
  normalizeText,
} from './normalization';

describe('domain text normalization', () => {
  it('R2.16 trims display text and canonicalizes it to Unicode NFC', () => {
    expect(normalizeDisplayText('  Cafe\u0301  ')).toBe('Café');
    expect(normalizeText('  CAFE\u0301  ')).toBe('café');
  });

  it('R17.7 creates the same Unique Work Key for canonical case and spacing variants', () => {
    expect(createUniqueWorkKey('  INCEPTION ', ' Christopher Nolan ')).toBe(
      'inception::christopher nolan',
    );
    expect(createUniqueWorkKey('Cafe\u0301', 'CHRISTOPHER NOLAN')).toBe(
      createUniqueWorkKey('Café', 'christopher nolan'),
    );
  });

  it('R17.1 derives a canonical key from persisted normalized fields', () => {
    expect(
      getStarUniqueWorkKey({
        normalizedTitle: '  The Prestige ',
        normalizedDirector: ' Christopher Nolan ',
      }),
    ).toBe('the prestige::christopher nolan');
  });
});
