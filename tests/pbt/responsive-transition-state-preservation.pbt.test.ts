// @vitest-environment jsdom
// Feature: space-movie-archive, Property 21: 반응형 전환의 상태 보존
// **Validates: Requirements 14.8, 14.9**

import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { createElement, useEffect, useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { ArchiveShell } from '../../src/components/ArchiveShell';
import { createDefaultStore } from '../../src/domain/defaultState';
import {
  GENRES,
  type Genre,
  type QualityLevel,
  type Star,
  type Store,
} from '../../src/domain/models';
import { normalizeText } from '../../src/domain/normalization';
import { PersistenceService } from '../../src/persistence/persistenceService';
import { createArchiveStore, type ArchiveStoreApi } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

const BREAKPOINT_PX = 768;
const STAR_CAPACITY = GENRES.length;

type FailurePoint = 'before-width' | 'after-width' | 'after-resize' | 'after-render';

interface Scenario {
  startOnDesktop: boolean;
  mobileWidth: number;
  desktopWidth: number;
  activeCount: number;
  selectedStarSlot: number;
  selectedGenres: Genre[];
  draftOrder: number[];
  draftPhase: 'selecting' | 'naming';
  drawerOpen: boolean;
  achievementPanelOpen: boolean;
  qualityLevel: QualityLevel;
  failurePoint: FailurePoint;
}

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  startOnDesktop: fc.boolean(),
  mobileWidth: fc.integer({ min: 320, max: BREAKPOINT_PX - 1 }),
  desktopWidth: fc.integer({ min: BREAKPOINT_PX, max: 3_840 }),
  activeCount: fc.integer({ min: 0, max: STAR_CAPACITY }),
  selectedStarSlot: fc.integer({ min: 0, max: STAR_CAPACITY - 1 }),
  selectedGenres: fc.uniqueArray(fc.constantFrom(...GENRES), {
    maxLength: GENRES.length,
  }),
  draftOrder: fc.shuffledSubarray(
    Array.from({ length: STAR_CAPACITY }, (_, index) => index),
  ),
  draftPhase: fc.constantFrom('selecting', 'naming'),
  drawerOpen: fc.boolean(),
  achievementPanelOpen: fc.boolean(),
  qualityLevel: fc.constantFrom<QualityLevel>(
    'full',
    'reducedBackground',
    'minimumParticles',
    'reducedBloom',
  ),
  failurePoint: fc.constantFrom<FailurePoint>(
    'before-width',
    'after-width',
    'after-resize',
    'after-render',
  ),
});

function starId(index: number): string {
  return `21000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`;
}

