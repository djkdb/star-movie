import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { createDefaultPersistedStore } from '../../src/domain/defaultState';
import { GENRES, type PersistedStateV2, type Star } from '../../src/domain/models';
import { encodePersistedV2 } from '../../src/persistence/persistedStateCodec';
import { PERSISTENCE_STORAGE_KEY } from '../../src/persistence/persistenceService';
import type { QualityLevel } from '../../src/domain/models';
import type { SceneBenchmarkSnapshot } from '../../src/scene/performanceBenchmark';

const DESIGNATED_ENVIRONMENT = process.env.SPACE_MOVIE_PERFORMANCE_ENV === '1';
const QUALITY_ORDER: readonly QualityLevel[] = [
  'full',
  'reducedBackground',
  'minimumParticles',
  'reducedBloom',
];

function benchmarkStar(index: number, state: PersistedStateV2): Star {
  const genre = GENRES[index % GENRES.length]!;
  const galaxy = state.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === genre,
  )!;
  const angle = (index * Math.PI * 2) / 25;
  const radius = 2 + (index % 5);
  const title = `Benchmark Work ${String(index + 1).padStart(3, '0')}`;

  return {
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title,
    normalizedTitle: title.toLocaleLowerCase('und'),
    genre,
    rating: ((index % 5) + 1) as Star['rating'],
    review: '',
    watchedDate: '2025-01-01',
    director: `Benchmark Director ${index % 20}`,
    normalizedDirector: `benchmark director ${index % 20}`,
    position: {
      x: galaxy.center.x + Math.cos(angle) * radius,
      y: galaxy.center.y + ((index % 3) - 1),
      z: galaxy.center.z + Math.sin(angle) * radius,
    },
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
  };
}

function createBenchmarkDocument(): string {
  const state = createDefaultPersistedStore();
  state.stars = Array.from({ length: 200 }, (_, index) => benchmarkStar(index, state));
  return encodePersistedV2(state);
}

async function installBenchmarkFixture(page: Page): Promise<void> {
  const payload = createBenchmarkDocument();
  await page.addInitScript(
    ({ storageKey, persisted }) => {
      localStorage.setItem(storageKey, persisted);

      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeClearTimeout = window.clearTimeout.bind(window);
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      const animationFrames = new Set<number>();
      const timeouts = new Set<number>();
      const intervals = new Set<number>();

      window.requestAnimationFrame = (callback) => {
        let requestId = 0;
        requestId = nativeRequestAnimationFrame((timestamp) => {
          animationFrames.delete(requestId);
          callback(timestamp);
        });
        animationFrames.add(requestId);
        return requestId;
      };
      window.cancelAnimationFrame = (requestId) => {
        animationFrames.delete(requestId);
        nativeCancelAnimationFrame(requestId);
      };
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        let timerId = 0;
        const wrapped = () => {
          timeouts.delete(timerId);
          if (typeof handler === 'function') handler(...args);
        };
        timerId = nativeSetTimeout(wrapped, timeout);
        timeouts.add(timerId);
        return timerId;
      }) as typeof window.setTimeout;
      window.clearTimeout = (timerId) => {
        timeouts.delete(Number(timerId));
        nativeClearTimeout(timerId);
      };
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const wrapped = () => {
          if (typeof handler === 'function') handler(...args);
        };
        const timerId = nativeSetInterval(wrapped, timeout);
        intervals.add(timerId);
        return timerId;
      }) as typeof window.setInterval;
      window.clearInterval = (timerId) => {
        intervals.delete(Number(timerId));
        nativeClearInterval(timerId);
      };
      window.__SPACE_MOVIE_LIFECYCLE__ = {
        snapshot: () => ({
          animationFrames: animationFrames.size,
          timers: timeouts.size + intervals.size,
        }),
      };
    },
    { storageKey: PERSISTENCE_STORAGE_KEY, persisted: payload },
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?benchmark=1');
  await page.waitForFunction(() => window.__SPACE_MOVIE_BENCHMARK__ !== undefined);
}

async function snapshot(page: Page): Promise<SceneBenchmarkSnapshot> {
  return page.evaluate(() => {
    const benchmark = window.__SPACE_MOVIE_BENCHMARK__;
    if (benchmark === undefined) throw new Error('Benchmark instrumentation is unavailable.');
    return benchmark.snapshot();
  });
}

