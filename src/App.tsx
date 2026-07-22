import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { AchievementPanel } from './components/AchievementPanel';
import { CursorSpotlight } from './components/CursorSpotlight';
import { SceneFocusVeil } from './components/SceneFocusVeil';
import { AddWorkForm } from './components/AddWorkForm';
import { ArchiveDomNavigation } from './components/ArchiveDomNavigation';
import { ArchiveShell, type ShellPanelDefinition } from './components/ArchiveShell';
import { ConstellationControls } from './components/ConstellationControls';
import { GenreFilter } from './components/GenreFilter';
import { GestureGuide } from './components/GestureGuide';
import { HUD } from './components/HUD';
import { SkyUtilities } from './components/SkyUtilities';
import { ListView } from './components/ListView';
import { PlanetCodexPanel } from './components/PlanetCodexPanel';
import { WatchlistPanel } from './components/WatchlistPanel';
import { TmdbAttribution } from './components/TmdbAttribution';
import { ToastRegion } from './components/ToastRegion';
import { WorkCard } from './components/WorkCard';
import { selectMonthAgoMemories, todayLocalDate } from './domain/memoryLane';
import {
  getBootstrappedPersistedState,
  getBootstrappedPersistenceService,
} from './persistence/bootstrapPersistedState';
import { createBrowserPersistenceService } from './persistence/persistenceService';
import { SpaceCanvas } from './scene/SpaceCanvas';
import type {
  FpsWindowMeasurement,
  SceneBenchmarkSource,
  SpaceMovieBenchmarkApi,
} from './scene/performanceBenchmark';
import {
  createArchiveStoreFromLoadResult,
  type ArchiveStoreApi,
} from './store/archiveStore';
import './styles.css';

function DockGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="20"
    >
      {children}
    </svg>
  );
}

const DOCK_ICONS = {
  watchlist: (
    <DockGlyph>
      <circle cx="12" cy="12" r="6.5" strokeDasharray="2.6 2.2" />
      <circle cx="12" cy="12" fill="currentColor" r="1.6" stroke="none" opacity="0.75" />
    </DockGlyph>
  ),
  overview: (
    <DockGlyph>
      <path d="M3 20 L8 11 L12 15 L17 6 L21 12" />
      <circle cx="17" cy="6" fill="currentColor" r="1.2" stroke="none" />
    </DockGlyph>
  ),
  list: (
    <DockGlyph>
      <path d="M9 6 H20 M9 12 H20 M9 18 H20" />
      <circle cx="4.5" cy="6" fill="currentColor" r="1.1" stroke="none" />
      <circle cx="4.5" cy="12" fill="currentColor" r="1.1" stroke="none" />
      <circle cx="4.5" cy="18" fill="currentColor" r="1.1" stroke="none" />
    </DockGlyph>
  ),
  add: (
    <DockGlyph>
      <path d="M12 5 V19 M5 12 H19" />
    </DockGlyph>
  ),
  constellation: (
    <DockGlyph>
      <path d="M5 17 L10.5 12.5 L15 14.5 L19 6" opacity="0.7" />
      <circle cx="5" cy="17" fill="currentColor" r="1.4" stroke="none" />
      <circle cx="10.5" cy="12.5" fill="currentColor" r="1.4" stroke="none" />
      <circle cx="15" cy="14.5" fill="currentColor" r="1.4" stroke="none" />
      <circle cx="19" cy="6" fill="currentColor" r="1.4" stroke="none" />
    </DockGlyph>
  ),
  navigation: (
    <DockGlyph>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z" />
    </DockGlyph>
  ),
  codex: (
    <DockGlyph>
      <circle cx="12" cy="12" r="5.5" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.4" transform="rotate(-24 12 12)" />
    </DockGlyph>
  ),
} as const;

let browserStore: ArchiveStoreApi | null = null;

function getBrowserStore(): ArchiveStoreApi {
  if (browserStore !== null) return browserStore;

  const persistence =
    getBootstrappedPersistenceService() ?? createBrowserPersistenceService();
  const loadResult = getBootstrappedPersistedState() ?? persistence.load();
  browserStore = createArchiveStoreFromLoadResult(loadResult, persistence);
  return browserStore;
}

export interface AppProps {
  store?: ArchiveStoreApi;
}

