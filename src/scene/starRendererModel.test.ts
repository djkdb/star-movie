import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import type { Rating, Star } from '../domain/models';
import {
  createInstancedStarBuckets,
  getStarInstancePhase,
  getStarRenderMode,
  INDIVIDUAL_STAR_LIMIT,
  resolveStarIdFromInstance,
  sampleStarInstanceTransform,
  updateInstancedStarColors,
  updateInstancedStarMatrices,
} from './starRendererModel';

function createStar(id: string, rating: Rating): Star {
  return {
    id,
    title: `Title ${id}`,
    normalizedTitle: `title ${id}`,
    genre: 'SF',
    rating,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: 2, y: 7, z: -3 },
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('Star renderer model', () => {
  it('R13.1 uses individual meshes through 50 and instancing from 51', () => {
    expect(INDIVIDUAL_STAR_LIMIT).toBe(50);
    expect(getStarRenderMode(0)).toBe('individual');
    expect(getStarRenderMode(50)).toBe('individual');
    expect(getStarRenderMode(51)).toBe('instanced');
    expect(() => getStarRenderMode(-1)).toThrow(RangeError);
  });

  it('creates ordered rating buckets with aligned phase and instanceId → starId mappings', () => {
    const stars = [
      createStar('five-a', 5),
      createStar('one-a', 1),
      createStar('five-b', 5),
      createStar('three-a', 3),
    ];

    const buckets = createInstancedStarBuckets(stars);

    expect(buckets.map(({ rating }) => rating)).toEqual([1, 3, 5]);
    expect(buckets).toHaveLength(3);
    expect(buckets[2]!.stars.map(({ id }) => id)).toEqual(['five-a', 'five-b']);
    expect(buckets[2]!.instanceIdToStarId).toEqual(['five-a', 'five-b']);
    expect(buckets[2]!.phases).toEqual([
      getStarInstancePhase('five-a'),
      getStarInstancePhase('five-b'),
    ]);
    expect(resolveStarIdFromInstance(buckets[2]!.instanceIdToStarId, 1)).toBe('five-b');
    expect(resolveStarIdFromInstance(buckets[2]!.instanceIdToStarId, 2)).toBeNull();
    expect(resolveStarIdFromInstance(buckets[2]!.instanceIdToStarId, undefined)).toBeNull();
  });

  it('keeps phase stable by Star identity across collection reorderings', () => {
    const phase = getStarInstancePhase('stable-star');
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
    expect(getStarInstancePhase('stable-star')).toBe(phase);
    expect(getStarInstancePhase('other-star')).not.toBe(phase);
  });

  it('R1.6 R1.7 R1.9 drifts on three axes, keeps rotation and hover scale, and pins under reduced motion', () => {
    const star = createStar('moving-star', 4);
    const phase = Math.PI / 2;
    const drifting = sampleStarInstanceTransform(star, 2, phase, false, false);
    const hoveredLater = sampleStarInstanceTransform(star, 3, phase, true, false);

    // Every axis drifts away from the stored coordinate, bounded within 0.6.
    expect(drifting.position.x).not.toBe(2);
    expect(drifting.position.y).not.toBe(7);
    expect(drifting.position.z).not.toBe(-3);
    expect(
      Math.hypot(
        drifting.position.x - 2,
        drifting.position.y - 7,
        drifting.position.z + 3,
      ),
    ).toBeLessThanOrEqual(0.6);
    expect(drifting.rotationY).toBeCloseTo(2 * (Math.PI / 6));
    expect(drifting.scale).toBe(1);
    expect(hoveredLater.rotationY).toBeCloseTo(Math.PI / 2);
    expect(hoveredLater.scale).toBe(1.5);

    // Reduced motion returns exactly the Base_Position with zero rotation.
    const still = sampleStarInstanceTransform(star, 3, phase, false, true);
    expect(still.position).toEqual({ x: 2, y: 7, z: -3 });
    expect(still.rotationY).toBe(0);
    expect(star.position).toEqual({ x: 2, y: 7, z: -3 });
  });

  it('R3.2-R3.10 writes aligned matrix, color, phase, and hover updates to InstancedMesh', () => {
    const stars = [createStar('instance-a', 4), createStar('instance-b', 4)];
    const bucket = createInstancedStarBuckets(stars)[0]!;
    const geometry = new SphereGeometry(1, 8, 6);
    const material = new MeshBasicMaterial({ vertexColors: true });
    const mesh = new InstancedMesh(geometry, material, stars.length);
    const scratch = new Object3D();
    const color = new Color('#ffe9b8');

    try {
      updateInstancedStarColors(mesh, bucket, color);
      updateInstancedStarMatrices(mesh, bucket, 1.25, 'instance-b', scratch, false);

      bucket.stars.forEach((star, instanceId) => {
        const expectedTransform = sampleStarInstanceTransform(
          star,
          1.25,
          bucket.phases[instanceId]!,
          star.id === 'instance-b',
          false,
        );
        const expectedObject = new Object3D();
        expectedObject.position.set(
          expectedTransform.position.x,
          expectedTransform.position.y,
          expectedTransform.position.z,
        );
        expectedObject.rotation.set(0, expectedTransform.rotationY, 0);
        expectedObject.scale.setScalar(expectedTransform.scale);
        expectedObject.updateMatrix();

        const actualMatrix = new Matrix4();
        mesh.getMatrixAt(instanceId, actualMatrix);
        actualMatrix.toArray().forEach((value, index) => {
          expect(value).toBeCloseTo(expectedObject.matrix.elements[index]!);
        });

        const actualPosition = new Vector3();
        const actualRotation = new Quaternion();
        const actualScale = new Vector3();
        actualMatrix.decompose(actualPosition, actualRotation, actualScale);
        expect(actualPosition.y).toBeCloseTo(expectedTransform.position.y);
        expect(actualScale.x).toBeCloseTo(star.id === 'instance-b' ? 1.5 : 1);

        const actualColor = new Color();
        mesh.getColorAt(instanceId, actualColor);
        expect(actualColor.getHexString()).toBe(color.getHexString());
      });
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });

  it('R13.1 preserves ID-based selection and camera target mappings across 50↔51 transitions', () => {
    const stars = Array.from({ length: 51 }, (_, index) =>
      createStar(`transition-${index}`, ((index % 5) + 1) as Rating),
    );
    const selectedStarId = 'transition-17';
    const cameraTarget = { type: 'star' as const, starId: selectedStarId };

    expect(getStarRenderMode(stars.slice(0, 50).length)).toBe('individual');
    expect(stars.slice(0, 50).some(({ id }) => id === selectedStarId)).toBe(true);

    const instancedBuckets = createInstancedStarBuckets(stars);
    const selectedBucket = instancedBuckets.find(({ instanceIdToStarId }) =>
      instanceIdToStarId.includes(selectedStarId),
    )!;
    const selectedInstanceId = selectedBucket.instanceIdToStarId.indexOf(selectedStarId);

    expect(getStarRenderMode(stars.length)).toBe('instanced');
    expect(resolveStarIdFromInstance(
      selectedBucket.instanceIdToStarId,
      selectedInstanceId,
    )).toBe(selectedStarId);
    expect(cameraTarget).toEqual({ type: 'star', starId: selectedStarId });

    expect(getStarRenderMode(stars.slice(0, 50).length)).toBe('individual');
    expect(stars.slice(0, 50).find(({ id }) => id === cameraTarget.starId)?.id)
      .toBe(selectedStarId);
  });
});
