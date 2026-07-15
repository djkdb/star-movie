import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { Constellation, Star } from '../domain/models';
import {
  CAMERA_FOCUS_DURATION_SECONDS,
  CONSTELLATION_FIT_REJECTION_REASON,
  CameraTweenController,
  calculateBoundingBoxFitPose,
  calculateStarFocusPose,
  cubicEaseInOut,
  resolveCameraFocusRequest,
  type CameraPose,
} from './cameraMath';

function createStar(id: string, x: number, y: number, z: number): Star {
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
    position: { x, y, z },
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

const initialPose: CameraPose = {
  position: { x: 0, y: 0, z: 20 },
  target: { x: 0, y: 0, z: 0 },
};

describe('Camera focus math', () => {
  it('R4.1/R7.6 focuses a Star along the current view offset', () => {
    expect(calculateStarFocusPose(initialPose, { x: 4, y: -2, z: 3 })).toEqual({
      position: { x: 4, y: -2, z: 11 },
      target: { x: 4, y: -2, z: 3 },
    });
  });

  it('R4.1/R7.6 uses cubic interpolation and completes at exactly 0.7 seconds', () => {
    const destination: CameraPose = {
      position: { x: 10, y: 20, z: 30 },
      target: { x: 2, y: 4, z: 6 },
    };
    const controller = new CameraTweenController();
    controller.replace(initialPose, destination);

    expect(CAMERA_FOCUS_DURATION_SECONDS).toBe(0.7);
    expect(cubicEaseInOut(0)).toBe(0);
    expect(cubicEaseInOut(0.5)).toBe(0.5);
    expect(cubicEaseInOut(1)).toBe(1);
    expect(controller.advance(0.35)).toMatchObject({
      pose: {
        position: { x: 5, y: 10, z: 25 },
        target: { x: 1, y: 2, z: 3 },
      },
      completed: false,
    });
    expect(controller.advance(0.35)).toEqual({
      pose: destination,
      completed: true,
    });
    expect(controller.isActive).toBe(false);
  });

  it('safely replaces an in-flight tween with the newest request', () => {
    const controller = new CameraTweenController();
    controller.replace(initialPose, {
      position: { x: 100, y: 0, z: 20 },
      target: { x: 100, y: 0, z: 0 },
    });
    const interrupted = controller.advance(0.2);
    expect(interrupted).not.toBeNull();

    const replacementStart = interrupted!.pose;
    const replacementEnd: CameraPose = {
      position: { x: -10, y: 5, z: 12 },
      target: { x: -10, y: 5, z: 4 },
    };
    controller.replace(replacementStart, replacementEnd);

    expect(controller.advance(0)).toEqual({
      pose: replacementStart,
      completed: false,
    });
    expect(controller.advance(0.7)).toEqual({
      pose: replacementEnd,
      completed: true,
    });
  });

  it('R10.7 fits every active bounding-box corner inside the perspective frustum', () => {
    const points = [
      { x: -8, y: -2, z: -3 },
      { x: 6, y: 5, z: 4 },
      { x: 1, y: -4, z: 2 },
    ];
    const aspect = 16 / 9;
    const pose = calculateBoundingBoxFitPose(initialPose, points, 75, aspect);
    const camera = new PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const xs = [-8, 6];
    const ys = [-4, 5];
    const zs = [-3, 4];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const projected = new Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(1);
          expect(projected.z).toBeGreaterThanOrEqual(-1);
          expect(projected.z).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('R10.8 rejects fewer than two active references with a UI-ready reason', () => {
    const stars = [createStar('star-1', 0, 0, 0)];
    const constellations = [
      createConstellation('constellation-1', ['star-1', 'missing-star']),
    ];

    expect(resolveCameraFocusRequest(
      { type: 'constellation', constellationId: 'constellation-1' },
      stars,
      constellations,
    )).toEqual({
      ok: false,
      reason: CONSTELLATION_FIT_REJECTION_REASON,
    });
    expect(() => calculateBoundingBoxFitPose(initialPose, [stars[0]!.position], 75, 1))
      .toThrow(CONSTELLATION_FIT_REJECTION_REASON);
  });

  it('R10.7 resolves active references in constellation order', () => {
    const stars = [
      createStar('star-1', 1, 2, 3),
      createStar('star-2', 4, 5, 6),
    ];
    const resolution = resolveCameraFocusRequest(
      { type: 'constellation', constellationId: 'constellation-1' },
      stars,
      [createConstellation('constellation-1', ['star-2', 'missing', 'star-1'])],
    );

    expect(resolution).toEqual({
      ok: true,
      request: {
        type: 'constellation',
        constellationId: 'constellation-1',
        activePositions: [stars[1]!.position, stars[0]!.position],
      },
    });
  });
});