async function attachReport(testInfo: TestInfo, report: unknown): Promise<void> {
  await testInfo.attach('scene-benchmark.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
}

test.beforeEach(async ({ page }) => {
  await installBenchmarkFixture(page);
});

test('R11.5 R11.10 R13.6-R13.8 scene unmount returns WebGL resources, RAF, and timers to baseline', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.waitForTimeout(250);
  const baseline = await snapshot(page);

  const softwareWebGl = /SwiftShader/i.test(baseline.renderer);
  if (softwareWebGl) {
    testInfo.annotations.push({
      type: 'environment-limit',
      description: 'SwiftShader retains renderer-internal WebGL caches; live scene resources and the application registry are verified instead.',
    });
  }

  await page.evaluate(() => window.__SPACE_MOVIE_BENCHMARK__!.mountScene());
  await page.waitForFunction((baselineResources) => {
    const current = window.__SPACE_MOVIE_BENCHMARK__?.snapshot();
    return current !== undefined
      && current.contentMounted
      && current.activeWorks === 200
      && current.resources.geometries > baselineResources.geometries
      && current.resources.rendererGeometries > baselineResources.rendererGeometries;
  }, baseline.resources);
  const mounted = await snapshot(page);

  expect(mounted.orbitControlsActive).toBe(true);
  expect(mounted.resources.materials).toBeGreaterThan(baseline.resources.materials);
  expect(mounted.resources.textures).toBeGreaterThan(baseline.resources.textures);
  expect(mounted.resources.registry.references).toBeGreaterThan(baseline.resources.registry.references);
  expect(mounted.lifecycle?.animationFrames).toBeGreaterThan(baseline.lifecycle?.animationFrames ?? 0);
  expect(mounted.lifecycle?.timers).toBeGreaterThan(baseline.lifecycle?.timers ?? 0);

  await page.evaluate(() => window.__SPACE_MOVIE_BENCHMARK__!.unmountScene());
  try {
    await page.waitForFunction((expected) => {
    const current = window.__SPACE_MOVIE_BENCHMARK__?.snapshot();
    if (current === undefined || current.contentMounted || current.lifecycle === null) return false;
    return current.resources.geometries === expected.baseline.resources.geometries
      && current.resources.materials === expected.baseline.resources.materials
      && current.resources.textures === expected.baseline.resources.textures
      && (!expected.requireRendererBaseline
        || (current.resources.rendererGeometries === expected.baseline.resources.rendererGeometries
          && current.resources.rendererTextures === expected.baseline.resources.rendererTextures))
      && current.resources.registry.geometries === expected.baseline.resources.registry.geometries
      && current.resources.registry.materials === expected.baseline.resources.registry.materials
      && current.resources.registry.textures === expected.baseline.resources.registry.textures
      && current.resources.registry.references === expected.baseline.resources.registry.references
      && current.lifecycle.animationFrames === expected.baseline.lifecycle?.animationFrames
      && current.lifecycle.timers === expected.baseline.lifecycle?.timers;
    }, { baseline, requireRendererBaseline: !softwareWebGl }, { timeout: 10_000 });
  } catch (error) {
    const current = await snapshot(page);
    await attachReport(testInfo, { baseline, mounted, current });
    throw new Error(`Scene resources did not return to baseline. Page errors: ${JSON.stringify(pageErrors)}. Current snapshot: ${JSON.stringify(current)}`, { cause: error });
  }

  const unmounted = await snapshot(page);
  await attachReport(testInfo, { baseline, mounted, unmounted, softwareWebGl });
  expect(unmounted.resources.geometries).toBe(baseline.resources.geometries);
  expect(unmounted.resources.materials).toBe(baseline.resources.materials);
  expect(unmounted.resources.textures).toBe(baseline.resources.textures);
  expect(unmounted.resources.registry).toEqual(baseline.resources.registry);
  if (!softwareWebGl) {
    expect(unmounted.resources.rendererGeometries).toBe(baseline.resources.rendererGeometries);
    expect(unmounted.resources.rendererTextures).toBe(baseline.resources.rendererTextures);
  }
  expect(unmounted.lifecycle).toEqual(baseline.lifecycle);
});

test('R13.2-R13.5 designated environment records 5-second FPS and every required degradation window', async ({ page }, testInfo) => {
  test.skip(
    !DESIGNATED_ENVIRONMENT,
    'Set SPACE_MOVIE_PERFORMANCE_ENV=1 only on the Intel Iris Xe, 4-core, 8GB, 1920x1080, DPR 1 benchmark worker.',
  );
  test.setTimeout(40_000);

  const environment = await page.evaluate(() => ({
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }));
  const initial = await snapshot(page);
  expect(environment.viewport).toEqual({ width: 1920, height: 1080 });
  expect(environment.devicePixelRatio).toBe(1);
  expect(environment.hardwareConcurrency).toBe(4);
  expect(environment.deviceMemory).toBe(8);
  expect(initial.renderer).toMatch(/Iris.*Xe/i);

  await page.evaluate(() => {
    const benchmark = window.__SPACE_MOVIE_BENCHMARK__!;
    benchmark.clearFpsWindows();
    benchmark.mountScene();
  });
  await page.waitForFunction(() => {
    const windows = window.__SPACE_MOVIE_BENCHMARK__?.snapshot().fpsWindows ?? [];
    if (windows.length === 0) return false;
    const last = windows.at(-1)!;
    return last.averageFps >= 30 || last.qualityLevel === 'reducedBloom';
  }, undefined, { timeout: 25_000 });

  const result = await snapshot(page);
  await page.evaluate(() => window.__SPACE_MOVIE_BENCHMARK__!.unmountScene());
  await attachReport(testInfo, { environment, result });

  expect(result.activeWorks).toBe(200);
  expect(result.orbitControlsActive).toBe(true);
  for (const [index, window] of result.fpsWindows.entries()) {
    expect(window.durationMs).toBeGreaterThanOrEqual(5_000);
    if (window.averageFps < 30 && window.qualityLevel !== 'reducedBloom') {
      const qualityIndex = QUALITY_ORDER.indexOf(window.qualityLevel);
      expect(window.degradedTo).toBe(QUALITY_ORDER[qualityIndex + 1]);
      const nextWindow = result.fpsWindows[index + 1];
      expect(nextWindow?.qualityLevel).toBe(window.degradedTo);
    } else {
      expect(window.degradedTo).toBeNull();
    }
  }
  expect(result.fpsWindows[0]?.averageFps).toBeGreaterThanOrEqual(30);
});
