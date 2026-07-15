import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';

import { collectSceneResources } from './performanceBenchmark';

describe('performance benchmark instrumentation', () => {
  it('R11.5 R11.10 R13.7-R13.8 counts unique mounted geometry, material, and texture resources', () => {
    const scene = new Group();
    const geometry = new BufferGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    scene.add(new Mesh(geometry, material), new Mesh(geometry, material));

    const snapshot = collectSceneResources(
      scene,
      { geometries: 7, textures: 3 },
      { geometries: 1, materials: 1, textures: 1, references: 6 },
    );

    expect(snapshot).toEqual({
      geometries: 1,
      materials: 1,
      textures: 1,
      rendererGeometries: 7,
      rendererTextures: 3,
      registry: { geometries: 1, materials: 1, textures: 1, references: 6 },
    });
  });

  it('counts textures held in shader uniforms without double-counting shared values', () => {
    const scene = new Group();
    const texture = new Texture();
    const material = new ShaderMaterial({
      uniforms: {
        primary: { value: texture },
        repeated: { value: [texture] },
      },
    });
    scene.add(new Mesh(new BufferGeometry(), material));

    expect(collectSceneResources(
      scene,
      { geometries: 1, textures: 1 },
      { geometries: 0, materials: 0, textures: 0, references: 0 },
    ).textures).toBe(1);
  });
});
