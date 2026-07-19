import {
  GENRES,
  type Achievement,
  type ArchivedStar,
  type Constellation,
  type Genre,
  type Milestone,
  type Star,
  type Store,
} from '../domain/models';
import { normalizeText } from '../domain/normalization';
import { PLANET_SPECIES, type PlanetSpecies } from '../domain/planetCatalog';
import {
  availableTickets,
  collectionRate,
  ownedCountBySpecies,
  starsUntilNextTicket,
} from '../domain/planetGacha';
import { calculateAchievementProgress } from './progressReconciler';

export type ListSortOption = 'rating' | 'latest';

export interface MilestoneProgressViewModel {
  target: 50 | 100;
  current: number;
  unlocked: boolean;
  unlockedAt: string | null;
  rewardId: string | null;
}

export interface AchievementViewModel {
  id: string;
  name: string;
  description: string;
  ruleId: Achievement['ruleId'];
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface AchievementSummaryViewModel {
  unlockedCount: number;
  totalCount: number;
}

export interface AchievementPanelViewModel {
  isOpen: boolean;
  achievements: AchievementViewModel[];
}

export interface HudViewModel {
  activeWorkCount: number;
  averageRating: number | null;
  averageRatingLabel: string;
  topGenres: Genre[];
  topGenreLabel: string;
  milestones: {
    fifty: MilestoneProgressViewModel;
    hundred: MilestoneProgressViewModel;
  };
  achievementSummary: AchievementSummaryViewModel;
}

export interface ActiveWorkListItemViewModel {
  id: string;
  title: string;
  normalizedTitle: string;
  genre: Genre;
  rating: Star['rating'];
  director: string;
  createdAt: string;
}

export interface ActiveConstellationListItemViewModel {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  activeStarIds: string[];
  activeStarCount: number;
}

export interface ArchivedWorkListItemViewModel {
  id: string;
  title: string;
  review: string;
  director: string;
  discardedAt: string;
}

export interface ListViewSelection {
  sortBy?: ListSortOption;
  searchQuery?: string;
  selectedGenres?: ReadonlySet<Genre>;
}

export interface ListViewModel {
  activeWorks: ActiveWorkListItemViewModel[];
  activeConstellations: ActiveConstellationListItemViewModel[];
  archivedWorks: ArchivedWorkListItemViewModel[];
  activeWorkCount: number;
  activeWorksEmptyMessage: '조건에 맞는 작품이 없습니다' | null;
  archiveEmptyMessage: '보관된 작품이 없습니다' | null;
}

/** Decimal half-away-from-zero rounding, independent of Math.round's negative tie behavior. */
export function roundHalfAwayFromZero(value: number, fractionDigits = 0): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError('fractionDigits must be a non-negative integer');
  }

  const factor = 10 ** fractionDigits;
  const scaledMagnitude = Math.abs(value) * factor;
  const tolerance = Number.EPSILON * Math.max(1, scaledMagnitude);
  const magnitude = Math.floor(scaledMagnitude + 0.5 + tolerance);
  return Math.sign(value) * magnitude / factor;
}

/** Uses integer rating arithmetic so exact x.x5 average boundaries cannot drift in binary. */
export function calculateAverageRating(stars: readonly Star[]): number | null {
  if (stars.length === 0) return null;

  const ratingSum = stars.reduce((sum, star) => sum + star.rating, 0);
  const roundedTenths = Math.floor((ratingSum * 10 + stars.length / 2) / stars.length);
  return roundedTenths / 10;
}

export function calculateTopGenres(stars: readonly Star[]): Genre[] {
  if (stars.length === 0) return [];

  const counts = new Map<Genre, number>(GENRES.map((genre) => [genre, 0]));
  for (const star of stars) {
    counts.set(star.genre, (counts.get(star.genre) ?? 0) + 1);
  }
  const highestCount = Math.max(...counts.values());
  return GENRES.filter((genre) => counts.get(genre) === highestCount);
}

function toMilestoneViewModel(
  milestone: Readonly<Milestone>,
  activeWorkCount: number,
): MilestoneProgressViewModel {
  return {
    target: milestone.target,
    current: Math.min(activeWorkCount, milestone.target),
    unlocked: milestone.unlocked,
    unlockedAt: milestone.unlockedAt,
    rewardId: milestone.rewardId,
  };
}

/** Recalculates current progress while retaining persisted sticky unlock metadata. */
export function selectAchievementViewModels(store: Readonly<Store>): AchievementViewModel[] {
  return store.persisted.achievements.map((achievement) => ({
    id: achievement.id,
    name: achievement.name,
    description: achievement.description,
    ruleId: achievement.ruleId,
    progress: calculateAchievementProgress(achievement, store.persisted.stars),
    target: achievement.target,
    unlocked: achievement.unlocked,
    unlockedAt: achievement.unlockedAt,
  }));
}

export function selectAchievementPanelViewModel(
  store: Readonly<Store>,
): AchievementPanelViewModel {
  return {
    isOpen: store.runtime.isAchievementPanelOpen,
    achievements: selectAchievementViewModels(store),
  };
}

