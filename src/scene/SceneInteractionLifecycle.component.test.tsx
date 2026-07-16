import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchiveDomNavigation } from '../components/ArchiveDomNavigation';
import { WorkCard } from '../components/WorkCard';
import type { Rating, RuntimeEvent, Star } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import {
  FakeClock,
  FakeLocalStorageAdapter,
  IncrementingUuidProvider,
} from '../test/providers';
import {
  createBackgroundStars,
  twinkleMultiplier,
} from './backgroundModel';
import {
  CAMERA_FOCUS_DURATION_SECONDS,
  CameraTweenController,
  calculateStarFocusPose,
  resolveCameraFocusRequest,
  type CameraPose,
} from './cameraMath';
import {
  CONSTELLATION_HOVER_OPACITY,
  CONSTELLATION_IDLE_OPACITY,
  CONSTELLATION_NAME_FADE_SECONDS,
} from './constellationRendererModel';
import {
  EffectLifecycleRegistry,
  ParticleEffectController,
} from './particleManagerModel';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import {
  createSelectiveBloomViewModel,
  SelectiveBloomPass,
} from './selectiveBloom';
import {
  createInstancedStarBuckets,
  getStarInstancePhase,
  getStarRenderMode,
  resolveStarIdFromInstance,
  sampleStarInstanceTransform,
} from './starRendererModel';
import {
  sampleStarRenderTransform,
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_LABEL_FADE_SECONDS,
} from './starVisualModel';
import { ThreeResourceRegistry } from './threeResourceRegistry';
import { VisibleElapsedClock } from './VisibilityClock';

const NOW = '2025-07-01T00:00:00.000Z';

function createStar(id: string, rating: Rating = 3): Star {
  return {
    id,
    title: `Work ${id}`,
    normalizedTitle: `work ${id}`,
    genre: 'SF',
    rating,
    review: '',
    watchedDate: '2025-06-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 2, y: 7, z: -3 },
    createdAt: '2025-06-01T00:00:00.000Z',
  };
}

function createStoreHarness(): ArchiveStoreApi {
  const uuid = new IncrementingUuidProvider();
  return createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
      nowIso: () => NOW,
    }),
    providers: {
      nextUuid: () => uuid.next(),
      nowIso: () => NOW,
    },
  });
}

