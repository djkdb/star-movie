import type { Constellation, Star } from '../../../src/domain/models';
import { createNebulaConfigs } from '../../../src/scene/backgroundModel';
import {
  buildGalaxyThemeById,
  buildGalaxyThemeSafely,
  GENRE_THEME_IDS,
  getGalaxyTheme,
  type GalaxyTheme,
} from '../../../src/scene/galaxyThemes';
import { createSelectiveBloomViewModel } from '../../../src/scene/selectiveBloom';
import {
  captureGalaxyOffscreenSnapshot,
  measureBloomLeakage,
  VISUAL_REGRESSION_SEED,
  VISUAL_REGRESSION_VIEWPORT,
} from '../../../src/scene/visualRegressionMetrics';

const status = document.querySelector<HTMLElement>('[data-testid="visual-status"]');
const output = document.querySelector<HTMLScriptElement>('#visual-metrics');
if (status === null || output === null) throw new Error('Visual fixture DOM is incomplete');

function createStar(id: string): Star {
  return {
    id,
    title: id,
    normalizedTitle: id,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Visual Fixture',
    normalizedDirector: 'visual fixture',
    position: { x: 0, y: 0, z: 0 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function createConstellation(id: string, starIds: string[]): Constellation {
  return {
    id,
    name: id,
    starIds,
    color: '#ffffff',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function failedTheme(theme: GalaxyTheme): GalaxyTheme {
  return {
    ...theme,
    buildGeometry: () => {
      throw new Error('visual fixture fallback');
    },
  };
}

try {
  const themeIds = Object.values(GENRE_THEME_IDS);
  const nativeGalaxies = themeIds.map((themeId) =>
    captureGalaxyOffscreenSnapshot(
      buildGalaxyThemeById(themeId, { radius: 18, seed: VISUAL_REGRESSION_SEED }),
    ),
  );
  const fallbackGalaxies = themeIds.map((themeId) =>
    captureGalaxyOffscreenSnapshot(
      buildGalaxyThemeSafely(
        failedTheme(getGalaxyTheme(themeId)),
        { radius: 18, seed: VISUAL_REGRESSION_SEED },
      ),
    ),
  );
  const repeatedNativeMaskHashes = themeIds.map((themeId) =>
    captureGalaxyOffscreenSnapshot(
      buildGalaxyThemeById(themeId, { radius: 18, seed: VISUAL_REGRESSION_SEED }),
    ).pixels.maskHash,
  );
  const repeatedFallbackMaskHashes = themeIds.map((themeId) =>
    captureGalaxyOffscreenSnapshot(
      buildGalaxyThemeSafely(
        failedTheme(getGalaxyTheme(themeId)),
        { radius: 18, seed: VISUAL_REGRESSION_SEED },
      ),
    ).pixels.maskHash,
  );

  const stars = [createStar('visual-a'), createStar('visual-b')];
  const constellations = [
    createConstellation('visual-active', ['visual-a', 'visual-b']),
    createConstellation('visual-inactive', ['visual-a', 'missing']),
  ];
  const bloomSelection = createSelectiveBloomViewModel(stars, constellations);
  const eligibleBloomKeys = [
    'star:visual-a',
    'star:visual-b',
    'constellation:visual-active',
  ];
  const sceneObjectKeys = [
    ...eligibleBloomKeys,
    'constellation:visual-inactive',
    ...themeIds.map((themeId) => `galaxy:${themeId}`),
    'background:far',
    'background:near',
    'nebula:0',
    'nebula:1',
    'blackhole',
  ];

  output.textContent = JSON.stringify({
    viewport: VISUAL_REGRESSION_VIEWPORT,
    seed: VISUAL_REGRESSION_SEED,
    nativeGalaxies,
    fallbackGalaxies,
    determinism: {
      nativeMaskHashes: nativeGalaxies.map(({ pixels }) => pixels.maskHash),
      repeatedNativeMaskHashes,
      fallbackMaskHashes: fallbackGalaxies.map(({ pixels }) => pixels.maskHash),
      repeatedFallbackMaskHashes,
    },
    nebulas: createNebulaConfigs(VISUAL_REGRESSION_SEED),
    bloom: {
      enabled: bloomSelection.enabled,
      ...measureBloomLeakage(
        bloomSelection.targetKeys,
        eligibleBloomKeys,
        sceneObjectKeys,
      ),
    },
  });
  status.textContent = 'ready';
} catch (error) {
  status.textContent = `error: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}
