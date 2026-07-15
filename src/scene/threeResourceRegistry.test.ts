import {
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { describe, expect, it, vi } from 'vitest';

import { ThreeResourceRegistry } from './threeResourceRegistry';

describe('ThreeResourceRegistry', () => {
  it('R13.7-R13.8 disposes shared geometry, material, and texture only after the final object releases them', () => {
    const registry = new ThreeResourceRegistry();
    const geometry = new BufferGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    const releaseFirst = registry.trackObject(new Mesh(geometry, material));
    const releaseSecond = registry.trackObject(new Mesh(geometry, material));

    expect(registry.getReferenceCount(geometry)).toBe(2);
    expect(registry.getReferenceCount(material)).toBe(2);
    expect(registry.getReferenceCount(texture)).toBe(2);
    expect(registry.snapshot()).toEqual({
      geometries: 1,
      materials: 1,
      textures: 1,
      references: 6,
    });

    releaseFirst();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();

    releaseSecond();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(registry.getReferenceCount(geometry)).toBe(0);
    expect(registry.snapshot()).toEqual({
      geometries: 0,
      materials: 0,
      textures: 0,
      references: 0,
    });
  });

  it('releases recursive object references once even when cleanup is repeated', () => {
    const registry = new ThreeResourceRegistry();
    const geometry = new BufferGeometry();
    const material = new MeshStandardMaterial();
    const dispose = vi.spyOn(geometry, 'dispose');
    const group = new Group();
    group.add(new Mesh(geometry, material), new Mesh(geometry, material));
    const release = registry.trackObject(group, true);

    expect(registry.getReferenceCount(geometry)).toBe(2);
    release();
    release();

    expect(dispose).toHaveBeenCalledOnce();
    expect(registry.getReferenceCount(geometry)).toBe(0);
  });
});