function addWork(store: ArchiveStoreApi, title: string): string {
  const result = store.getState().commands.addWork({
    title,
    genre: 'SF',
    rating: 4,
    review: `${title} review`,
    watchedDate: '2025-06-01',
    director: 'Director',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.starId;
}

function workAddedEvent(star: Star): RuntimeEvent {
  return {
    id: `work-added:${star.id}`,
    type: 'work-added',
    occurredAt: NOW,
    payload: {
      starId: star.id,
      position: star.position,
      rating: star.rating,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Scene interaction and resource lifecycle integration', () => {
  it('R1.5-R1.7 R3.2-R3.5 preserves shared background and Star phases while hidden, then resumes from that phase', () => {
    const clock = new VisibleElapsedClock(0, true);
    const background = createBackgroundStars({
      kind: 'near',
      parallaxFactor: 1.5,
      seed: 17,
      starCount: 1,
    })[0]!;
    const star = createStar('visible-clock-star', 4);
    const instancePhase = getStarInstancePhase(star.id);

    const visibleSeconds = clock.sample(1_200);
    const beforeHidden = {
      twinkle: twinkleMultiplier(
        visibleSeconds,
        background.twinklePeriodSeconds,
        background.twinklePhaseRadians,
      ),
      individual: sampleStarRenderTransform(star, visibleSeconds, instancePhase, false, false),
      instanced: sampleStarInstanceTransform(
        star,
        visibleSeconds,
        instancePhase,
        false,
        false,
      ),
    };

    clock.setVisibility(false, 1_200);
    const hiddenSeconds = clock.sample(9_200);
    const whileHidden = {
      twinkle: twinkleMultiplier(
        hiddenSeconds,
        background.twinklePeriodSeconds,
        background.twinklePhaseRadians,
      ),
      individual: sampleStarRenderTransform(star, hiddenSeconds, instancePhase, false, false),
      instanced: sampleStarInstanceTransform(
        star,
        hiddenSeconds,
        instancePhase,
        false,
        false,
      ),
    };

    expect(hiddenSeconds).toBe(visibleSeconds);
    expect(whileHidden).toEqual(beforeHidden);

    clock.setVisibility(true, 9_200);
    const resumedSeconds = clock.sample(9_900);
    expect(resumedSeconds).toBeCloseTo(1.9);
    expect(sampleStarRenderTransform(star, resumedSeconds, instancePhase, false, false))
      .not.toEqual(beforeHidden.individual);
    expect(
      sampleStarInstanceTransform(star, resumedSeconds, instancePhase, false, false).position.y,
    ).not.toBe(beforeHidden.instanced.position.y);
  });

  it('R3.6-R3.10 R4.1 R10.2-R10.5 completes hover labels at 0.3s while camera focus continues to exactly 0.7s', () => {
    const from: CameraPose = {
      position: { x: 0, y: 0, z: 20 },
      target: { x: 0, y: 0, z: 0 },
    };
    const destination = calculateStarFocusPose(from, { x: 4, y: 2, z: -1 });
    const camera = new CameraTweenController();
    camera.replace(from, destination);

    expect(STAR_IDLE_SCALE).toBe(1);
    expect(STAR_HOVER_SCALE).toBe(1.5);
    expect(STAR_LABEL_FADE_SECONDS).toBe(0.3);
    expect(CONSTELLATION_IDLE_OPACITY).toBe(0.5);
    expect(CONSTELLATION_HOVER_OPACITY).toBe(1);
    expect(CONSTELLATION_NAME_FADE_SECONDS).toBe(0.3);
    expect(CAMERA_FOCUS_DURATION_SECONDS).toBe(0.7);

    const afterHoverFade = camera.advance(STAR_LABEL_FADE_SECONDS);
    expect(afterHoverFade).toMatchObject({ completed: false });
    expect(camera.isActive).toBe(true);

    const justBeforeCameraCompletion = camera.advance(0.399);
    expect(justBeforeCameraCompletion).toMatchObject({ completed: false });
    expect(camera.advance(0.001)).toEqual({
      pose: destination,
      completed: true,
    });
    expect(camera.isActive).toBe(false);
  });

  it('R3.2-R3.10 R4.1 R13.1 keeps selection, hover raycast identity, and camera targeting stable across 50↔51', () => {
    const stars = Array.from({ length: 51 }, (_, index) =>
      createStar(`transition-${index}`, ((index % 5) + 1) as Rating),
    );
    const selectedStarId = 'transition-17';
    const cameraRequest = { type: 'star' as const, starId: selectedStarId };
    const fiftyStars = stars.slice(0, 50);

    expect(getStarRenderMode(fiftyStars.length)).toBe('individual');
    expect(resolveCameraFocusRequest(cameraRequest, fiftyStars, [])).toMatchObject({
      ok: true,
      request: { type: 'star', starId: selectedStarId },
    });

    const buckets = createInstancedStarBuckets(stars);
    const selectedBucket = buckets.find(({ instanceIdToStarId }) =>
      instanceIdToStarId.includes(selectedStarId),
    )!;
    const selectedInstanceId = selectedBucket.instanceIdToStarId.indexOf(selectedStarId);

    expect(getStarRenderMode(stars.length)).toBe('instanced');
    expect(resolveStarIdFromInstance(
      selectedBucket.instanceIdToStarId,
      selectedInstanceId,
    )).toBe(selectedStarId);
    expect(sampleStarInstanceTransform(
      selectedBucket.stars[selectedInstanceId]!,
      0.3,
      selectedBucket.phases[selectedInstanceId]!,
      true,
      false,
    ).scale).toBe(STAR_HOVER_SCALE);
    expect(resolveCameraFocusRequest(cameraRequest, stars, [])).toMatchObject({
      ok: true,
      request: { type: 'star', starId: selectedStarId },
    });

    expect(getStarRenderMode(fiftyStars.length)).toBe('individual');
    expect(resolveCameraFocusRequest(cameraRequest, fiftyStars, [])).toMatchObject({
      ok: true,
      request: { type: 'star', starId: selectedStarId },
    });
  });

  it('R11.5 R11.10 R13.6-R13.9 retries particle cleanup and removes the Bloom pass after final shared resources are released', () => {
    const clock = new FakeClock();
    const diagnostics = vi.fn();
    const effectRegistry = new EffectLifecycleRegistry(clock, diagnostics);
    const effects = new ParticleEffectController(clock, effectRegistry, () => 0);
    const star = createStar('lifecycle-star', 4);
    const [effect] = effects.startEvent(workAddedEvent(star));
    const cancelAnimation = vi.fn();
    const retryingResource = {
      dispose: vi.fn()
        .mockImplementationOnce(() => { throw new Error('transient disposal failure'); })
        .mockImplementationOnce(() => undefined),
    };
    const quarantinedResource = {
      dispose: vi.fn(() => { throw new Error('persistent disposal failure'); }),
    };

    effects.addResource(effect!.id, 'geometry', retryingResource);
    effects.addResource(effect!.id, 'material', quarantinedResource);
    effects.addAnimation(effect!.id, cancelAnimation);
    expect(createSelectiveBloomViewModel([star], []).enabled).toBe(true);

    const sharedRegistry = new ThreeResourceRegistry();
    const geometry = new BufferGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    const releaseFirst = sharedRegistry.trackObject(new Mesh(geometry, material));
    const releaseSecond = sharedRegistry.trackObject(new Mesh(geometry, material));

    releaseFirst();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();

    clock.advanceBy(effect!.durationSeconds * 1_000);
    expect(effects.getActiveEffects()).toEqual([]);
    expect(retryingResource.dispose).toHaveBeenCalledTimes(2);
    expect(quarantinedResource.dispose).toHaveBeenCalledTimes(2);
    expect(cancelAnimation).toHaveBeenCalledOnce();
    expect(effectRegistry.isQuarantined(quarantinedResource)).toBe(true);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      effectId: effect!.id,
      attempts: 2,
      message: 'persistent disposal failure',
    }));

    releaseSecond();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();

    const bloomAfterRemoval = createSelectiveBloomViewModel([], []);
    expect(bloomAfterRemoval).toEqual({ enabled: false, targetKeys: [] });
    expect(SelectiveBloomPass({ enabled: bloomAfterRemoval.enabled })).toBeNull();
  });

  it('R4.1 R10.8 R13.6 keeps DOM read, soft-delete, restore, and hard-delete paths operational after a Canvas boundary failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStoreHarness();
    const targetId = addWork(store, 'Boundary Target');
    addWork(store, 'Boundary Companion');
    const user = userEvent.setup();

    function BrokenCanvas(): never {
      throw new Error('Injected WebGL failure');
    }

    render(
      <>
        <SceneErrorBoundary navigationTargetId="archive-dom-navigation">
          <BrokenCanvas />
        </SceneErrorBoundary>
        <ArchiveDomNavigation store={store} />
        <WorkCard store={store} />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('3D 우주를 표시할 수 없습니다');
    expect(screen.getByRole('link', { name: 'DOM 작품 탐색으로 이동' }))
      .toHaveAttribute('href', '#archive-dom-navigation');
    expect(screen.getByText('Boundary Target')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {
      name: 'Boundary Target 상세 및 관리',
    }));
    expect(store.getState().runtime.pendingCameraRequest).toEqual({
      type: 'star',
      starId: targetId,
    });
    expect(screen.getByRole('complementary', { name: 'Boundary Target' }))
      .toBeInTheDocument();
    expect(screen.getByText('Boundary Target review')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '블랙홀로 이동' }));
    await user.click(screen.getByRole('button', { name: '블랙홀 이동 실행' }));
    expect(store.getState().persisted.stars.some(({ id }) => id === targetId)).toBe(false);
    expect(store.getState().persisted.blackholeArchive.some(({ id }) => id === targetId))
      .toBe(true);
    expect(screen.getByRole('button', { name: 'Boundary Target 복원' }))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Boundary Target 복원' }));
    expect(store.getState().persisted.stars.some(({ id }) => id === targetId)).toBe(true);
    expect(store.getState().persisted.blackholeArchive.some(({ id }) => id === targetId))
      .toBe(false);

    await user.click(screen.getByRole('button', {
      name: 'Boundary Target 상세 및 관리',
    }));
    await user.click(screen.getByRole('button', { name: '작품 영구 삭제' }));
    await user.click(screen.getByRole('button', { name: '영구 삭제 실행' }));

    expect(store.getState().persisted.stars.some(({ id }) => id === targetId)).toBe(false);
    expect(store.getState().persisted.blackholeArchive.some(({ id }) => id === targetId))
      .toBe(false);
    expect(screen.queryByRole('button', {
      name: 'Boundary Target 상세 및 관리',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
