import { useCallback, useEffect, useRef, useState } from 'react';

import { AchievementPanel } from './components/AchievementPanel';
import { AddWorkForm } from './components/AddWorkForm';
import { ArchiveDomNavigation } from './components/ArchiveDomNavigation';
import { ArchiveShell } from './components/ArchiveShell';
import { ConstellationControls } from './components/ConstellationControls';
import { GenreFilter } from './components/GenreFilter';
import { HUD } from './components/HUD';
import { ListView } from './components/ListView';
import { ToastRegion } from './components/ToastRegion';
import { WorkCard } from './components/WorkCard';
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">SPACE MOVIE ARCHIVE</p>
        <h1>나만의 밤하늘</h1>
        <p>감상한 작품을 기록하고 우주 속 별로 남겨 보세요.</p>
      </header>
      <ArchiveShell
        canvas={(
          <SpaceCanvas
            onBenchmarkSource={benchmarkEnabled ? setBenchmarkSource : undefined}
            onFpsWindowMeasured={benchmarkEnabled ? recordFpsWindow : undefined}
            sceneContentMounted={sceneContentMounted}
            store={archiveStore}
          />
        )}
        dashboardOverlays={(
          <>
            <HUD store={archiveStore} />
            <GenreFilter store={archiveStore} />
          </>
        )}
        listView={<ListView store={archiveStore} />}
      />
      <ConstellationControls store={archiveStore} />
      <AddWorkForm store={archiveStore} />
      <ArchiveDomNavigation store={archiveStore} />
      <WorkCard store={archiveStore} />
      <AchievementPanel store={archiveStore} />
      <ToastRegion store={archiveStore} />
    </main>
  );
}
