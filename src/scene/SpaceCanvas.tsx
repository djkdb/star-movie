import { PerspectiveCamera, TrackballControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import {
  AdditiveBlending,
  BufferGeometry,
  type Group,
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
  WatchlistEntry,
  CameraPose,
  CameraRequest,
  Constellation,
  Galaxy,
  Genre,
  OwnedPlanet,
  PersistedStore,
  QualityLevel,
  Star,
} from '../domain/models';
import { getSceneQualitySettings } from '../domain/qualityLevel';
import type { ArchiveStoreApi } from '../store/archiveStore';
import {
  BACKGROUND_LAYER_DEFINITIONS,
  calculateParallaxOffset,
  CLOUD_TEXTURE_VARIANTS,
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
import { registerGalaxyCanvas } from './galaxyCapture';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { usePrefersReducedMotion, getSceneFrameLoop } from './usePrefersReducedMotion';
import { BlackholeRenderer } from './BlackholeRenderer';
import { ConstellationRenderer } from './ConstellationRenderer';
import { FpsDegradationMonitor } from './FpsDegradationController';
import { MilestoneRewardRenderer, selectMilestoneRewardViewModels, type MilestoneRewardViewModel } from './MilestoneRewardRenderer';
import {
  ORBIT_TOUCH_GESTURES,
  clampTargetLength,
  getTrackballSpeeds,
} from './orbitControlsConfig';
import { useCoarsePointer } from './useCoarsePointer';
import { ParticleManager } from './ParticleManager';
import { PlanetCollectionRenderer } from './PlanetCollectionRenderer';
import {
  collectSceneResources,
  type FpsWindowMeasurement,
  type SceneBenchmarkSource,
} from './performanceBenchmark';
import { SmoothWheelZoom } from './SmoothWheelZoom';
import { BackgroundBlackhole } from './BackgroundBlackhole';
import { SpiralGalaxyField } from './SpiralGalaxyField';
import { sceneResourceRegistry } from './threeResourceRegistry';
import {
  createSelectiveBloomViewModel,
  SelectiveBloomPass,
} from './selectiveBloom';
import { StarRenderer } from './StarRenderer';
import { WatchlistNebulaRenderer } from './WatchlistNebulaRenderer';
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

/**
 * Three small spiral galaxies scattered across the deep background, kept far
 * from the grand background black hole and from one another so the sky reads as
 * a wide, populated cosmos. Each is a third of the original galaxy's size.
 */
const BACKGROUND_GALAXY_TEXTURE_SIZE = 96;
const BACKGROUND_GALAXIES: readonly {
  origin: readonly [number, number, number];
  tilt: readonly [number, number, number];
  scale: number;
}[] = [
  { origin: [504, 380, 423], tilt: [1.0, 0.6, 0.2], scale: 0.27 },
  { origin: [-547, -260, 459], tilt: [0.9, -0.4, 0.5], scale: 0.27 },
  { origin: [539, -436, -311], tilt: [1.3, 0.2, -0.3], scale: 0.27 },
];

export interface SceneArchiveContent {
  stars: readonly Star[];
  constellations: readonly Constellation[];
  archivedWorks: readonly ArchivedStar[];
}

export interface SpaceSceneViewModel {
  galaxies: readonly Galaxy[];
  milestoneRewards: readonly MilestoneRewardViewModel[];
  archiveContent: SceneArchiveContent;
  planets: readonly OwnedPlanet[];
  watchlist: readonly WatchlistEntry[];
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
    planets: hasPersistedRegistration ? persisted.planetCollection.planets : [],
    watchlist: hasPersistedRegistration ? persisted.watchlist : [],
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

/**
 * Fires once when the scene renders its first real frame — the honest signal
 * that the raymarched black hole and GPGPU shaders have compiled — so the CSS
 * starfield placeholder can crossfade out instead of a black flash.
 */
function FirstFrameSignal({ onReady }: { onReady: () => void }) {
  const firedRef = useRef(false);
  useFrame(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady();
  });
  return null;
}

/**
 * A small idle-liveliness move borrowed from Spline: the whole sky drifts a
 * little as the pointer moves and eases back when it leaves. The damped pointer
 * offset is written to a shared ref that ParallaxGroup reads to nudge the scene.
 * Disabled under reduced motion — where the frameloop is 'demand' and pointer
 * motion must not invalidate frames — and on coarse pointers, where it would
 * fight one-finger trackball rotation.
 */
const POINTER_PARALLAX_WORLD = 1.3;

function PointerParallaxDriver({
  enabled,
  offsetRef,
}: {
  enabled: boolean;
  offsetRef: { current: { x: number; y: number } };
}) {
  const gl = useThree((state) => state.gl);
  const targetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) {
      offsetRef.current = { x: 0, y: 0 };
      targetRef.current = { x: 0, y: 0 };
      return undefined;
    }
    const element = gl.domElement;
    const handleMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      targetRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      targetRef.current.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    const reset = () => {
      targetRef.current.x = 0;
      targetRef.current.y = 0;
    };
    element.addEventListener('pointermove', handleMove);
    element.addEventListener('pointerleave', reset);
    return () => {
      element.removeEventListener('pointermove', handleMove);
      element.removeEventListener('pointerleave', reset);
    };
  }, [enabled, gl, offsetRef]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const k = 1 - Math.exp(-4 * delta);
    offsetRef.current.x += (targetRef.current.x - offsetRef.current.x) * k;
    offsetRef.current.y += (targetRef.current.y - offsetRef.current.y) * k;
  });

  return null;
}

