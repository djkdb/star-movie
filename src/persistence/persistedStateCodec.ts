import { z } from 'zod';

import { MINIMUM_GALAXY_CENTER_DISTANCE } from '../domain/defaultState';
import {
  GENRES,
  type Galaxy,
  type Genre,
  type PersistedStateV2,
  type Vec3,
} from '../domain/models';
import { normalizeDisplayText, normalizeText } from '../domain/normalization';
import { isKnownSpeciesId } from '../domain/planetCatalog';
import { ticketsEarned } from '../domain/planetGacha';

/**
 * Generous radius of the shared free-roaming star field. Any persisted star must
 * sit within this distance of the origin; the bound is wide enough to also
 * accept legacy per-genre placements from earlier schema-2 documents.
 */
export const STAR_FIELD_MAX_DISTANCE = 120;

const UUID = z.string().uuid();
const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const FINITE_NUMBER = z.number().finite();

const genreSchema = z.enum(GENRES);
const ratingSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const vec3Schema = z
  .object({ x: FINITE_NUMBER, y: FINITE_NUMBER, z: FINITE_NUMBER })
  .strict();

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const watchedDateSchema = z.string().refine(isRealCalendarDate, 'Invalid calendar date');
const trimmedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === normalizeDisplayText(value), 'Text must be trimmed NFC');

const starFields = {
  id: UUID,
  title: trimmedText(200),
  normalizedTitle: z.string().min(1).max(200),
  genre: genreSchema,
  rating: ratingSchema,
  review: z.string().max(100),
  watchedDate: watchedDateSchema,
  director: trimmedText(200),
  normalizedDirector: z.string().min(1).max(200),
  position: vec3Schema,
  createdAt: ISO_TIMESTAMP,
  // Optional TMDB enrichment from autocomplete; absent on manually typed works
  // and every pre-existing document, so no migration is required.
  posterPath: z
    .string()
    .regex(/^\/[\w./-]+\.(jpg|jpeg|png|webp)$/i)
    .max(200)
    .optional(),
  tmdbId: z.number().int().positive().optional(),
} as const;

function validateNormalizedStarText(
  star: { title: string; normalizedTitle: string; director: string; normalizedDirector: string },
  context: z.RefinementCtx,
): void {
  if (star.normalizedTitle !== normalizeText(star.title)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['normalizedTitle'],
      message: 'normalizedTitle must match title',
    });
  }
  if (star.normalizedDirector !== normalizeText(star.director)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['normalizedDirector'],
      message: 'normalizedDirector must match director',
    });
  }
}

const starSchema = z.object(starFields).strict().superRefine(validateNormalizedStarText);
const archivedStarSchema = z
  .object({ ...starFields, discardedAt: ISO_TIMESTAMP })
  .strict()
  .superRefine(validateNormalizedStarText);

const constellationSchema = z
  .object({
    id: UUID,
    name: trimmedText(30),
    starIds: z.array(UUID).max(200),
    color: HEX_COLOR,
    createdAt: ISO_TIMESTAMP,
  })
  .strict()
  .superRefine((constellation, context) => {
    if (new Set(constellation.starIds).size !== constellation.starIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['starIds'],
        message: 'Constellation references must be unique',
      });
    }
  });

const genreThemeSchema = z.enum([
  'blue-spiral',
  'pink-core-nebula',
  'red-asymmetric-bands',
  'gold-elliptical',
  'purple-prism',
  'yellow-rings',
  'orange-burst',
  'teal-irregular-clusters',
]);

const galaxySchema = z
  .object({
    id: UUID,
    kind: z.discriminatedUnion('type', [
      z.object({ type: z.literal('genre'), genre: genreSchema }).strict(),
      z
        .object({
          type: z.literal('reward'),
          rewardType: z.literal('milestone-100'),
        })
        .strict(),
    ]),
    center: vec3Schema,
    placementRadius: FINITE_NUMBER.positive(),
    themeId: z.union([genreThemeSchema, z.literal('milestone-100-reward')]),
    primaryColor: HEX_COLOR,
    unlocked: z.boolean(),
  })
  .strict()
  .superRefine((galaxy, context) => {
    if (galaxy.kind.type === 'genre' && galaxy.themeId === 'milestone-100-reward') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['themeId'],
        message: 'Genre galaxies require a genre theme',
      });
    }
    if (galaxy.kind.type === 'reward' && galaxy.themeId !== 'milestone-100-reward') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['themeId'],
        message: 'Reward galaxies require the milestone reward theme',
      });
    }
  });

