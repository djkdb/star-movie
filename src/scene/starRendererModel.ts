import type { InstancedMesh, Object3D, Color } from 'three';

import type { Rating, Star, Vec3 } from '../domain/models';
import {
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_OSCILLATION_AMPLITUDE,
  STAR_OSCILLATION_PERIOD_SECONDS,
  STAR_ROTATION_RADIANS_PER_SECOND,
} from './starVisualModel';

export const INDIVIDUAL_STAR_LIMIT = 50;
export const RATING_BUCKET_ORDER: readonly Rating[] = [1, 2, 3, 4, 5];

export type StarRenderMode = 'individual' | 'instanced';

export interface InstancedStarBucket {
  rating: Rating;
  stars: readonly Star[];
  phases: readonly number[];
  instanceIdToStarId: readonly string[];
}

export interface StarInstanceTransform {
  position: Vec3;
  rotationY: number;
  scale: number;
}

export function getStarRenderMode(activeWorkCount: number): StarRenderMode {
  if (!Number.isInteger(activeWorkCount) || activeWorkCount < 0) {
    throw new RangeError('activeWorkCount must be a non-negative integer');
  }
  return activeWorkCount <= INDIVIDUAL_STAR_LIMIT ? 'individual' : 'instanced';
}

/** Stable phase derived only from identity, so collection reordering cannot move a Star. */
export function getStarInstancePhase(starId: string): number {
  if (starId.length === 0) throw new RangeError('starId must not be empty');

  let hash = 0x811c9dc5;
  for (let index = 0; index < starId.length; index += 1) {
    hash ^= starId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

/** Builds at most five stable rating buckets and their raycast reverse lookup tables. */
export function createInstancedStarBuckets(
  stars: readonly Star[],
): readonly InstancedStarBucket[] {
  const starsByRating = new Map<Rating, Star[]>(
    RATING_BUCKET_ORDER.map((rating) => [rating, []]),
  );
  for (const star of stars) starsByRating.get(star.rating)!.push(star);

  return RATING_BUCKET_ORDER.flatMap((rating) => {
    const bucketStars = starsByRating.get(rating)!;
    if (bucketStars.length === 0) return [];
    return [{
      rating,
      stars: bucketStars,
      phases: bucketStars.map(({ id }) => getStarInstancePhase(id)),
      instanceIdToStarId: bucketStars.map(({ id }) => id),
    }];
  });
}

export function resolveStarIdFromInstance(
  instanceIdToStarId: readonly string[],
  instanceId: number | undefined,
): string | null {
  if (instanceId === undefined || !Number.isInteger(instanceId) || instanceId < 0) {
    return null;
  }
  return instanceIdToStarId[instanceId] ?? null;
}

/** Samples the per-instance matrix inputs from the shared visibility-aware clock. */
export function sampleStarInstanceTransform(
  star: Star,
  elapsedVisibleSeconds: number,
  phaseRadians: number,
  hovered: boolean,
): StarInstanceTransform {
  if (!Number.isFinite(elapsedVisibleSeconds) || elapsedVisibleSeconds < 0) {
    throw new RangeError('elapsedVisibleSeconds must be a non-negative finite number');
  }
  if (!Number.isFinite(phaseRadians)) {
    throw new RangeError('phaseRadians must be finite');
  }

  return {
    position: {
      x: star.position.x,
      y:
        star.position.y
        + STAR_OSCILLATION_AMPLITUDE
          * Math.sin(
            (elapsedVisibleSeconds / STAR_OSCILLATION_PERIOD_SECONDS) * Math.PI * 2
              + phaseRadians,
          ),
      z: star.position.z,
    },
    rotationY: elapsedVisibleSeconds * STAR_ROTATION_RADIANS_PER_SECOND,
    scale: hovered ? STAR_HOVER_SCALE : STAR_IDLE_SCALE,
  };
}

/** Writes the current visibility-clock frame into one rating bucket without React allocations. */
export function updateInstancedStarMatrices(
  mesh: InstancedMesh,
  bucket: InstancedStarBucket,
  elapsedVisibleSeconds: number,
  hoveredStarId: string | null,
  temporaryObject: Object3D,
): void {
  bucket.stars.forEach((star, instanceId) => {
    const transform = sampleStarInstanceTransform(
      star,
      elapsedVisibleSeconds,
      bucket.phases[instanceId]!,
      hoveredStarId === star.id,
    );
    temporaryObject.position.set(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    );
    temporaryObject.rotation.set(0, transform.rotationY, 0);
    temporaryObject.scale.setScalar(transform.scale);
    temporaryObject.updateMatrix();
    mesh.setMatrixAt(instanceId, temporaryObject.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/** Writes the bucket color in instanceId order so color and raycast mappings stay aligned. */
export function updateInstancedStarColors(
  mesh: InstancedMesh,
  bucket: InstancedStarBucket,
  color: Color,
): void {
  bucket.stars.forEach((_, instanceId) => mesh.setColorAt(instanceId, color));
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
}
