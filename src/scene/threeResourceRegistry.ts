import { useCallback, useEffect, useRef } from 'react';
import type { Material, Object3D, Texture } from 'three';
import type { BufferGeometry } from 'three';

export type TrackedThreeResource = BufferGeometry | Material | Texture;

export interface ThreeResourceRegistrySnapshot {
  geometries: number;
  materials: number;
  textures: number;
  references: number;
}

type Releaser = () => void;

function isBufferGeometry(value: unknown): value is BufferGeometry {
  return typeof value === 'object'
    && value !== null
    && 'isBufferGeometry' in value
    && value.isBufferGeometry === true;
}

function isMaterial(value: unknown): value is Material {
  return typeof value === 'object'
    && value !== null
    && 'isMaterial' in value
    && value.isMaterial === true;
}

function isTexture(value: unknown): value is Texture {
  return typeof value === 'object'
    && value !== null
    && 'isTexture' in value
    && value.isTexture === true;
}

function collectTexturesFromValue(
  value: unknown,
  textures: Set<Texture>,
  visited: WeakSet<object>,
): void {
  if (isTexture(value)) {
    textures.add(value);
    return;
  }
  if (typeof value !== 'object' || value === null || visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTexturesFromValue(entry, textures, visited));
    return;
  }

  Object.values(value).forEach((entry) => {
    if (isTexture(entry) || Array.isArray(entry)) {
      collectTexturesFromValue(entry, textures, visited);
    }
  });
}

export function collectMaterialTextures(material: Material): Texture[] {
  const textures = new Set<Texture>();
  const visited = new WeakSet<object>();

  Object.values(material).forEach((value) => {
    if (isTexture(value) || Array.isArray(value)) {
      collectTexturesFromValue(value, textures, visited);
    }
  });

  const uniforms = 'uniforms' in material
    ? (material as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms
    : undefined;
  if (uniforms !== undefined) {
    Object.values(uniforms).forEach(({ value }) => {
      collectTexturesFromValue(value, textures, visited);
    });
  }

  return [...textures];
}

function collectDirectObjectResources(object: Object3D): TrackedThreeResource[] {
  const candidate = object as Object3D & {
    geometry?: unknown;
    material?: unknown;
  };
  const resources = new Set<TrackedThreeResource>();

  if (isBufferGeometry(candidate.geometry)) resources.add(candidate.geometry);
  const materials = Array.isArray(candidate.material)
    ? candidate.material
    : [candidate.material];
  materials.forEach((material) => {
    if (!isMaterial(material)) return;
    resources.add(material);
    collectMaterialTextures(material).forEach((texture) => resources.add(texture));
  });

  return [...resources];
}

/**
 * Reference-counts GPU resources by mounted Scene object. Three.js materials do not
 * dispose their textures, so textures are retained and released independently.
 */
export class ThreeResourceRegistry {
  readonly #referenceCounts = new WeakMap<TrackedThreeResource, number>();
  readonly #activeResources = new WeakSet<TrackedThreeResource>();
  #geometries = 0;
  #materials = 0;
  #textures = 0;
  #references = 0;

  retain(resource: TrackedThreeResource): number {
    const currentCount = this.#referenceCounts.get(resource) ?? 0;
    const nextCount = currentCount + 1;
    this.#referenceCounts.set(resource, nextCount);
    this.#references += 1;
    if (currentCount === 0) {
      this.#activeResources.add(resource);
      if (isBufferGeometry(resource)) this.#geometries += 1;
      else if (isMaterial(resource)) this.#materials += 1;
      else this.#textures += 1;
    }
    return nextCount;
  }

  release(resource: TrackedThreeResource): number {
    const currentCount = this.#referenceCounts.get(resource);
    if (currentCount === undefined) {
      throw new Error('Cannot release an untracked Three.js resource.');
    }

    const nextCount = currentCount - 1;
    this.#references -= 1;
    if (nextCount > 0) {
      this.#referenceCounts.set(resource, nextCount);
      return nextCount;
    }

    this.#referenceCounts.delete(resource);
    this.#activeResources.delete(resource);
    if (isBufferGeometry(resource)) this.#geometries -= 1;
    else if (isMaterial(resource)) this.#materials -= 1;
    else this.#textures -= 1;
    resource.dispose();
    return 0;
  }

  getReferenceCount(resource: TrackedThreeResource): number {
    return this.#referenceCounts.get(resource) ?? 0;
  }

  snapshot(): ThreeResourceRegistrySnapshot {
    return {
      geometries: this.#geometries,
      materials: this.#materials,
      textures: this.#textures,
      references: this.#references,
    };
  }

  trackObject(object: Object3D, recursive = false): Releaser {
    const resources: TrackedThreeResource[] = [];
    const collect = (current: Object3D) => {
      resources.push(...collectDirectObjectResources(current));
    };

    if (recursive) object.traverse(collect);
    else collect(object);
    resources.forEach((resource) => this.retain(resource));

    let released = false;
    return () => {
      if (released) return;
      released = true;
      [...resources].reverse().forEach((resource) => this.release(resource));
    };
  }
}

export const sceneResourceRegistry = new ThreeResourceRegistry();

/** Callback ref that transfers disposal ownership from R3F to the shared registry. */
export function useThreeResourceTracking<T extends Object3D>(
  registry: ThreeResourceRegistry = sceneResourceRegistry,
) {
  const releaseRef = useRef<Releaser | null>(null);

  const setTrackedObject = useCallback((object: T | null) => {
    releaseRef.current?.();
    releaseRef.current = object === null ? null : registry.trackObject(object);
  }, [registry]);

  useEffect(() => () => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  return setTrackedObject;
}
