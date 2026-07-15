// Feature: space-movie-archive, Property 27: Active Constellation 카메라 fit
// **Validates: Requirements 10.7, 10.8**
import fc from 'fast-check';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { Constellation, Star, Vec3 } from '../../src/domain/models';
import {
  CONSTELLATION_FIT_REJECTION_REASON,
  calculateBoundingBoxFitPose,
  resolveCameraFocusRequest,
  type CameraPose,
} from '../../src/scene/cameraMath';

const VERTICAL_FOV_DEGREES = 75;
const PROJECTION_TOLERANCE = 1e-10;
const initialPose: CameraPose = {
  position: { x: 0, y: 0, z: 20 },
  target: { x: 0, y: 0, z: 0 },
};

const positionArbitrary = fc.record({
  x: fc.integer({ min: -100, max: 100 }),
  y: fc.integer({ min: -100, max: 100 }),
  z: fc.integer({ min: -100, max: 100 }),
});

const propertyInputArbitrary = fc.record({
  activePositions: fc.uniqueArray(positionArbitrary, {
    minLength: 2,
    maxLength: 20,
    selector: ({ x, y, z }) => `${x}:${y}:${z}`,
  }),
  viewportWidth: fc.integer({ min: 320, max: 3_840 }),
  viewportHeight: fc.integer({ min: 320, max: 2_160 }),
  rejectedActiveCount: fc.integer({ min: 0, max: 1 }),
});

function createStar(id: string, position: Vec3): Star {
  return {
    id,
    title: id,
    normalizedTitle: id,
    genre: 'SF',
    rating: 3,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function createConstellation(id: string, starIds: string[]): Constellation {
  return {
    id,
    name: id,
    starIds,
    color: '#ffffff',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function boundingBoxCorners(positions: readonly Vec3[]): Vec3[] {
  const xs = positions.map(({ x }) => x);
  const ys = positions.map(({ y }) => y);
  const zs = positions.map(({ z }) => z);
  const xBounds = [Math.min(...xs), Math.max(...xs)];
  const yBounds = [Math.min(...ys), Math.max(...ys)];
  const zBounds = [Math.min(...zs), Math.max(...zs)];

  return xBounds.flatMap((x) =>
    yBounds.flatMap((y) => zBounds.map((z) => ({ x, y, z }))),
  );
}

describe('Property 27: Active Constellation camera fit', () => {
  it('R10.7 R10.8 contains the active bounding box in the final frustum and rejects fewer than two active references', () => {
    fc.assert(
      fc.property(
        propertyInputArbitrary,
        ({
          activePositions,
          viewportWidth,
          viewportHeight,
          rejectedActiveCount,
        }) => {
          const aspect = viewportWidth / viewportHeight;
          const stars = activePositions.map((position, index) =>
            createStar(`active-star-${index}`, position),
          );
          const constellation = createConstellation(
            'active-constellation',
            stars.map(({ id }) => id),
          );
          const resolution = resolveCameraFocusRequest(
            { type: 'constellation', constellationId: constellation.id },
            stars,
            [constellation],
          );

          expect(resolution.ok).toBe(true);
          if (!resolution.ok || resolution.request.type !== 'constellation') {
            throw new Error('Expected an active constellation camera request');
          }

          const finalPose = calculateBoundingBoxFitPose(
            initialPose,
            resolution.request.activePositions,
            VERTICAL_FOV_DEGREES,
            aspect,
          );
          const camera = new PerspectiveCamera(
            VERTICAL_FOV_DEGREES,
            aspect,
            0.01,
            10_000,
          );
          camera.position.set(
            finalPose.position.x,
            finalPose.position.y,
            finalPose.position.z,
          );
          camera.lookAt(finalPose.target.x, finalPose.target.y, finalPose.target.z);
          camera.updateMatrixWorld(true);
          camera.updateProjectionMatrix();

          for (const corner of boundingBoxCorners(resolution.request.activePositions)) {
            const projected = new Vector3(corner.x, corner.y, corner.z).project(camera);
            expect(projected.x).toBeGreaterThanOrEqual(-1 - PROJECTION_TOLERANCE);
            expect(projected.x).toBeLessThanOrEqual(1 + PROJECTION_TOLERANCE);
            expect(projected.y).toBeGreaterThanOrEqual(-1 - PROJECTION_TOLERANCE);
            expect(projected.y).toBeLessThanOrEqual(1 + PROJECTION_TOLERANCE);
            expect(projected.z).toBeGreaterThanOrEqual(-1 - PROJECTION_TOLERANCE);
            expect(projected.z).toBeLessThanOrEqual(1 + PROJECTION_TOLERANCE);
          }

          const rejectedStars = stars.slice(0, rejectedActiveCount);
          const rejectedConstellation = createConstellation(
            'inactive-constellation',
            [
              ...rejectedStars.map(({ id }) => id),
              'missing-star-1',
              'missing-star-2',
            ],
          );
          expect(resolveCameraFocusRequest(
            {
              type: 'constellation',
              constellationId: rejectedConstellation.id,
            },
            rejectedStars,
            [rejectedConstellation],
          )).toEqual({
            ok: false,
            reason: CONSTELLATION_FIT_REJECTION_REASON,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