/**
 * Wraps the whole scene and shifts it in camera space by the damped pointer
 * offset, so the black hole, stars, nebula and background all parallax together
 * instead of only the far starfield drifting. Because everything shifts by the
 * same world vector, near elements move more on screen than the distant
 * backdrop — the natural look-around feel. Star positions and raycasting are
 * unaffected: only the group's render transform moves.
 */
function ParallaxGroup({
  enabled,
  offsetRef,
  children,
}: {
  enabled: boolean;
  offsetRef: { current: { x: number; y: number } };
  children: ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  const right = useRef(new Vector3());
  const up = useRef(new Vector3());
  const forward = useRef(new Vector3());

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;
    if (!enabled) {
      if (group.position.lengthSq() !== 0) group.position.set(0, 0, 0);
      return;
    }
    const offset = offsetRef.current;
    camera.matrixWorld.extractBasis(right.current, up.current, forward.current);
    const s = POINTER_PARALLAX_WORLD;
    // Shift opposite the pointer, in the camera's own right/up plane, so the
    // drift reads the same whichever way the sky has been rotated.
    group.position.set(
      (right.current.x * -offset.x + up.current.x * offset.y) * s,
      (right.current.y * -offset.x + up.current.y * offset.y) * s,
      (right.current.z * -offset.x + up.current.z * offset.y) * s,
    );
  });

  return <group ref={groupRef}>{children}</group>;
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

/** Deterministic 2D value-noise lattice hash in [0, 1). */
function cloudHash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 0x1_0000_0000;
}

/** Smooth (bilinear + fade) value noise sampled on the lattice. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = cloudHash(ix, iy, seed);
  const b = cloudHash(ix + 1, iy, seed);
  const c = cloudHash(ix, iy + 1, seed);
  const d = cloudHash(ix + 1, iy + 1, seed);
  return (
    a * (1 - ux) * (1 - uy) +
    b * ux * (1 - uy) +
    c * (1 - ux) * uy +
    d * ux * uy
  );
}

/** Fractal Brownian motion: layered noise octaves for wispy detail. */
function cloudFbm(x: number, y: number, seed: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    value += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 1013);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * Ridged fbm: each octave is folded (1 - |2n - 1|) and squared so the noise
 * grows sharp bright crests instead of soft rolling hills. Layered over the
 * smooth density this carves the fine, thread-like filaments real emission
 * nebulae show, giving the cloud interior structure at a second scale.
 */