export function App({ store }: AppProps) {
  const archiveStore = store ?? getBrowserStore();
  const requestedPanelId = useStore(archiveStore, (state) => state.runtime.requestedPanelId);
  const [appReady, setAppReady] = useState(false);

  // The 3D scene reporting its first real frame is the cue to retire the boot
  // overlay (declared in index.html so it paints before any bundle) and let the
  // chrome — brand, dock, utilities, guide — stagger into place.
  const handleSceneReady = useCallback(() => {
    setAppReady(true);
    const loader = typeof document === 'undefined' ? null : document.getElementById('boot-loader');
    if (loader === null) return;
    loader.classList.add('is-done');
    const remove = () => loader.remove();
    loader.addEventListener('transitionend', remove, { once: true });
    // Fallback in case the transition never fires (reduced motion / hidden tab).
    window.setTimeout(remove, 900);
  }, []);

  // One gentle note per day: works watched exactly a month ago resurface as a
  // soft memory toast instead of a demanding streak.
  useEffect(() => {
    const state = archiveStore.getState();
    if (!state.runtime.hasPersistedRegistration) return;
    const now = new Date();
    const today = todayLocalDate(now);
    const memoryKey = 'space-movie-archive:memory-note-shown';
    try {
      if (window.localStorage.getItem(memoryKey) === today) return;
    } catch {
      return;
    }
    const memories = selectMonthAgoMemories(state.persisted.stars, now);
    if (memories.length === 0) return;
    const first = memories[0]!;
    const others = memories.length - 1;
    archiveStore.getState().commands.pushGentleToast(
      '한 달 전 오늘',
      others > 0
        ? `『${first.title}』 외 ${others}편을 본 지 한 달이 됐어요. 별은 여전히 빛나고 있어요.`
        : `『${first.title}』을(를) 본 지 한 달이 됐어요. 별은 여전히 빛나고 있어요.`,
    );
    try {
      window.localStorage.setItem(memoryKey, today);
    } catch {
      // Best effort; the note may repeat if storage is unavailable.
    }
  }, [archiveStore]);
  const benchmarkEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('benchmark') === '1';
  const [sceneContentMounted, setSceneContentMounted] = useState(!benchmarkEnabled);
  const [benchmarkSource, setBenchmarkSource] = useState<SceneBenchmarkSource | null>(null);
  const fpsWindows = useRef<FpsWindowMeasurement[]>([]);
  const recordFpsWindow = useCallback((measurement: FpsWindowMeasurement) => {
    fpsWindows.current.push(measurement);
  }, []);

  useEffect(() => {
    if (!benchmarkEnabled || benchmarkSource === null) return;
    const api: SpaceMovieBenchmarkApi = {
      clearFpsWindows: () => {
        fpsWindows.current = [];
      },
      mountScene: () => setSceneContentMounted(true),
      snapshot: () => {
        const state = archiveStore.getState();
        return {
          activeWorks: state.persisted.stars.length,
          contentMounted: sceneContentMounted,
          orbitControlsActive: sceneContentMounted,
          renderer: benchmarkSource.renderer(),
          qualityLevel: state.runtime.qualityLevel,
          fpsWindows: [...fpsWindows.current],
          resources: benchmarkSource.snapshotResources(),
          lifecycle: window.__SPACE_MOVIE_LIFECYCLE__?.snapshot() ?? null,
        };
      },
      unmountScene: () => setSceneContentMounted(false),
    };
    window.__SPACE_MOVIE_BENCHMARK__ = api;
    return () => {
      if (window.__SPACE_MOVIE_BENCHMARK__ === api) {
        delete window.__SPACE_MOVIE_BENCHMARK__;
      }
    };
  }, [archiveStore, benchmarkEnabled, benchmarkSource, sceneContentMounted]);

  const panels: readonly ShellPanelDefinition[] = [
    {
      id: 'overview',
      label: '아카이브 현황',
      icon: DOCK_ICONS.overview,
      content: (
        <>
          <HUD store={archiveStore} />
          <GenreFilter store={archiveStore} />
          <TmdbAttribution variant="block" />
        </>
      ),
    },
    {
      id: 'list',
      label: '작품 목록 패널',
      icon: DOCK_ICONS.list,
      content: <ListView store={archiveStore} />,
    },
    {
      id: 'add',
      label: '작품 추가',
      icon: DOCK_ICONS.add,
      content: <AddWorkForm store={archiveStore} />,
      wide: true,
    },
    {
      id: 'watchlist',
      label: '보고 싶은 작품',
      icon: DOCK_ICONS.watchlist,
      content: <WatchlistPanel store={archiveStore} />,
    },
    {
      id: 'constellation',
      label: '별자리 관리',
      icon: DOCK_ICONS.constellation,
      content: <ConstellationControls store={archiveStore} />,
    },
    {
      id: 'codex',
      label: '행성 도감',
      icon: DOCK_ICONS.codex,
      content: <PlanetCodexPanel store={archiveStore} />,
      wide: true,
    },
    {
      id: 'navigation',
      label: '작품 DOM 탐색 패널',
      icon: DOCK_ICONS.navigation,
      content: <ArchiveDomNavigation store={archiveStore} />,
      wide: true,
    },
  ];

  return (
    <main className="app-shell" data-app-ready={appReady ? 'true' : 'false'}>
      <header className="sky-brand">
        <p className="eyebrow">ASTERON</p>
        {/* Kept for the document outline and tests, but no longer painted on
            the sky — the brand eyebrow alone marks the corner. */}
        <h1 className="visually-hidden">나만의 밤하늘</h1>
      </header>
      <ArchiveShell
        canvas={(
          <SpaceCanvas
            onBenchmarkSource={benchmarkEnabled ? setBenchmarkSource : undefined}
            onFpsWindowMeasured={benchmarkEnabled ? recordFpsWindow : undefined}
            onSceneReady={handleSceneReady}
            sceneContentMounted={sceneContentMounted}
            store={archiveStore}
          />
        )}
        onOpenRequestHandled={() => archiveStore.getState().commands.consumePanelRequest()}
        openRequestId={requestedPanelId}
        panels={panels}
      />
      <SceneFocusVeil />
      <CursorSpotlight />
      <WorkCard store={archiveStore} />
      <GestureGuide store={archiveStore} />
      <SkyUtilities store={archiveStore} />
      <AchievementPanel store={archiveStore} />
      <ToastRegion store={archiveStore} />
    </main>
  );
}