export function selectHudViewModel(store: Readonly<Store>): HudViewModel {
  const { stars, milestoneUnlocks } = store.persisted;
  const averageRating = calculateAverageRating(stars);
  const topGenres = calculateTopGenres(stars);
  const achievements = selectAchievementViewModels(store);

  return {
    activeWorkCount: stars.length,
    averageRating,
    averageRatingLabel: averageRating === null ? '—' : averageRating.toFixed(1),
    topGenres,
    topGenreLabel: topGenres.length === 0 ? '없음' : topGenres.join(', '),
    milestones: {
      fifty: toMilestoneViewModel(milestoneUnlocks.fifty, stars.length),
      hundred: toMilestoneViewModel(milestoneUnlocks.hundred, stars.length),
    },
    achievementSummary: {
      unlockedCount: achievements.filter(({ unlocked }) => unlocked).length,
      totalCount: achievements.length,
    },
  };
}

function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCreatedAtDescending(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime - leftTime;
  }
  return compareAscending(right, left);
}

/** Total ordering required by both ListView sort modes. */
export function compareActiveWorks(
  left: Readonly<Star>,
  right: Readonly<Star>,
  sortBy: ListSortOption,
): number {
  if (sortBy === 'rating' && left.rating !== right.rating) {
    return right.rating - left.rating;
  }

  const createdAtOrder = compareCreatedAtDescending(left.createdAt, right.createdAt);
  if (createdAtOrder !== 0) return createdAtOrder;

  const titleOrder = compareAscending(left.normalizedTitle, right.normalizedTitle);
  if (titleOrder !== 0) return titleOrder;
  return compareAscending(left.id, right.id);
}

export function matchesActiveWorkListPredicate(
  star: Readonly<Star>,
  searchQuery: string,
  selectedGenres: ReadonlySet<Genre>,
): boolean {
  if (selectedGenres.size > 0 && !selectedGenres.has(star.genre)) return false;

  const normalizedQuery = normalizeText(searchQuery);
  return normalizedQuery.length === 0
    || star.normalizedTitle.includes(normalizedQuery)
    || star.normalizedDirector.includes(normalizedQuery);
}

export function selectActiveWorks(
  stars: readonly Star[],
  selection: Required<ListViewSelection>,
): Star[] {
  return stars
    .filter((star) => matchesActiveWorkListPredicate(
      star,
      selection.searchQuery,
      selection.selectedGenres,
    ))
    .sort((left, right) => compareActiveWorks(left, right, selection.sortBy));
}

export function selectActiveConstellations(
  constellations: readonly Constellation[],
  stars: readonly Star[],
): ActiveConstellationListItemViewModel[] {
  const activeStarIds = new Set(stars.map(({ id }) => id));

  return constellations.flatMap((constellation) => {
    const activeReferences = constellation.starIds.filter((starId) => activeStarIds.has(starId));
    if (activeReferences.length < 2) return [];

    return [{
      id: constellation.id,
      name: constellation.name,
      color: constellation.color,
      createdAt: constellation.createdAt,
      activeStarIds: activeReferences,
      activeStarCount: activeReferences.length,
    }];
  });
}

export function selectArchivedWorks(
  archive: readonly ArchivedStar[],
): ArchivedWorkListItemViewModel[] {
  return archive.map(({ id, title, review, director, discardedAt }) => ({
    id,
    title,
    review,
    director,
    discardedAt,
  }));
}

function toActiveWorkListItem(star: Readonly<Star>): ActiveWorkListItemViewModel {
  return {
    id: star.id,
    title: star.title,
    normalizedTitle: star.normalizedTitle,
    genre: star.genre,
    rating: star.rating,
    director: star.director,
    createdAt: star.createdAt,
  };
}

export function selectListViewModel(
  store: Readonly<Store>,
  selection: ListViewSelection = {},
): ListViewModel {
  const resolvedSelection: Required<ListViewSelection> = {
    sortBy: selection.sortBy ?? 'rating',
    searchQuery: selection.searchQuery ?? '',
    selectedGenres: selection.selectedGenres ?? store.runtime.selectedGenres,
  };
  const activeWorks = selectActiveWorks(store.persisted.stars, resolvedSelection)
    .map(toActiveWorkListItem);
  const archivedWorks = selectArchivedWorks(store.persisted.blackholeArchive);

  return {
    activeWorks,
    activeConstellations: selectActiveConstellations(
      store.persisted.constellations,
      store.persisted.stars,
    ),
    archivedWorks,
    activeWorkCount: activeWorks.length,
    activeWorksEmptyMessage: activeWorks.length === 0
      ? '조건에 맞는 작품이 없습니다'
      : null,
    archiveEmptyMessage: archivedWorks.length === 0 ? '보관된 작품이 없습니다' : null,
  };
}

export interface PlanetCodexEntryViewModel {
  species: PlanetSpecies;
  owned: boolean;
  count: number;
}

export interface PlanetCodexViewModel {
  isOpen: boolean;
  tickets: number;
  lifetimeStarsAdded: number;
  starsUntilNextTicket: number;
  collected: number;
  total: number;
  entries: PlanetCodexEntryViewModel[];
}

export function selectPlanetCodexViewModel(
  store: Readonly<Store>,
): PlanetCodexViewModel {
  const collection = store.persisted.planetCollection;
  const counts = ownedCountBySpecies(collection);
  const rate = collectionRate(collection);
  return {
    isOpen: store.runtime.isPlanetCodexOpen,
    tickets: availableTickets(collection),
    lifetimeStarsAdded: collection.lifetimeStarsAdded,
    starsUntilNextTicket: starsUntilNextTicket(collection.lifetimeStarsAdded),
    collected: rate.collected,
    total: rate.total,
    entries: PLANET_SPECIES.map((species) => {
      const count = counts.get(species.id) ?? 0;
      return { species, owned: count > 0, count };
    }),
  };
}
