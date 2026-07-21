import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ACHIEVEMENT_DEFINITIONS } from '../../src/domain/achievementCatalog';
import { createDefaultPersistedStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Achievement,
  type ArchivedStar,
  type Constellation,
  type Galaxy,
  type Genre,
  type Milestone,
  type PersistedStateV2,
  type PlanetCollection,
  type Rating,
  type Star,
} from '../../src/domain/models';
import { PLANET_SPECIES_IDS } from '../../src/domain/planetCatalog';
import { normalizeDisplayText, normalizeText } from '../../src/domain/normalization';
import {
  decodePersistedV2,
  encodePersistedV2,
} from '../../src/persistence/persistedStateCodec';

const makeUuid = (namespace: number, value: number): string =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, '0')}`;

const isoTimestampArbitrary = fc
  .integer({ min: 0, max: 20_000 })
  .map((days) => new Date(Date.UTC(2000, 0, 1 + days)).toISOString());

const watchedDateArbitrary = fc
  .integer({ min: 0, max: 20_000 })
  .map((days) => new Date(Date.UTC(2000, 0, 1 + days)).toISOString().slice(0, 10));

const displayTextArbitrary = (prefix: string, maximumSuffixLength: number) =>
  fc
    .string({ maxLength: maximumSuffixLength })
    .map((suffix) => normalizeDisplayText(`${prefix}${suffix}`));

const hexColorArbitrary = fc
  .integer({ min: 0, max: 0xffffff })
  .map((value) => `#${value.toString(16).padStart(6, '0')}`);

interface StarSeed {
  title: string;
  genre: Genre;
  rating: Rating;
  review: string;
  watchedDate: string;
  director: string;
  createdAt: string;
}

const starSeedArbitrary: fc.Arbitrary<StarSeed> = fc.record({
  title: displayTextArbitrary('Title ', 40),
  genre: fc.constantFrom(...GENRES),
  rating: fc.constantFrom<Rating>(1, 2, 3, 4, 5),
  review: fc.string({ maxLength: 60 }),
  watchedDate: watchedDateArbitrary,
  director: displayTextArbitrary('Director ', 40),
  createdAt: isoTimestampArbitrary,
});

const createStar = (
  seed: StarSeed,
  id: string,
  galaxyByGenre: ReadonlyMap<Genre, Galaxy>,
): Star => {
  const galaxy = galaxyByGenre.get(seed.genre);
  if (galaxy === undefined) throw new Error(`Missing generated galaxy for ${seed.genre}`);

  return {
    id,
    title: seed.title,
    normalizedTitle: normalizeText(seed.title),
    genre: seed.genre,
    rating: seed.rating,
    review: seed.review,
    watchedDate: seed.watchedDate,
    director: seed.director,
    normalizedDirector: normalizeText(seed.director),
    position: { ...galaxy.center },
    createdAt: seed.createdAt,
  };
};

const milestoneArbitrary = (
  target: 50 | 100,
  rewardId: string,
): fc.Arbitrary<Milestone> =>
  fc.boolean().chain<Milestone>((unlocked) =>
    unlocked
      ? isoTimestampArbitrary.map<Milestone>((unlockedAt) => ({
          target,
          unlocked: true,
          unlockedAt,
          rewardId,
        }))
      : fc.constant<Milestone>({
          target,
          unlocked: false,
          unlockedAt: null,
          rewardId: null,
        }),
  );

// A canonical current document holds exactly the shipped achievements (by id);
// only per-user progress and unlock state vary. Generating the full catalog
// keeps the decode-time achievement backfill a no-op so the round-trip holds.
const achievementArbitrary: fc.Arbitrary<Achievement[]> = fc
  .tuple(
    ...ACHIEVEMENT_DEFINITIONS.map((definition) =>
      fc
        .record({
          progress: fc.integer({ min: 0, max: definition.target * 2 }),
          unlockedAt: fc.option(isoTimestampArbitrary, { nil: null }),
        })
        .map<Achievement>((seed) => ({
          id: definition.id,
          name: definition.name,
          description: definition.description,
          ruleId: definition.ruleId,
          progress: seed.progress,
          target: definition.target,
          unlocked: seed.unlockedAt !== null,
          unlockedAt: seed.unlockedAt,
        })),
    ),
  )
  .map((achievements) => [...achievements]);

const planetCollectionArbitrary: fc.Arbitrary<PlanetCollection> = fc
  .nat({ max: 6 })
  .chain((pullsPerformed) =>
    fc
      .record({
        lifetimeStarsAdded: fc.integer({
          min: pullsPerformed * 5,
          max: pullsPerformed * 5 + 4,
        }),
        speciesPicks: fc.array(fc.constantFrom(...PLANET_SPECIES_IDS), {
          minLength: pullsPerformed,
          maxLength: pullsPerformed,
        }),
        seeds: fc.array(fc.integer({ min: 0, max: 0xffffffff }), {
          minLength: pullsPerformed,
          maxLength: pullsPerformed,
        }),
        acquired: fc.array(isoTimestampArbitrary, {
          minLength: pullsPerformed,
          maxLength: pullsPerformed,
        }),
      })
      .map(({ lifetimeStarsAdded, speciesPicks, seeds, acquired }) => ({
        lifetimeStarsAdded,
        pullsPerformed,
        planets: speciesPicks.map((speciesId, index) => ({
          id: makeUuid(7, index + 1),
          speciesId,
          acquiredAt: acquired[index]!,
          orbitSeed: seeds[index]!,
        })),
      })),
  );

