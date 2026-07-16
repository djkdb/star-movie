import type { InstancedMesh, Object3D, Color } from 'three';

import type { Rating, Star } from '../domain/models';
import {
  getStarDisplayColor,
  sampleStarRenderTransform,
  type StarRenderTransform,
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

export type StarInstanceTransform = StarRenderTransform;

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

/**
 * Samples the per-instance matrix inputs from the shared visibility-aware
 * clock via the single transform shared with the individual renderer, so both
 * paths drift identically (Requirement 1.6).
 */
export function sampleStarInstanceTransform(
  star: Star,
  elapsedVisibleSeconds: number,
  phaseRadians: number,
  hovered: boolean,
  reducedMotion: boolean,
): StarInstanceTransform {
  return sampleStarRenderTransform(
    star,
    elapsedVisibleSeconds,
    phaseRadians,
    hovered,
    reducedMotion,
  );
}

/** Writes the current visibility-clock frame into one rating bucket without React allocations. */
export function updateInstancedStarMatrices(
  mesh: InstancedMesh,
  bucket: InstancedStarBucket,
  elapsedVisibleSeconds: number,
  hoveredStarId: string | null,
  temporaryObject: Object3D,
  reducedMotion: boolean,
): void {
  bucket.stars.forEach((star, instanceId) => {
    const transform = sampleStarInstanceTransform(
      star,
      elapsedVisibleSeconds,
      bucket.phases[instanceId]!,
      hoveredStarId === star.id,
      reducedMotion,
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

/**
 * Writes per-star tints in instanceId order so color and raycast mappings stay
 * aligned. Each instance receives its identity-derived display color rather
 * than one shared bucket color; `scratchColor` is reused to avoid allocations.
 */
export function updateInstancedStarColors(
  mesh: InstancedMesh,
  bucket: InstancedStarBucket,
  scratchColor: Color,
): void {
  bucket.stars.forEach((star, instanceId) => {
    scratchColor.set(getStarDisplayColor(star.id, star.rating));
    mesh.setColorAt(instanceId, scratchColor);
  });
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
}
