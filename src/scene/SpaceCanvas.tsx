import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Selection } from '@react-three/postprocessing';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useStore } from 'zustand';
import {
  AdditiveBlending,
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';

import { BlackholeArchive } from '../components/BlackholeArchive';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useModalFocusTrap } from '../components/useModalFocusTrap';
import type {
  ArchivedStar,
  CameraPose,
  CameraRequest,
  Constellation,
  Galaxy,
  PersistedStore,
  QualityLevel,
  Star,
} from '../domain/models';
import { getSceneQualitySettings } from '../domain/qualityLevel';
import type { ArchiveStoreApi } from '../store/archiveStore';
import {
  BACKGROUND_LAYER_DEFINITIONS,
  calculateParallaxOffset,
  createBackgroundStars,
  createMilkyWayPatchConfigs,
  createNebulaConfigs,
  SPACE_BACKGROUND_COLOR,
  SPACE_CAMERA_FOV,
  SPACE_CAMERA_MAX_DISTANCE,
  TWINKLE_AMPLITUDE,
  type BackgroundLayerDefinition,
} from './backgroundModel';
import { CameraRig } from './CameraRig';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { usePrefersReducedMotion, getSceneFrameLoop } from './usePrefersReducedMotion';
import { BlackholeRenderer } from './BlackholeRenderer';
import { ConstellationRenderer } from './ConstellationRenderer';
import { FpsDegradationMonitor } from './FpsDegradationController';
import { MilestoneRewardRenderer, selectMilestoneRewardViewModels, type MilestoneRewardViewModel } from './MilestoneRewardRenderer';
import { ORBIT_TOUCH_GESTURES } from './orbitControlsConfig';
import { ParticleManager } from './ParticleManager';
import {
  collectSceneResources,
  type FpsWindowMeasurement,
  type SceneBenchmarkSource,
} from './performanceBenchmark';
import { SmoothWheelZoom } from './SmoothWheelZoom';
import { sceneResourceRegistry } from './threeResourceRegistry';
import {
  createSelectiveBloomViewModel,
  SelectiveBloomPass,
} from './selectiveBloom';
import { StarRenderer } from './StarRenderer';
import { VisibilityClock, useVisibleElapsedSeconds } from './VisibilityClock';
import type { StarDragPayload } from './starVisualModel';

const BACKGROUND_VERTEX_SHADER = `
  attribute float aPeriod;
  attribute float aPhase;
  attribute float aBaseOpacity;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uParallax;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    float pulse = 1.0 + ${TWINKLE_AMPLITUDE.toFixed(1)} * sin((uTime / aPeriod) * 6.28318530718 + aPhase);
    vOpacity = aBaseOpacity * pulse;
    vColor = aColor;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    viewPosition.xy += uParallax * max(1.0, -viewPosition.z);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const BACKGROUND_FRAGMENT_SHADER = `
  precision highp float;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    float distanceFromCenter = distance(gl_PointCoord, vec2(0.5));
    // Sharp core with a faint halo so bright stars bloom slightly while dim
    // ones stay pinpoint, echoing long-exposure sky photography.
    float core = 1.0 - smoothstep(0.0, 0.3, distanceFromCenter);
    float halo = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
    float alpha = clamp(core * 1.25 + halo * 0.4, 0.0, 1.0);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(vColor, alpha * vOpacity);
  }