const persistedStateV2Arbitrary: fc.Arbitrary<PersistedStateV2> = fc
  .tuple(
    fc.array(starSeedArbitrary, { maxLength: 6 }),
    fc.array(starSeedArbitrary, { maxLength: 6 }),
    milestoneArbitrary(50, makeUuid(5, 50)),
    milestoneArbitrary(100, makeUuid(5, 100)),
    achievementArbitrary,
    fc.integer({ min: 1, max: 30 }),
    planetCollectionArbitrary,
  )
  .chain(([
    activeSeeds,
    archivedSeeds,
    fifty,
    hundred,
    achievements,
    placementRadius,
    planetCollection,
  ]) => {
    const defaults = createDefaultPersistedStore();
    const genreGalaxies = defaults.galaxies.map((galaxy) => ({
      ...galaxy,
      center: { ...galaxy.center },
      placementRadius,
    }));
    const galaxyByGenre = new Map(
      genreGalaxies.flatMap((galaxy) =>
        galaxy.kind.type === 'genre' ? [[galaxy.kind.genre, galaxy] as const] : [],
      ),
    );
    const stars = activeSeeds.map((seed, index) =>
      createStar(seed, makeUuid(1, index + 1), galaxyByGenre),
    );
    const blackholeArchive: ArchivedStar[] = archivedSeeds.map((seed, index) => ({
      ...createStar(seed, makeUuid(2, index + 1), galaxyByGenre),
      discardedAt: seed.createdAt,
    }));

    return fc
      .tuple(
        fc.array(
          fc.record({
            name: displayTextArbitrary('Constellation ', 12),
            color: hexColorArbitrary,
            createdAt: isoTimestampArbitrary,
            starIds: fc.shuffledSubarray(stars.map(({ id }) => id), {
              maxLength: Math.min(6, stars.length),
            }),
          }),
          { maxLength: 4 },
        ),
        fc.shuffledSubarray(genreGalaxies, {
          minLength: genreGalaxies.length,
          maxLength: genreGalaxies.length,
        }),
      )
      .map(([constellationSeeds, shuffledGenreGalaxies]) => {
        const constellations: Constellation[] = constellationSeeds.map((seed, index) => ({
          id: makeUuid(3, index + 1),
          ...seed,
        }));
        const galaxies: Galaxy[] = [...shuffledGenreGalaxies];
        if (hundred.rewardId !== null) {
          galaxies.splice(Math.floor(galaxies.length / 2), 0, {
            id: hundred.rewardId,
            kind: { type: 'reward', rewardType: 'milestone-100' },
            center: { x: 0, y: 30, z: 0 },
            placementRadius,
            themeId: 'milestone-100-reward',
            primaryColor: '#ffffff',
            unlocked: true,
          });
        }

        return {
          schemaVersion: 2 as const,
          stars,
          constellations,
          blackholeArchive,
          galaxies,
          milestoneUnlocks: { fifty, hundred },
          achievements,
          planetCollection,
        };
      });
  });

// Feature: space-movie-archive, Property 10: schemaVersion 2 직렬화 round-trip
// **Validates: Requirements 1.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.13**
describe('Property 10: schemaVersion 2 serialization round-trip', () => {
  it('R1.10 R8.1-R8.9 R8.13 preserves every field and all collection/item ordering', () => {
    fc.assert(
      fc.property(persistedStateV2Arbitrary, (state) => {
        const decoded = decodePersistedV2(encodePersistedV2(state));

        expect(decoded).toEqual(state);
        expect(decoded.stars.map(({ id }) => id)).toEqual(state.stars.map(({ id }) => id));
        expect(decoded.constellations.map(({ id }) => id)).toEqual(
          state.constellations.map(({ id }) => id),
        );
        expect(decoded.constellations.map(({ starIds }) => starIds)).toEqual(
          state.constellations.map(({ starIds }) => starIds),
        );
        expect(decoded.blackholeArchive.map(({ id }) => id)).toEqual(
          state.blackholeArchive.map(({ id }) => id),
        );
        expect(decoded.galaxies.map(({ id }) => id)).toEqual(
          state.galaxies.map(({ id }) => id),
        );
        expect(decoded.achievements.map(({ id }) => id)).toEqual(
          state.achievements.map(({ id }) => id),
        );
      }),
      { numRuns: 100 },
    );
  });
});