function createStar(state: Store, index: number): Star {
  const genre = GENRES[index];
  if (genre === undefined) throw new Error(`Missing genre at index ${index}`);
  const galaxy = state.persisted.galaxies.find(
    (candidate) => candidate.kind.type === 'genre' && candidate.kind.genre === genre,
  );
  if (galaxy === undefined) throw new Error(`Missing galaxy for ${genre}`);

  const title = `Responsive Work ${index + 1}`;
  const director = `Responsive Director ${index + 1}`;
  return {
    id: starId(index),
    title,
    normalizedTitle: normalizeText(title),
    genre,
    rating: ((index % 5) + 1) as Star['rating'],
    review: `Viewport state ${index + 1}`,
    watchedDate: `2025-01-${(index + 1).toString().padStart(2, '0')}`,
    director,
    normalizedDirector: normalizeText(director),
    position: { ...galaxy.center },
    createdAt: `2025-01-${(index + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
  };
}

function createScenarioState(scenario: Scenario): Store {
  const state = createDefaultStore(true);
  state.persisted.stars = Array.from({ length: scenario.activeCount }, (_, index) =>
    createStar(state, index),
  );
  state.persisted.constellations = state.persisted.stars.length < 2
    ? []
    : [{
        id: '21000000-0000-4000-8000-000000000100',
        name: 'Responsive Constellation',
        starIds: state.persisted.stars.map(({ id }) => id),
        color: '#abcdef',
        createdAt: '2025-02-01T00:00:00.000Z',
      }];

  const activeIds = state.persisted.stars.map(({ id }) => id);
  state.runtime.selectedStarId = activeIds.length === 0
    ? null
    : activeIds[scenario.selectedStarSlot % activeIds.length] ?? null;
  state.runtime.selectedGenres = new Set(scenario.selectedGenres);
  state.runtime.constellationDraft = {
    active: activeIds.length > 0,
    phase: scenario.draftPhase,
    starIds: scenario.draftOrder
      .filter((index) => index < activeIds.length)
      .map((index) => activeIds[index]!),
    error: null,
  };
  state.runtime.isListDrawerOpen = scenario.drawerOpen;
  state.runtime.isAchievementPanelOpen = scenario.achievementPanelOpen;
  state.runtime.qualityLevel = scenario.qualityLevel;
  return state;
}

function createTestStore(initialState: Store): ArchiveStoreApi {
  return createArchiveStore({
    initialState,
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
    }),
  });
}

function MountedRegion({ onMount }: { onMount(): void }) {
  const stableIdentity = useRef(Symbol('responsive-region'));
  useEffect(onMount, [onMount]);
  return createElement('div', { 'data-region-identity': String(stableIdentity.current) });
}

function shell(onMount: () => void) {
  return createElement(ArchiveShell, {
    canvas: createElement(MountedRegion, { key: 'canvas', onMount }),
    dashboardOverlays: createElement(MountedRegion, { key: 'overlays', onMount }),
    listView: createElement(MountedRegion, { key: 'list', onMount }),
  });
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });
}

function attemptBreakpointTransition(
  fromWidth: number,
  toWidth: number,
  rerender: (ui: ReturnType<typeof shell>) => void,
  onMount: () => void,
  failurePoint?: FailurePoint,
): boolean {
  if ((fromWidth < BREAKPOINT_PX) === (toWidth < BREAKPOINT_PX)) {
    throw new Error('The test transition must actually cross the 768px breakpoint');
  }

  try {
    if (failurePoint === 'before-width') throw new Error('Injected transition failure');
    setViewportWidth(toWidth);
    if (failurePoint === 'after-width') throw new Error('Injected transition failure');
    window.dispatchEvent(new Event('resize'));
    if (failurePoint === 'after-resize') throw new Error('Injected transition failure');
    rerender(shell(onMount));
    if (failurePoint === 'after-render') throw new Error('Injected transition failure');
    return true;
  } catch {
    setViewportWidth(fromWidth);
    window.dispatchEvent(new Event('resize'));
    rerender(shell(onMount));
    return false;
  }
}

function captureState(store: ArchiveStoreApi): Store {
  const { persisted, runtime } = store.getState();
  return structuredClone({ persisted, runtime });
}

describe('Property 21: responsive transition state preservation', () => {
  it('R14.8 R14.9 deeply preserves persisted/runtime selection state across bidirectional breakpoint crossings and blocks every partial commit on injected failure', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const store = createTestStore(createScenarioState(scenario));
        const originalWindowWidth = window.innerWidth;
        const initialWidth = scenario.startOnDesktop
          ? scenario.desktopWidth
          : scenario.mobileWidth;
        const oppositeWidth = scenario.startOnDesktop
          ? scenario.mobileWidth
          : scenario.desktopWidth;
        let mountCount = 0;
        const onMount = () => {
          mountCount += 1;
        };
        let commitCount = 0;
        const unsubscribe = store.subscribe(() => {
          commitCount += 1;
        });

        try {
          setViewportWidth(initialWidth);
          const view = render(shell(onMount));
          const before = captureState(store);
          const stateReferences = {
            persisted: store.getState().persisted,
            runtime: store.getState().runtime,
            selectedGenres: store.getState().runtime.selectedGenres,
            constellationDraft: store.getState().runtime.constellationDraft,
          };

          expect(
            attemptBreakpointTransition(
              initialWidth,
              oppositeWidth,
              view.rerender,
              onMount,
            ),
          ).toBe(true);
          expect(
            attemptBreakpointTransition(
              oppositeWidth,
              initialWidth,
              view.rerender,
              onMount,
            ),
          ).toBe(true);

          expect(
            attemptBreakpointTransition(
              initialWidth,
              oppositeWidth,
              view.rerender,
              onMount,
              scenario.failurePoint,
            ),
          ).toBe(false);
          expect(window.innerWidth).toBe(initialWidth);

          expect(captureState(store)).toEqual(before);
          expect(store.getState().persisted).toBe(stateReferences.persisted);
          expect(store.getState().runtime).toBe(stateReferences.runtime);
          expect(store.getState().runtime.selectedGenres).toBe(
            stateReferences.selectedGenres,
          );
          expect(store.getState().runtime.constellationDraft).toBe(
            stateReferences.constellationDraft,
          );
          expect(commitCount).toBe(0);
          expect(mountCount).toBe(3);
        } finally {
          unsubscribe();
          cleanup();
          store.dispose();
          setViewportWidth(originalWindowWidth);
        }
      }),
      { numRuns: 100 },
    );
  });
});
