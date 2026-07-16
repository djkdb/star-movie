import {
  GENRES,
  type Achievement,
  type Galaxy,
  type Genre,
  type Milestone,
  type PersistedStore,
  type RuntimeStore,
  type Store,
  type Vec3,
} from './models';

export const MINIMUM_GALAXY_CENTER_DISTANCE = 25;

interface GenreGalaxyDefault {
  genre: Genre;
  id: string;
  center: Vec3;
  placementRadius: number;
  themeId: Galaxy['themeId'];
  primaryColor: string;
}

const GENRE_GALAXY_DEFAULTS: readonly GenreGalaxyDefault[] = [
  {
    genre: 'SF',
    id: '00000000-0000-4000-8000-000000000101',
    center: { x: -45, y: 0, z: -45 },
    placementRadius: 18,
    themeId: 'blue-spiral',
    primaryColor: '#3B82F6',
  },
  {
    genre: '로맨스',
    id: '00000000-0000-4000-8000-000000000102',
    center: { x: 0, y: 0, z: -45 },
    placementRadius: 18,
    themeId: 'pink-core-nebula',
    primaryColor: '#F472B6',
  },
  {
    genre: '스릴러',
    id: '00000000-0000-4000-8000-000000000103',
    center: { x: 45, y: 0, z: -45 },
    placementRadius: 18,
    themeId: 'red-asymmetric-bands',
    primaryColor: '#DC2626',
  },
  {
    genre: '드라마',
    id: '00000000-0000-4000-8000-000000000104',
    center: { x: -45, y: 0, z: 0 },
    placementRadius: 18,
    themeId: 'gold-elliptical',
    primaryColor: '#F59E0B',
  },
  {
    genre: '애니',
    id: '00000000-0000-4000-8000-000000000105',
    center: { x: 45, y: 0, z: 0 },
    placementRadius: 18,
    themeId: 'purple-prism',
    primaryColor: '#A855F7',
  },
  {
    genre: '코미디',
    id: '00000000-0000-4000-8000-000000000106',
    center: { x: -45, y: 0, z: 45 },
    placementRadius: 18,
    themeId: 'yellow-rings',
    primaryColor: '#FDE047',
  },
  {
    genre: '액션',
    id: '00000000-0000-4000-8000-000000000107',
    center: { x: 0, y: 0, z: 45 },
    placementRadius: 18,
    themeId: 'orange-burst',
    primaryColor: '#F97316',
  },
  {
    genre: '기타',
    id: '00000000-0000-4000-8000-000000000108',
    center: { x: 45, y: 0, z: 45 },
    placementRadius: 18,
    themeId: 'teal-irregular-clusters',
    primaryColor: '#14B8A6',
  },
] as const;

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function assertGalaxyDefaults(): void {
  const genres = new Set(GENRE_GALAXY_DEFAULTS.map(({ genre }) => genre));
  if (genres.size !== GENRES.length || GENRES.some((genre) => !genres.has(genre))) {
    throw new Error('Default galaxies must contain each genre exactly once');
  }

  for (let leftIndex = 0; leftIndex < GENRE_GALAXY_DEFAULTS.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < GENRE_GALAXY_DEFAULTS.length;
      rightIndex += 1
    ) {
      const left = GENRE_GALAXY_DEFAULTS[leftIndex];
      const right = GENRE_GALAXY_DEFAULTS[rightIndex];
      if (
        left === undefined ||
        right === undefined ||
        distance(left.center, right.center) < MINIMUM_GALAXY_CENTER_DISTANCE
      ) {
        throw new Error('Default galaxy centers must be at least 25 units apart');
      }
    }
  }
}

assertGalaxyDefaults();

function createLockedMilestone(target: 50 | 100): Milestone {
  return { target, unlocked: false, unlockedAt: null, rewardId: null };
}

function createNolanMaster(): Achievement {
  return {
    id: 'nolan-master',
    name: '놀란 마스터',
    description: '크리스토퍼 놀란 감독의 고유 작품 10편을 기록하세요.',
    ruleId: 'nolan-unique-work',
    progress: 0,
    target: 10,
    unlocked: false,
    unlockedAt: null,
  };
}

function createGenreGalaxies(): Galaxy[] {
  return GENRE_GALAXY_DEFAULTS.map((galaxy) => ({
    id: galaxy.id,
    kind: { type: 'genre', genre: galaxy.genre },
    center: { ...galaxy.center },
    placementRadius: galaxy.placementRadius,
    themeId: galaxy.themeId,
    primaryColor: galaxy.primaryColor,
    unlocked: true,
  }));
}

export function createDefaultPersistedStore(): PersistedStore {
  return {
    schemaVersion: 2,
    stars: [],
    constellations: [],
    blackholeArchive: [],
    galaxies: createGenreGalaxies(),
    milestoneUnlocks: {
      fifty: createLockedMilestone(50),
      hundred: createLockedMilestone(100),
    },
    achievements: [createNolanMaster()],
  };
}

export function createDefaultRuntimeStore(hasPersistedRegistration = false): RuntimeStore {
  return {
    hasPersistedRegistration,
    selectedStarId: null,
    selectedGenres: new Set<Genre>(),
    constellationDraft: {
      active: false,
      phase: 'selecting',
      starIds: [],
      error: null,
    },
    isListDrawerOpen: false,
    isAchievementPanelOpen: false,
    qualityLevel: 'full',
    pendingCameraRequest: null,
    preFocusPose: null,
    completionEvents: [],
    toastEvents: [],
    storageDiagnostics: { lastAutosaveError: null, lastAutosaveErrorAt: null },
    commandDiagnostics: { operation: null, code: null, message: null, occurredAt: null },
  };
}

export function createDefaultStore(hasPersistedRegistration = false): Store {
  return {
    persisted: createDefaultPersistedStore(),
    runtime: createDefaultRuntimeStore(hasPersistedRegistration),
  };
}

export interface SceneArchiveContent {
  stars: PersistedStore['stars'];
  constellations: PersistedStore['constellations'];
}

/** First-run gate: decorative space and galaxies remain available, user content does not. */
export function selectSceneArchiveContent(store: Store): SceneArchiveContent {
  if (!store.runtime.hasPersistedRegistration) return { stars: [], constellations: [] };
  return {
    stars: store.persisted.stars,
    constellations: store.persisted.constellations,
  };
}