const milestoneSchema = z
  .object({
    target: z.union([z.literal(50), z.literal(100)]),
    unlocked: z.boolean(),
    unlockedAt: ISO_TIMESTAMP.nullable(),
    rewardId: UUID.nullable(),
  })
  .strict()
  .superRefine((milestone, context) => {
    const validLinkage = milestone.unlocked
      ? milestone.unlockedAt !== null && milestone.rewardId !== null
      : milestone.unlockedAt === null && milestone.rewardId === null;
    if (!validLinkage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Milestone unlock metadata must be both present exactly when unlocked',
      });
    }
  });

const achievementSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: trimmedText(100),
    description: trimmedText(500),
    ruleId: z.literal('nolan-unique-work'),
    progress: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    unlocked: z.boolean(),
    unlockedAt: ISO_TIMESTAMP.nullable(),
  })
  .strict()
  .superRefine((achievement, context) => {
    if (achievement.unlocked !== (achievement.unlockedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unlockedAt'],
        message: 'Achievement unlockedAt must be present exactly when unlocked',
      });
    }
  });

const UINT32 = z.number().int().nonnegative().max(0xffffffff);

const ownedPlanetSchema = z
  .object({
    id: UUID,
    speciesId: z
      .string()
      .min(1)
      .max(60)
      .refine(isKnownSpeciesId, 'Unknown planet species'),
    acquiredAt: ISO_TIMESTAMP,
    orbitSeed: UINT32,
  })
  .strict();

const planetCollectionSchema = z
  .object({
    lifetimeStarsAdded: z.number().int().nonnegative(),
    pullsPerformed: z.number().int().nonnegative(),
    planets: z.array(ownedPlanetSchema),
  })
  .strict()
  .superRefine((collection, context) => {
    if (collection.planets.length !== collection.pullsPerformed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planets'],
        message: 'Owned planet count must equal the number of pulls performed',
      });
    }
    if (collection.pullsPerformed > ticketsEarned(collection.lifetimeStarsAdded)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pullsPerformed'],
        message: 'Cannot perform more pulls than tickets earned',
      });
    }
  });

const persistedStateShapeSchema = z
  .object({
    schemaVersion: z.literal(2),
    stars: z.array(starSchema),
    constellations: z.array(constellationSchema),
    blackholeArchive: z.array(archivedStarSchema),
    galaxies: z.array(galaxySchema),
    milestoneUnlocks: z
      .object({ fifty: milestoneSchema, hundred: milestoneSchema })
      .strict(),
    achievements: z.array(achievementSchema),
    planetCollection: planetCollectionSchema,
  })
  .strict();

type ParsedState = z.infer<typeof persistedStateShapeSchema>;

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function addDuplicateIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: (string | number)[],
  label: string,
): void {
  if (findDuplicates(values).length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message: `${label} must be unique` });
  }
}

