import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import type { PersistedStateV2, Star } from '../../src/domain/models';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import { reconcileProgressAfterMutation } from '../../src/store/progressReconciler';

interface TextVariant {
  leadingWhitespace: string;
  trailingWhitespace: string;
  casing: 'original' | 'lower' | 'upper';
  unicodeForm: 'NFC' | 'NFD';
}

interface WorkGroup {
  titleId: number;
  directorBase:
    | 'Christopher Nolan'
    | 'Christopher Nolan Jr'
    | 'Nolan, Christopher'
    | '크리스토퍼 놀란'
    | 'Christopher No\u0301lan';
  copies: Array<{
    titleVariant: TextVariant;
    directorVariant: TextVariant;
  }>;
}

const NOW = '2031-02-03T04:05:06.000Z';
const NOLAN_DIRECTOR = 'christopher nolan';
const whitespaceArbitrary = fc.constantFrom(
  '',
  ' ',
  '  ',
  '\t',
  '\n',
  '\u00a0',
  '\u2003',
  ' \t',
);

const textVariantArbitrary: fc.Arbitrary<TextVariant> = fc.record({
  leadingWhitespace: whitespaceArbitrary,
  trailingWhitespace: whitespaceArbitrary,
  casing: fc.constantFrom('original', 'lower', 'upper'),
  unicodeForm: fc.constantFrom('NFC', 'NFD'),
});

const duplicateCopiesArbitrary = fc.array(
  fc.record({
    titleVariant: textVariantArbitrary,
    directorVariant: textVariantArbitrary,
  }),
  { minLength: 2, maxLength: 3 },
);

const nolanWorkGroupArbitrary: fc.Arbitrary<WorkGroup> = fc.record({
  titleId: fc.integer({ min: 0, max: 30 }),
  directorBase: fc.constant('Christopher Nolan'),
  copies: duplicateCopiesArbitrary,
});

const nonNolanWorkGroupArbitrary: fc.Arbitrary<WorkGroup> = fc.record({
  titleId: fc.integer({ min: 0, max: 30 }),
  directorBase: fc.constantFrom(
    'Christopher Nolan Jr',
    'Nolan, Christopher',
    '크리스토퍼 놀란',
    'Christopher No\u0301lan',
  ),
  copies: duplicateCopiesArbitrary,
});

const activeWorkCollectionArbitrary = fc
  .integer({ min: 0, max: 12 })
  .chain((nolanUniqueCount) =>
    fc.tuple(
      fc.uniqueArray(nolanWorkGroupArbitrary, {
        selector: ({ titleId }) => titleId,
        minLength: nolanUniqueCount,
        maxLength: nolanUniqueCount,
      }),
      fc.array(nonNolanWorkGroupArbitrary, { maxLength: 4 }),
    ),
  )
  .map(([nolanWorks, nonNolanWorks]) => [...nolanWorks, ...nonNolanWorks]);

function applyVariant(value: string, variant: TextVariant): string {
  const unicodeValue = value.normalize(variant.unicodeForm);
  const casedValue = variant.casing === 'lower'
    ? unicodeValue.toLocaleLowerCase('und')
    : variant.casing === 'upper'
      ? unicodeValue.toLocaleUpperCase('und')
      : unicodeValue;
  return `${variant.leadingWhitespace}${casedValue}${variant.trailingWhitespace}`;
}

function normalizeBySpecification(value: string): string {
  return value.trim().toLocaleLowerCase('und').normalize('NFC');
}

function makeUuid(index: number): string {
  return `25000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function createActiveWorks(
  groups: readonly WorkGroup[],
  state: Pick<PersistedStateV2, 'galaxies'>,
): { stars: Star[]; expectedProgress: number } {
  const galaxy = state.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === 'SF',
  );
  if (galaxy === undefined) throw new Error('Missing SF galaxy');

  const expectedUniqueWorks = new Set<string>();
  const stars: Star[] = [];

  for (const group of groups) {
    const baseTitle = `Film ${group.titleId} Café 가`;
    for (const copy of group.copies) {
      const rawTitle = applyVariant(baseTitle, copy.titleVariant);
      const rawDirector = applyVariant(group.directorBase, copy.directorVariant);
      const normalizedTitle = normalizeBySpecification(rawTitle);
      const normalizedDirector = normalizeBySpecification(rawDirector);

      if (normalizedDirector === NOLAN_DIRECTOR) {
        expectedUniqueWorks.add(`${normalizedTitle}::${normalizedDirector}`);
      }

      const title = normalizeDisplayText(rawTitle);
      const director = normalizeDisplayText(rawDirector);
      const index = stars.length + 1;
      stars.push({
        id: makeUuid(index),
        title,
        normalizedTitle: normalizeText(title),
        genre: 'SF',
        rating: 4,
        review: '',
        watchedDate: '2031-02-02',
        director,
        normalizedDirector: normalizeText(director),
        position: { ...galaxy.center },
        createdAt: NOW,
      });
    }
  }

  return { stars, expectedProgress: expectedUniqueWorks.size };
}

// Feature: space-movie-archive, Property 25: Achievement 고유 작품 집계
// **Validates: Requirements 17.1, 17.2, 17.7, 17.8, 17.9, 17.10**
describe('Property 25: Achievement unique work counting', () => {
  it('R17.1 R17.2 R17.7 R17.8 R17.9 R17.10 counts only distinct exact-normalized Nolan Unique Work Keys', () => {
    fc.assert(
      fc.property(activeWorkCollectionArbitrary, (groups) => {
        const previous = createDefaultStore(true).persisted;
        const candidate = structuredClone(previous);
        const { stars, expectedProgress } = createActiveWorks(groups, candidate);
        candidate.stars = stars;

        const result = reconcileProgressAfterMutation(previous, candidate, {
          nowIso: NOW,
          nextRewardId: () => {
            throw new Error('Collections are constrained below milestone thresholds');
          },
        });
        const nolanMaster = result.candidate.achievements.find(
          ({ id }) => id === 'nolan-master',
        );

        expect(nolanMaster).toMatchObject({
          id: 'nolan-master',
          name: '놀란 마스터',
          description: expect.any(String),
          ruleId: 'nolan-unique-work',
          progress: expectedProgress,
          target: 10,
          unlocked: expectedProgress >= 10,
          unlockedAt: expectedProgress >= 10 ? NOW : null,
        });
        expect(nolanMaster?.description.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
