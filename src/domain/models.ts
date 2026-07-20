export const GENRES = [
  'SF',
  '로맨스',
  '스릴러',
  '드라마',
  '애니',
  '코미디',
  '액션',
  '기타',
] as const;

export type Genre = (typeof GENRES)[number];
export type Rating = 1 | 2 | 3 | 4 | 5;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export interface Star {
  id: string;
  title: string;
  normalizedTitle: string;
  genre: Genre;
  rating: Rating;
  review: string;
  watchedDate: string;
  director: string;
  normalizedDirector: string;
  position: Vec3;
  createdAt: string;
  /** TMDB poster path (e.g. "/abc.jpg") when picked from autocomplete. */
  posterPath?: string;
  /** TMDB movie id backing a picked work, for future metadata enrichment. */
  tmdbId?: number;
}

export interface Constellation {
  id: string;
  name: string;
  starIds: string[];
  color: string;
  createdAt: string;
}

export interface ArchivedStar extends Star {
  discardedAt: string;
}

export type GalaxyKind =
  | { type: 'genre'; genre: Genre }
  | { type: 'reward'; rewardType: 'milestone-100' };

export type GenreGalaxyThemeId =
  | 'blue-spiral'
  | 'pink-core-nebula'
  | 'red-asymmetric-bands'
  | 'gold-elliptical'
  | 'purple-prism'
  | 'yellow-rings'
  | 'orange-burst'
  | 'teal-irregular-clusters';

export type GalaxyThemeId = GenreGalaxyThemeId | 'milestone-100-reward';

export interface Galaxy {
  id: string;
  kind: GalaxyKind;
  center: Vec3;
  placementRadius: number;
  themeId: GalaxyThemeId;
  primaryColor: string;
  unlocked: boolean;
}

export interface Milestone {
  target: 50 | 100;
  unlocked: boolean;
  unlockedAt: string | null;
  rewardId: string | null;
}

export type AchievementRuleId = 'nolan-unique-work';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  ruleId: AchievementRuleId;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export type PlanetRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** One pulled planet instance. Duplicates of a species are allowed. */
export interface OwnedPlanet {
  id: string;
  /** References a species in the planet catalog. */
  speciesId: string;
  acquiredAt: string;
  /** Seeds the deterministic 3D orbit so every copy drifts on its own path. */
  orbitSeed: number;
}

/**
 * Gacha collection state. Tickets are derived, not stored: one ticket is earned
 * per five stars ever added, and `pullsPerformed` counts tickets already spent.
 */
export interface PlanetCollection {
  /** Monotonic count of stars ever added; never decreases on delete. */
  lifetimeStarsAdded: number;
  /** Number of gacha pulls performed (tickets spent). */
  pullsPerformed: number;
  planets: OwnedPlanet[];
}

export interface PersistedStore {
  schemaVersion: 2;
  stars: Star[];
  constellations: Constellation[];
  blackholeArchive: ArchivedStar[];
  galaxies: Galaxy[];
  milestoneUnlocks: {
    fifty: Milestone;
    hundred: Milestone;
  };
  achievements: Achievement[];
  planetCollection: PlanetCollection;
}

export type PersistedStateV2 = PersistedStore;
export type QualityLevel =
  | 'full'
  | 'reducedBackground'
  | 'minimumParticles'
  | 'reducedBloom';

export interface ConstellationDraft {
  active: boolean;
  phase: 'selecting' | 'naming';
  starIds: string[];
  error: string | null;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export type CameraRequest =
  | { type: 'star'; starId: string }
  | { type: 'constellation'; constellationId: string }
  | { type: 'free'; pose: CameraPose };

export interface RuntimeEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface StorageDiagnostics {
  lastAutosaveError: string | null;
  lastAutosaveErrorAt: string | null;
}

export interface CommandDiagnostics {
  operation: string | null;
  code: string | null;
  message: string | null;
  occurredAt: string | null;
}

export interface RuntimeStore {
  /** False only for a session bootstrapped without a persisted registration. */
  hasPersistedRegistration: boolean;
  selectedStarId: string | null;
  selectedGenres: Set<Genre>;
  constellationDraft: ConstellationDraft;
  isListDrawerOpen: boolean;
  isAchievementPanelOpen: boolean;
  isPlanetCodexOpen: boolean;
  qualityLevel: QualityLevel;
  pendingCameraRequest: CameraRequest | null;
  /** Camera pose captured just before a star focus, restored on deselection. */
  preFocusPose: CameraPose | null;
  completionEvents: RuntimeEvent[];
  toastEvents: RuntimeEvent[];
  storageDiagnostics: StorageDiagnostics;
  commandDiagnostics: CommandDiagnostics;
}

export interface Store {
  persisted: PersistedStore;
  runtime: RuntimeStore;
}

export type ArchiveStore = Store;