function cloudRidged(x: number, y: number, seed: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    const n = valueNoise(x * frequency, y * frequency, seed + octave * 1013);
    const ridge = 1 - Math.abs(2 * n - 1);
    value += amplitude * ridge * ridge;
    frequency *= 2.17;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * A wispy fractal cloud rather than a smooth disc: fbm density carved by a soft
 * elliptical vignette, with domain warping so the silhouette is torn and
 * irregular. Ridged filaments add fine thread structure at a second scale, and
 * the interior is tinted with volume — dense cores glow warm and bright while
 * thin outer wisps cool toward blue — so each billboard reads as a
 * three-dimensional cloud lit from within rather than one flat drifting circle.
 */
function createCloudTexture(seed: number, size = 192): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const scale = 3.2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.5;
      // Domain warp pushes the vignette edge in and out for a torn rim.
      const warp = cloudFbm(nx * scale + 5.1, ny * scale + 2.7, seed ^ 0x9e37) - 0.5;
      const distance = Math.hypot(nx, ny) * 2 + warp * 0.55;
      const vignette = Math.max(0, 1 - distance);
      const density = cloudFbm(nx * scale + 1.3, ny * scale - 4.2, seed);
      // Sharp threads woven through the soft density for two-scale structure.
      const filament = cloudRidged(nx * scale * 1.7 + 9.0, ny * scale * 1.7 - 3.0, seed ^ 0x5bd1);
      const structure = density * (0.68 + 0.5 * filament);
      // Multiply so the cloud only exists where both the vignette and the fbm
      // are strong; the power sharpens filaments into wisps.
      const alpha = vignette ** 1.4 * structure ** 1.7 * 3.6;
      // Warmth peaks in the dense, well-lit core and falls off to cool edges,
      // baking a temperature gradient into the cloud so its tint has depth.
      const warm = Math.min(1, vignette ** 2.2 * density * 1.7);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = Math.round(230 + warm * 25);
      data[index + 2] = Math.round(255 - warm * 58);
      data[index + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A memoized bank of distinct cloud textures the fields index into. */
function useCloudTextures(): DataTexture[] {
  const textures = useMemo(
    () =>
      Array.from({ length: CLOUD_TEXTURE_VARIANTS }, (_, index) =>
        createCloudTexture(0x1234 + index * 0x9d3f),
      ),
    [],
  );
  useEffect(
    () => () => {
      for (const texture of textures) texture.dispose();
    },
    [textures],
  );
  return textures;
}

function NebulaField() {
  const nebulas = useMemo(() => createNebulaConfigs(0x51a7, 2), []);
  const textures = useCloudTextures();

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
            map={textures[nebula.variant % textures.length]}
            opacity={nebula.opacity}
            rotation={nebula.rotation}
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
  const textures = useCloudTextures();

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
            map={textures[patch.variant % textures.length]}
            opacity={patch.opacity}
            rotation={patch.rotation}
            transparent
          />
        </sprite>
      ))}
    </group>
  );
}

/**
 * Keeps the camera's focus point inside the archive: panning past the bound
 * eases the target back, so no gesture can wander out of the starry universe.
 */
function CameraTargetBounds({
  controlsRef,
}: {
  controlsRef: RefObject<ComponentRef<typeof TrackballControls> | null>;
}) {
  useFrame(() => {
    const controls = controlsRef.current;
    if (controls === null) return;
    const target = controls.target;
    const length = Math.hypot(target.x, target.y, target.z);
    const clamped = clampTargetLength(length);
    if (clamped < length) target.multiplyScalar(clamped / length);
  });
  return null;
}