`;

export interface SceneArchiveContent {
  stars: readonly Star[];
  constellations: readonly Constellation[];
  archivedWorks: readonly ArchivedStar[];
}

export interface SpaceSceneViewModel {
  galaxies: readonly Galaxy[];
  milestoneRewards: readonly MilestoneRewardViewModel[];
  archiveContent: SceneArchiveContent;
}

export function createSpaceSceneViewModel(
  persisted: PersistedStore,
  hasPersistedRegistration: boolean,
): SpaceSceneViewModel {
  return {
    galaxies: persisted.galaxies,
    milestoneRewards: selectMilestoneRewardViewModels(persisted),
    archiveContent: hasPersistedRegistration
      ? {
          stars: persisted.stars,
          constellations: persisted.constellations,
          archivedWorks: persisted.blackholeArchive,
        }
      : { stars: [], constellations: [], archivedWorks: [] },
  };
}

function createBackgroundGeometry(
  definition: BackgroundLayerDefinition,
): BufferGeometry {
  const stars = createBackgroundStars(definition);
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const periods = new Float32Array(stars.length);
  const phases = new Float32Array(stars.length);
  const opacities = new Float32Array(stars.length);
  const sizes = new Float32Array(stars.length);

  stars.forEach((star, index) => {
    positions.set(star.position, index * 3);
    colors.set(star.color, index * 3);
    periods[index] = star.twinklePeriodSeconds;
    phases[index] = star.twinklePhaseRadians;
    opacities[index] = star.baseOpacity;
    sizes[index] = star.size;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aPeriod', new Float32BufferAttribute(periods, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aBaseOpacity', new Float32BufferAttribute(opacities, 1));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  return geometry;
}

function createBackgroundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: false,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uParallax: { value: new Vector2() },
    },
    vertexShader: BACKGROUND_VERTEX_SHADER,
    fragmentShader: BACKGROUND_FRAGMENT_SHADER,
  });
}

function BackgroundLayer({ definition }: { definition: BackgroundLayerDefinition }) {
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const camera = useThree((state) => state.camera);
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const geometry = useMemo(() => createBackgroundGeometry(definition), [definition]);
  const material = useMemo(createBackgroundMaterial, []);
  const cameraDirection = useRef(new Vector3());

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(() => {
    camera.getWorldDirection(cameraDirection.current);
    const offset = calculateParallaxOffset(
      cameraDirection.current,
      definition.parallaxFactor,
    );
    material.uniforms.uTime!.value = elapsedVisibleSeconds.current;
    material.uniforms.uPixelRatio!.value = pixelRatio;
    (material.uniforms.uParallax!.value as Vector2).set(offset[0], offset[1]);
  });

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      name={`background-${definition.kind}`}
    />
  );
}

function createNebulaTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x + 0.5) / size - 0.5;
      const normalizedY = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(normalizedX, normalizedY) * 2;
      const alpha = Math.max(0, 1 - distance) ** 2;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function NebulaField() {
  const nebulas = useMemo(() => createNebulaConfigs(0x51a7, 2), []);
  const texture = useMemo(createNebulaTexture, []);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group name="nebula-field">
      {nebulas.map((nebula) => (
        <sprite
          key={nebula.id}
          position={[nebula.position[0], nebula.position[1], nebula.position[2]]}
          scale={[nebula.scale[0], nebula.scale[1], nebula.scale[2]]}
        >
          <spriteMaterial
            blending={AdditiveBlending}
            color={nebula.color}
            depthWrite={false}
            map={texture}
            opacity={nebula.opacity}
            transparent
          />
        </sprite>
      ))}
    </group>
  );
}

/**
 * Diffuse unresolved-starlight ribbon along the galactic band. Together with
 * the 'band' background star layer this reads as the Milky Way rather than a
 * colored nebula.
 */
function MilkyWayField() {
  const patches = useMemo(() => createMilkyWayPatchConfigs(), []);
  const texture = useMemo(createNebulaTexture, []);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group name="milkyway-field">
      {patches.map((patch) => (
        <sprite
          key={patch.id}
          position={[patch.position[0], patch.position[1], patch.position[2]]}
          scale={[patch.scale[0], patch.scale[1], 1]}
        >
          <spriteMaterial
            blending={AdditiveBlending}
            color={patch.color}
            depthWrite={false}
            map={texture}
            opacity={patch.opacity}
            transparent
          />
        </sprite>
      ))}
    </group>
  );
}

interface SpaceSceneProps {
  store: ArchiveStoreApi;
  viewModel: SpaceSceneViewModel;
  constellationDraft: ReturnType<ArchiveStoreApi['getState']>['runtime']['constellationDraft'];
  pendingCameraRequest: ReturnType<ArchiveStoreApi['getState']>['runtime']['pendingCameraRequest'];
  selectedStarId: string | null;
  qualityLevel: QualityLevel;
  reducedMotion: boolean;
  activeDragPayload: StarDragPayload | null;
  onBlackholeDrop: (payload: StarDragPayload) => void;
  onBlackholeOpen: () => void;
  onStarDragStart?: (payload: StarDragPayload) => void;
  onStarDragEnd?: (payload: StarDragPayload) => void;
}

function SpaceScene({
  store,
  viewModel,
  constellationDraft,
  pendingCameraRequest,
  selectedStarId,
  qualityLevel,
  reducedMotion,
  activeDragPayload,
  onBlackholeDrop,
  onBlackholeOpen,
  onStarDragStart,
  onStarDragEnd,
}: SpaceSceneProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const selectStar = useCallback((starId: string) => {
    const state = store.getState();
    if (state.runtime.constellationDraft.active) {
      state.commands.selectConstellationStar(starId);
      return;
    }
    store.setState((current) => ({
      runtime: { ...current.runtime, selectedStarId: starId },
    }));
    store.getState().commands.requestCameraFocus({ type: 'star', starId });
  }, [store]);
  const onCameraRequestSettled = useCallback((settledRequest: CameraRequest) => {
    if (settledRequest.type === 'free') {
      store.getState().commands.completeCameraReturn();
    } else {
      store.getState().commands.clearCameraRequest();
    }
  }, [store]);
  const capturePreFocusPose = useCallback((pose: CameraPose) => {
    store.getState().commands.capturePreFocusPose(pose);
  }, [store]);
  const bloom = useMemo(
    () => createSelectiveBloomViewModel(
      viewModel.archiveContent.stars,
      viewModel.archiveContent.constellations,
    ),
    [viewModel.archiveContent.constellations, viewModel.archiveContent.stars],
  );
  const quality = getSceneQualitySettings(qualityLevel);
  const backgroundLayers = useMemo(
    () => BACKGROUND_LAYER_DEFINITIONS.map((definition) => ({
      ...definition,
      starCount: Math.max(
        1,
        Math.floor(definition.starCount * quality.backgroundStarScale),
      ),
    })),
    [quality.backgroundStarScale],
  );

  return (
    <>
      <color attach="background" args={[SPACE_BACKGROUND_COLOR]} />
      <PerspectiveCamera
        far={2_000}
        fov={SPACE_CAMERA_FOV}
        makeDefault
        near={0.1}
        position={[0, 0, 80]}
      />
      <ambientLight intensity={0.35} />
      <VisibilityClock paused={reducedMotion}>
        {backgroundLayers.map((definition) => (
          <BackgroundLayer definition={definition} key={definition.kind} />
        ))}
        <MilkyWayField />
        <NebulaField />
        <MilestoneRewardRenderer rewards={viewModel.milestoneRewards} />
        <Selection enabled={bloom.enabled}>
          <ConstellationRenderer
            constellations={viewModel.archiveContent.constellations}
            draft={constellationDraft}
            reducedMotion={reducedMotion}
            stars={viewModel.archiveContent.stars}
          />
          <StarRenderer
            onDragEnd={onStarDragEnd}
            onDragStart={onStarDragStart}
            onSelect={selectStar}
            reducedMotion={reducedMotion}
            selectedStarId={selectedStarId}
            stars={viewModel.archiveContent.stars}
          />
          <SelectiveBloomPass
            enabled={bloom.enabled}
            reducedQuality={quality.reducedBloom}
          />
        </Selection>
        <BlackholeRenderer
          activeDragPayload={activeDragPayload}
          archivedWorks={viewModel.archiveContent.archivedWorks}
          onDropStar={onBlackholeDrop}
          onOpenArchive={onBlackholeOpen}
          reducedMotion={reducedMotion}
        />
        <ParticleManager
          minimumParticleCounts={quality.minimumParticleCounts}
          store={store}
        />
      </VisibilityClock>
      <OrbitControls
        dampingFactor={0.045}
        enableDamping={!reducedMotion}
        enablePan
        enableRotate
        enableZoom
        maxDistance={SPACE_CAMERA_MAX_DISTANCE}
        ref={controlsRef}
        rotateSpeed={0.55}
        touches={ORBIT_TOUCH_GESTURES}
        zoomSpeed={0.75}
      />
      {/* Wheel dolly is intercepted and eased toward its target distance so
          zooming glides like a rubber band instead of stepping per tick.
          Touch pinch keeps OrbitControls' native dolly above. */}
      <SmoothWheelZoom
        controlsRef={controlsRef}
        enabled={!reducedMotion}
        maxDistance={SPACE_CAMERA_MAX_DISTANCE}
      />
      <CameraRig
        constellations={viewModel.archiveContent.constellations}
        controlsRef={controlsRef}
        onCapturePreFocusPose={capturePreFocusPose}
        onRequestCompleted={onCameraRequestSettled}
        onRequestRejected={(_, rejectedRequest) => onCameraRequestSettled(rejectedRequest)}
        reducedMotion={reducedMotion}
        request={pendingCameraRequest}
        selectedStarId={selectedStarId}
        stars={viewModel.archiveContent.stars}
      />
    </>
  );
}

export interface SpaceCanvasProps {
  store: ArchiveStoreApi;
  className?: string;
  sceneContentMounted?: boolean;
  onBenchmarkSource?: (source: SceneBenchmarkSource) => void;
  onFpsWindowMeasured?: (measurement: FpsWindowMeasurement) => void;
  onStarDragStart?: (payload: StarDragPayload) => void;
  onStarDragEnd?: (payload: StarDragPayload) => void;
}

interface PendingBlackholeMove {
  payload: StarDragPayload;
  affectedConstellationNames: string[];
}

export function SpaceCanvas({
  store,
  className,
  sceneContentMounted = true,
  onBenchmarkSource,
  onFpsWindowMeasured,
  onStarDragStart,
  onStarDragEnd,
}: SpaceCanvasProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const hasPersistedRegistration = useStore(
    store,
    (state) => state.runtime.hasPersistedRegistration,
  );
  const constellationDraft = useStore(
    store,
    (state) => state.runtime.constellationDraft,
  );
  const pendingCameraRequest = useStore(
    store,
    (state) => state.runtime.pendingCameraRequest,
  );
  const selectedStarId = useStore(store, (state) => state.runtime.selectedStarId);
  const qualityLevel = useStore(store, (state) => state.runtime.qualityLevel);
  const reducedMotion = usePrefersReducedMotion();
  const canvasRegionRef = useRef<HTMLElement>(null);
  const archiveCloseRef = useRef<HTMLButtonElement>(null);
  const [activeDragPayload, setActiveDragPayload] = useState<StarDragPayload | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingBlackholeMove | null>(null);
  const [isArchiveOpen, setArchiveOpen] = useState(false);
  const closeArchive = () => setArchiveOpen(false);
  const archiveFocusTrap = useModalFocusTrap<HTMLDivElement>(
    isArchiveOpen,
    closeArchive,
    archiveCloseRef,
    canvasRegionRef,
  );
  const viewModel = useMemo(
    () => createSpaceSceneViewModel(persisted, hasPersistedRegistration),
    [hasPersistedRegistration, persisted],
  );

  // Central free-viewpoint return: any non-null→null transition of the selected
  // star (close button, ESC, outside click, soft/hard delete, DOM navigation)
  // triggers the same return, since selectedStarId is the single source. Lives
  // at the SpaceCanvas top level so it runs regardless of Canvas mount state.
  const previousSelectedStarId = useRef<string | null>(selectedStarId);
  useEffect(() => {
    if (previousSelectedStarId.current !== null && selectedStarId === null) {
      store.getState().commands.requestCameraReturn();
    }
    previousSelectedStarId.current = selectedStarId;
  }, [selectedStarId, store]);

  const startStarDrag = useCallback((payload: StarDragPayload) => {
    setActiveDragPayload(payload);
    onStarDragStart?.(payload);
  }, [onStarDragStart]);
  const endStarDrag = useCallback((payload: StarDragPayload) => {
    setActiveDragPayload(null);
    onStarDragEnd?.(payload);
  }, [onStarDragEnd]);
  const requestBlackholeMove = useCallback((payload: StarDragPayload) => {
    setActiveDragPayload(null);
    onStarDragEnd?.(payload);
    setPendingMove({
      payload,
      affectedConstellationNames:
        store.getState().commands.getAffectedConstellationNames(payload.starId),
    });
  }, [onStarDragEnd, store]);
  const confirmBlackholeMove = () => {
    if (pendingMove === null) return;
    const result = store.getState().commands.softDelete(pendingMove.payload.starId);
    if (result.ok) setPendingMove(null);
  };
  const createBenchmarkSource = useCallback(({
    gl,
    scene,
  }: RootState) => {
    if (onBenchmarkSource === undefined) return;
    onBenchmarkSource({
      snapshotResources: () => collectSceneResources(
        scene,
        gl.info.memory,
        sceneResourceRegistry.snapshot(),
      ),
      renderer: () => {
        const context = gl.getContext();
        const extension = context.getExtension('WEBGL_debug_renderer_info');
        if (extension === null) return String(context.getParameter(context.RENDERER));
        return String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL));
      },
    });
  }, [onBenchmarkSource]);

  return (
    <>
      <section
        aria-describedby="space-canvas-description"
        aria-labelledby="space-canvas-heading"
        className={className === undefined ? 'space-canvas-shell' : `space-canvas-shell ${className}`}
        data-motion={reducedMotion ? 'reduced' : 'full'}
        data-orbit-one-touch={ORBIT_TOUCH_GESTURES.ONE}
        data-orbit-two-touch={ORBIT_TOUCH_GESTURES.TWO}
        ref={canvasRegionRef}
        tabIndex={-1}
      >
        <h2 className="visually-hidden" id="space-canvas-heading">3D 우주 아카이브</h2>
        <p className="visually-hidden" id="space-canvas-description">
          작품 별, 장르 은하, 별자리와 블랙홀을 시각화한 3D 영역입니다.
          모든 기능은 작품 DOM 탐색에서도 사용할 수 있습니다.
        </p>
        <a className="canvas-dom-link" href="#archive-dom-navigation">작품 DOM 탐색으로 건너뛰기</a>
        <p aria-live="polite" className="visually-hidden">
          {reducedMotion ? '모션 감소 설정에 따라 3D 장면을 정적으로 표시합니다.' : '3D 장면 애니메이션이 활성화되었습니다.'}
        </p>
        <SceneErrorBoundary navigationTargetId="archive-dom-navigation">
          <Canvas
            aria-hidden="true"
            dpr={[1, 1.5]}
            frameloop={getSceneFrameLoop(reducedMotion)}
            gl={{ antialias: true }}
            onCreated={createBenchmarkSource}
          >
            {sceneContentMounted ? (
              <>
                <FpsDegradationMonitor
                  onWindowMeasured={onFpsWindowMeasured}
                  store={store}
                />
                <SpaceScene
                  activeDragPayload={activeDragPayload}
                  constellationDraft={constellationDraft}
                  onBlackholeDrop={requestBlackholeMove}
                  onBlackholeOpen={() => setArchiveOpen(true)}
                  onStarDragEnd={endStarDrag}
                  onStarDragStart={startStarDrag}
                  pendingCameraRequest={pendingCameraRequest}
                  qualityLevel={qualityLevel}
                  reducedMotion={reducedMotion}
                  selectedStarId={selectedStarId}
                  store={store}
                  viewModel={viewModel}
                />
              </>
            ) : null}
          </Canvas>
        </SceneErrorBoundary>
      </section>

      {pendingMove !== null && (
        <ConfirmDialog
          affectedConstellationNames={pendingMove.affectedConstellationNames}
          confirmLabel="블랙홀 이동 실행"
          description="이 작품을 블랙홀 아카이브로 이동하고 별자리 연결에서 제거합니다."
          onCancel={() => setPendingMove(null)}
          onConfirm={confirmBlackholeMove}
          title="블랙홀 이동 확인"
        />
      )}

      {isArchiveOpen && (
        <div
          className="dialog-backdrop blackhole-archive-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeArchive();
          }}
        >
          <div
            aria-labelledby="scene-blackhole-archive-heading"
            aria-modal="true"
            className="blackhole-archive-dialog"
            onKeyDown={archiveFocusTrap.onKeyDown}
            ref={archiveFocusTrap.containerRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="블랙홀 아카이브 닫기"
              className="card-close-button"
              onClick={closeArchive}
              ref={archiveCloseRef}
              type="button"
            >
              닫기
            </button>
            <BlackholeArchive
              headingId="scene-blackhole-archive-heading"
              store={store}
            />
          </div>
        </div>
      )}
    </>
  );
}