function validateDocument(state: ParsedState, context: z.RefinementCtx): void {
  const genreGalaxies = state.galaxies.filter(
    (galaxy): galaxy is Galaxy & { kind: { type: 'genre'; genre: Genre } } =>
      galaxy.kind.type === 'genre',
  );
  const genreCounts = new Map<Genre, number>(GENRES.map((genre) => [genre, 0]));
  for (const galaxy of genreGalaxies) {
    genreCounts.set(galaxy.kind.genre, (genreCounts.get(galaxy.kind.genre) ?? 0) + 1);
    if (!galaxy.unlocked) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['galaxies'],
        message: 'Genre galaxies must be unlocked',
      });
    }
  }
  if (
    genreGalaxies.length !== GENRES.length ||
    GENRES.some((genre) => genreCounts.get(genre) !== 1)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['galaxies'],
      message: 'Document must contain exactly one galaxy for each of the eight genres',
    });
  }

  for (let leftIndex = 0; leftIndex < genreGalaxies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < genreGalaxies.length; rightIndex += 1) {
      const left = genreGalaxies[leftIndex];
      const right = genreGalaxies[rightIndex];
      if (left && right && distance(left.center, right.center) < MINIMUM_GALAXY_CENTER_DISTANCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['galaxies', rightIndex, 'center'],
          message: 'Genre galaxy centers must be at least 25 units apart',
        });
      }
    }
  }

  // Stars now roam a single shared field instead of per-genre regions, so a
  // position only needs to sit within the generous global field bound. The
  // range is wide enough to also accept legacy per-genre placements.
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  for (const [collectionName, stars] of [
    ['stars', state.stars],
    ['blackholeArchive', state.blackholeArchive],
  ] as const) {
    stars.forEach((star, index) => {
      if (distance(star.position, origin) > STAR_FIELD_MAX_DISTANCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collectionName, index, 'position'],
          message: 'Star position is outside the shared star field bound',
        });
      }
    });
  }

  const activeIds = state.stars.map(({ id }) => id);
  const archivedIds = state.blackholeArchive.map(({ id }) => id);
  addDuplicateIssue(context, activeIds, ['stars'], 'Star IDs');
  addDuplicateIssue(context, archivedIds, ['blackholeArchive'], 'Archived star IDs');
  addDuplicateIssue(context, state.constellations.map(({ id }) => id), ['constellations'], 'Constellation IDs');
  addDuplicateIssue(context, state.galaxies.map(({ id }) => id), ['galaxies'], 'Galaxy IDs');
  addDuplicateIssue(context, state.achievements.map(({ id }) => id), ['achievements'], 'Achievement IDs');
  addDuplicateIssue(
    context,
    state.planetCollection.planets.map(({ id }) => id),
    ['planetCollection', 'planets'],
    'Owned planet IDs',
  );

  const activeIdSet = new Set(activeIds);
  if (archivedIds.some((id) => activeIdSet.has(id))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blackholeArchive'],
      message: 'A work cannot belong to both active and archived collections',
    });
  }

  const archivedIdSet = new Set(archivedIds);
  state.constellations.forEach((constellation, constellationIndex) => {
    if (constellation.starIds.some((id) => archivedIdSet.has(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['constellations', constellationIndex, 'starIds'],
        message: 'Constellations cannot reference archived stars',
      });
    }
  });

  if (state.milestoneUnlocks.fifty.target !== 50) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['milestoneUnlocks', 'fifty', 'target'],
      message: 'fifty milestone target must be 50',
    });
  }
  if (state.milestoneUnlocks.hundred.target !== 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['milestoneUnlocks', 'hundred', 'target'],
      message: 'hundred milestone target must be 100',
    });
  }

  const rewardIds = [
    state.milestoneUnlocks.fifty.rewardId,
    state.milestoneUnlocks.hundred.rewardId,
  ].filter((id): id is string => id !== null);
  addDuplicateIssue(context, rewardIds, ['milestoneUnlocks'], 'Milestone reward IDs');

  const rewardGalaxies = state.galaxies.filter((galaxy) => galaxy.kind.type === 'reward');
  const hundredRewardId = state.milestoneUnlocks.hundred.rewardId;
  if (
    (hundredRewardId === null && rewardGalaxies.length !== 0) ||
    (hundredRewardId !== null &&
      (rewardGalaxies.length !== 1 || rewardGalaxies[0]?.id !== hundredRewardId))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['galaxies'],
      message: 'The milestone-100 reward galaxy must match its unique rewardId',
    });
  }
}

export const persistedStateV2Schema = persistedStateShapeSchema.superRefine(validateDocument);

export class PersistedStateCodecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersistedStateCodecError';
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new PersistedStateCodecError('Persisted document is not valid JSON', { cause: error });
  }
}

function validateAndRoundTrip(value: unknown): PersistedStateV2 {
  const decoded = persistedStateV2Schema.parse(value) as PersistedStateV2;
  let encoded: string;
  try {
    encoded = JSON.stringify(decoded);
  } catch (error) {
    throw new PersistedStateCodecError('Persisted document cannot be encoded', { cause: error });
  }
  const roundTripped = persistedStateV2Schema.parse(parseJson(encoded)) as PersistedStateV2;
  if (!deepEqual(decoded, roundTripped)) {
    throw new PersistedStateCodecError(
      'Canonical encode/decode changed persisted fields or collection order',
    );
  }
  return decoded;
}

/**
 * Backfills the planet-collection field for legacy schema-2 documents saved
 * before the gacha feature existed. Existing works credit the collection with
 * their gacha tickets (one per five stars) so no ticket history is lost. Only a
 * plain object missing the field is touched; everything else falls through to
 * strict validation unchanged.
 */
function backfillLegacyShape(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if ('planetCollection' in record) return value;

  const activeCount = Array.isArray(record.stars) ? record.stars.length : 0;
  const archivedCount = Array.isArray(record.blackholeArchive)
    ? record.blackholeArchive.length
    : 0;
  return {
    ...record,
    planetCollection: {
      lifetimeStarsAdded: activeCount + archivedCount,
      pullsPerformed: 0,
      planets: [],
    },
  };
}

/** Decodes either parsed JSON or a JSON string and rejects the entire document on any violation. */
export function decodePersistedV2(value: unknown): PersistedStateV2 {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  return validateAndRoundTrip(backfillLegacyShape(parsed));
}

/** Validates and canonically serializes a complete schemaVersion 2 document. */
export function encodePersistedV2(value: PersistedStateV2): string {
  return JSON.stringify(validateAndRoundTrip(value));
}

export function safeDecodePersistedV2(value: unknown):
  | { success: true; data: PersistedStateV2 }
  | { success: false; error: unknown } {
  try {
    return { success: true, data: decodePersistedV2(value) };
  } catch (error) {
    return { success: false, error };
  }
}
