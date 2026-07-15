import type { Object3D } from 'three';
import type { Material, Texture } from 'three';

import type { QualityLevel } from '../domain/models';
import {
  collectMaterialTextures,
  type ThreeResourceRegistrySnapshot,
} from './threeResourceRegistry';

export interface FpsWindowMeasurement {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  frameCount: number;
  averageFps: number;
  qualityLevel: QualityLevel;
  degradedTo: QualityLevel | null;
}

export interface BrowserLifecycleCounterSnapshot {
  animationFrames: number;
  timers: number;
}

export interface SceneResourceSnapshot {
  geometries: number;
  materials: number;
  textures: number;
  rendererGeometries: number;
  rendererTextures: number;
  registry: ThreeResourceRegistrySnapshot;
}

export interface SceneBenchmarkSnapshot {
  activeWorks: number;
  contentMounted: boolean;
  orbitControlsActive: boolean;
  renderer: string;
  qualityLevel: QualityLevel;
  fpsWindows: readonly FpsWindowMeasurement[];
  resources: SceneResourceSnapshot;
  lifecycle: BrowserLifecycleCounterSnapshot | null;
}

export interface SceneBenchmarkSource {
  snapshotResources(): SceneResourceSnapshot;
  renderer(): string;
}

export interface SpaceMovieBenchmarkApi {
  clearFpsWindows(): void;
  mountScene(): void;
  snapshot(): SceneBenchmarkSnapshot;
  unmountScene(): void;
}

interface RendererMemoryInfo {
  geometries: number;
  textures: number;
}

interface BrowserLifecycleInstrumentation {
  snapshot(): BrowserLifecycleCounterSnapshot;
}

declare global {
  interface Window {
    __SPACE_MOVIE_BENCHMARK__?: SpaceMovieBenchmarkApi;
    __SPACE_MOVIE_LIFECYCLE__?: BrowserLifecycleInstrumentation;
  }
}

function directMaterials(object: Object3D): Material[] {
  const value = (object as Object3D & { material?: Material | Material[] }).material;
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Counts unique resources currently attached to the mounted scene graph. */
export function collectSceneResources(
  scene: Object3D,
  rendererMemory: Readonly<RendererMemoryInfo>,
  registry: Readonly<ThreeResourceRegistrySnapshot>,
): SceneResourceSnapshot {
  const geometries = new Set<object>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  scene.traverse((object) => {
    const geometry = (object as Object3D & { geometry?: object }).geometry;
    if (geometry !== undefined) geometries.add(geometry);
    for (const material of directMaterials(object)) {
      materials.add(material);
      for (const texture of collectMaterialTextures(material)) textures.add(texture);
    }
  });

  return {
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    rendererGeometries: rendererMemory.geometries,
    rendererTextures: rendererMemory.textures,
    registry: { ...registry },
  };
}