interface SpaceSceneProps {
  store: ArchiveStoreApi;
  viewModel: SpaceSceneViewModel;
  constellationDraft: ReturnType<ArchiveStoreApi['getState']>['runtime']['constellationDraft'];
  pendingCameraRequest: ReturnType<ArchiveStoreApi['getState']>['runtime']['pendingCameraRequest'];
  selectedStarId: string | null;
  selectedGenres: ReadonlySet<Genre>;
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
  selectedGenres,
  qualityLevel,
  reducedMotion,
  activeDragPayload,
  onBlackholeDrop,
  onBlackholeOpen,
  onStarDragStart,
  onStarDragEnd,
}: SpaceSceneProps) {
  const controlsRef = useRef<ComponentRef<typeof TrackballControls>>(null);
  const coarsePointer = useCoarsePointer();
  const speeds = getTrackballSpeeds(coarsePointer);
  const pointerParallaxEnabled = !reducedMotion && !coarsePointer;
  const pointerOffsetRef = useRef({ x: 0, y: 0 });
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
  // The raymarched background black hole is the heaviest backdrop element, so it
  // only hangs in the sky at the top two quality tiers and drops out entirely
  // once the scene starts degrading for performance.
  const showBackgroundBlackhole =
    qualityLevel === 'full' || qualityLevel === 'reducedBackground';
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
      <PointerParallaxDriver enabled={pointerParallaxEnabled} offsetRef={pointerOffsetRef} />
      <VisibilityClock paused={reducedMotion}>
        <ParallaxGroup enabled={pointerParallaxEnabled} offsetRef={pointerOffsetRef}>
        {backgroundLayers.map((definition) => (
          <BackgroundLayer definition={definition} key={definition.kind} />
        ))}
        {showBackgroundBlackhole && (
          <>
            <BackgroundBlackhole
              qualityLevel={qualityLevel}
              reducedMotion={reducedMotion}
            />
            {BACKGROUND_GALAXIES.map((galaxy, index) => (
              <SpiralGalaxyField
                key={`bg-galaxy-${index}`}
                origin={galaxy.origin}
                reducedMotion={reducedMotion}
                scale={galaxy.scale}
                textureSize={BACKGROUND_GALAXY_TEXTURE_SIZE}
                tilt={galaxy.tilt}
              />
            ))}
          </>
        )}
        <MilkyWayField />
        <NebulaField />
        <MilestoneRewardRenderer rewards={viewModel.milestoneRewards} />
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
          selectedGenres={selectedGenres}
          selectedStarId={selectedStarId}
          stars={viewModel.archiveContent.stars}
        />
        <SelectiveBloomPass
          enabled={bloom.enabled}
          reducedMotion={reducedMotion}
          reducedQuality={quality.reducedBloom}
        />
        <BlackholeRenderer
          activeDragPayload={activeDragPayload}
          archivedWorks={viewModel.archiveContent.archivedWorks}
          onDropStar={onBlackholeDrop}
          onOpenArchive={onBlackholeOpen}
          qualityLevel={qualityLevel}
          reducedMotion={reducedMotion}
        />
        <PlanetCollectionRenderer
          planets={viewModel.planets}
          reducedMotion={reducedMotion}
        />
        <WatchlistNebulaRenderer
          entries={viewModel.watchlist}
          reducedMotion={reducedMotion}
        />
        <ParticleManager
          minimumParticleCounts={quality.minimumParticleCounts}
          store={store}
        />
        </ParallaxGroup>
      </VisibilityClock>
      {/* Trackball (arcball) instead of Orbit: the camera tumbles freely in
          every axis with no pole gimbal-lock, so the sky spins a full 360°
          in any direction. staticMoving under reduced motion drops inertia. */}
      <TrackballControls
        dynamicDampingFactor={0.12}
        maxDistance={SPACE_CAMERA_MAX_DISTANCE}
        panSpeed={speeds.pan}
        ref={controlsRef}
        rotateSpeed={speeds.rotate}
        staticMoving={reducedMotion}
        zoomSpeed={speeds.zoom}
      />
      <CameraTargetBounds controlsRef={controlsRef} />
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
  onSceneReady?: () => void;
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
  onSceneReady,
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
  const selectedGenres = useStore(store, (state) => state.runtime.selectedGenres);
  const qualityLevel = useStore(store, (state) => state.runtime.qualityLevel);
  const reducedMotion = usePrefersReducedMotion();
  const canvasRegionRef = useRef<HTMLElement>(null);
  const archiveCloseRef = useRef<HTMLButtonElement>(null);
  const [activeDragPayload, setActiveDragPayload] = useState<StarDragPayload | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingBlackholeMove | null>(null);
  const [isArchiveOpen, setArchiveOpen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
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
    // Register the live canvas so the galaxy image export can snapshot it.
    registerGalaxyCanvas(gl.domElement);
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
        data-scene-ready={sceneReady ? 'true' : 'false'}
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
            // Anti-aliasing is owned by the post-processing composer; enabling it
            // on the Canvas too makes both resolve MSAA and alias the shared
            // depth-stencil buffer, which flickers/blacks out the scene.
            // preserveDrawingBuffer lets the galaxy image export read the frame.
            gl={{ antialias: false, preserveDrawingBuffer: true }}
            onCreated={createBenchmarkSource}
          >
            {sceneContentMounted ? (
              <>
                <FirstFrameSignal
                  onReady={() => {
                    setSceneReady(true);
                    onSceneReady?.();
                  }}
                />
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
                  selectedGenres={selectedGenres}
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
