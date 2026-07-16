import type { Constellation, Star, Vec3 } from '../domain/models';
import { getStarInstancePhase } from './starRendererModel';
import { sampleStarDriftOffset } from './starVisualModel';

export const CONSTELLATION_IDLE_OPACITY = 0.5;
export const CONSTELLATION_HOVER_OPACITY = 1;
export const CONSTELLATION_NAME_FADE_SECONDS = 0.3;

export type LinePoint = [number, number, number];

export interface ConstellationLineViewModel {
  id: string;
  name: string;
  color: string;
  points: LinePoint[];
  activeStarIds: string[];
  labelPosition: LinePoint;
}

function toPoint(position: Vec3): LinePoint {
  return [position.x, position.y, position.z];
}

function findActiveStarsInOrder(
  starIds: readonly string[],
  starsById: ReadonlyMap<string, Star>,
): Star[] {
  return starIds.flatMap((starId) => {
    const star = starsById.get(starId);
    return star === undefined ? [] : [star];
  });
}

export function calculateConstellationLabelPosition(
  points: readonly LinePoint[],
): LinePoint {
  if (points.length === 0) return [0, 0, 0];
  const middleIndex = Math.floor((points.length - 1) / 2);
  const left = points[middleIndex]!;
  const right = points[Math.min(middleIndex + 1, points.length - 1)]!;
  return [
    (left[0] + right[0]) / 2,
    (left[1] + right[1]) / 2,
    (left[2] + right[2]) / 2,
  ];
}

/** Builds only drawable constellations, preserving each stored reference order. */
export function createConstellationLineViewModels(
  constellations: readonly Constellation[],
  stars: readonly Star[],
): ConstellationLineViewModel[] {
  const starsById = new Map(stars.map((star) => [star.id, star]));

  return constellations.flatMap((constellation) => {
    const activeStars = findActiveStarsInOrder(constellation.starIds, starsById);
    if (activeStars.length < 2) return [];
    const points = activeStars.map(({ position }) => toPoint(position));
    return [{
      id: constellation.id,
      name: constellation.name,
      color: constellation.color,
      points,
      activeStarIds: activeStars.map(({ id }) => id),
      labelPosition: calculateConstellationLabelPosition(points),
    }];
  });
}

/**
 * Recomputes constellation line endpoints with the current drift applied, using
 * the exact same `base + sampleStarDriftOffset(elapsed, getStarInstancePhase(id))`
 * formula as the star renderers so endpoints and stars can never diverge
 * (Requirements 2.1, 2.3). Under reduced motion the base positions are returned.
 */
export function sampleConstellationLinePoints(
  activeStars: readonly Star[],
  elapsedVisibleSeconds: number,
  reducedMotion: boolean,
): LinePoint[] {
  return activeStars.map((star) => {
    if (reducedMotion) return toPoint(star.position);
    const offset = sampleStarDriftOffset(
      elapsedVisibleSeconds,
      getStarInstancePhase(star.id),
    );
    return [
      star.position.x + offset.x,
      star.position.y + offset.y,
      star.position.z + offset.z,
    ];
  });
}

/** Resolves the current draft against active works and suppresses one-node previews. */
export function createConstellationDraftPreviewPoints(
  draftStarIds: readonly string[],
  stars: readonly Star[],
): LinePoint[] {
  const starsById = new Map(stars.map((star) => [star.id, star]));
  const points = findActiveStarsInOrder(draftStarIds, starsById)
    .map(({ position }) => toPoint(position));
  return points.length >= 2 ? points : [];
}
