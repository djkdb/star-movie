import type { CameraPose, CameraRequest, Constellation, Star, Vec3 } from '../domain/models';

/** Re-exported from the domain model so existing `./cameraMath` imports keep working. */
export type { CameraPose } from '../domain/models';

export const CAMERA_FOCUS_DURATION_SECONDS = 0.7;
export const STAR_FOCUS_DISTANCE = 8;
export const CONSTELLATION_FIT_PADDING = 1.15;
export const CONSTELLATION_FIT_REJECTION_REASON =
  '활성 작품이 2개 이상 필요합니다' as const;

const MINIMUM_FIT_DISTANCE = 2;
const VECTOR_EPSILON = 1e-9;

export type ResolvedCameraFocusRequest =
  | {
      type: 'star';
      starId: string;
      position: Vec3;
    }
  | {
      type: 'constellation';
      constellationId: string;
      activePositions: readonly Vec3[];
    };

export type CameraFocusResolution =
  | { ok: true; request: ResolvedCameraFocusRequest }
  | { ok: false; reason: string };

export interface CameraTweenSample {
  pose: CameraPose;
  completed: boolean;
}

interface ActiveCameraTween {
  from: CameraPose;
  to: CameraPose;
  durationSeconds: number;
  elapsedSeconds: number;
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function clonePose(value: CameraPose): CameraPose {
  return {
    position: cloneVec3(value.position),
    target: cloneVec3(value.target),
  };
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function add(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function scale(value: Vec3, scalar: number): Vec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function magnitude(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalizedViewOffset(pose: CameraPose): Vec3 {
  const offset = subtract(pose.position, pose.target);
  const length = magnitude(offset);
  if (length <= VECTOR_EPSILON) return { x: 0, y: 0, z: 1 };
  return scale(offset, 1 / length);
}

function assertFiniteVec3(value: Vec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError(`${label} must contain finite coordinates`);
  }
}

function interpolateVec3(from: Vec3, to: Vec3, amount: number): Vec3 {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

/** Symmetric cubic ease-in-out with exact endpoints. */
export function cubicEaseInOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped < 0.5
    ? 4 * clamped ** 3
    : 1 - ((-2 * clamped + 2) ** 3) / 2;
}

export function interpolateCameraPose(
  from: CameraPose,
  to: CameraPose,
  progress: number,
): CameraPose {
  const eased = cubicEaseInOut(progress);
  return {
    position: interpolateVec3(from.position, to.position, eased),
    target: interpolateVec3(from.target, to.target, eased),
  };
}

export function calculateStarFocusPose(
  currentPose: CameraPose,
  starPosition: Vec3,
  focusDistance = STAR_FOCUS_DISTANCE,
): CameraPose {
  assertFiniteVec3(currentPose.position, 'camera position');
  assertFiniteVec3(currentPose.target, 'camera target');
  assertFiniteVec3(starPosition, 'star position');
  if (!Number.isFinite(focusDistance) || focusDistance <= 0) {
    throw new RangeError('focusDistance must be a positive finite number');
  }

  const direction = normalizedViewOffset(currentPose);
  return {
    position: add(starPosition, scale(direction, focusDistance)),
    target: cloneVec3(starPosition),
  };
}

export function calculateBoundingBoxFitPose(
  currentPose: CameraPose,
  positions: readonly Vec3[],
  verticalFovDegrees: number,
  aspect: number,
  padding = CONSTELLATION_FIT_PADDING,
): CameraPose {
  if (positions.length < 2) {
    throw new RangeError(CONSTELLATION_FIT_REJECTION_REASON);
  }
  if (
    !Number.isFinite(verticalFovDegrees)
    || verticalFovDegrees <= 0
    || verticalFovDegrees >= 180
  ) {
    throw new RangeError('verticalFovDegrees must be between 0 and 180');
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('aspect must be a positive finite number');
  }
  if (!Number.isFinite(padding) || padding < 1) {
    throw new RangeError('padding must be a finite number greater than or equal to 1');
  }

  assertFiniteVec3(currentPose.position, 'camera position');
  assertFiniteVec3(currentPose.target, 'camera target');

  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;

  for (const position of positions) {
    assertFiniteVec3(position, 'constellation position');
    minimumX = Math.min(minimumX, position.x);
    minimumY = Math.min(minimumY, position.y);
    minimumZ = Math.min(minimumZ, position.z);
    maximumX = Math.max(maximumX, position.x);
    maximumY = Math.max(maximumY, position.y);
    maximumZ = Math.max(maximumZ, position.z);
  }

  const center: Vec3 = {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
    z: (minimumZ + maximumZ) / 2,
  };
  const halfDiagonal = Math.hypot(
    (maximumX - minimumX) / 2,
    (maximumY - minimumY) / 2,
    (maximumZ - minimumZ) / 2,
  );
  const verticalHalfFov = (verticalFovDegrees * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const distance = Math.max(
    MINIMUM_FIT_DISTANCE,
    (halfDiagonal * padding) / Math.sin(limitingHalfFov),
  );
  const direction = normalizedViewOffset(currentPose);

  return {
    position: add(center, scale(direction, distance)),
    target: center,
  };
}

export function resolveCameraFocusRequest(
  request: CameraRequest,
  stars: readonly Star[],
  constellations: readonly Constellation[],
): CameraFocusResolution {
  const starsById = new Map(stars.map((star) => [star.id, star] as const));

  if (request.type === 'star') {
    const star = starsById.get(request.starId);
    return star === undefined
      ? { ok: false, reason: '선택한 작품을 찾을 수 없습니다' }
      : {
          ok: true,
          request: {
            type: 'star',
            starId: star.id,
            position: cloneVec3(star.position),
          },
        };
  }

  if (request.type !== 'constellation') {
    // Free-viewpoint returns carry their own resolved pose and never reach here.
    return { ok: false, reason: '해석할 수 없는 카메라 요청입니다' };
  }

  const constellation = constellations.find(({ id }) => id === request.constellationId);
  if (constellation === undefined) {
    return { ok: false, reason: '별자리를 찾을 수 없습니다' };
  }

  const seenIds = new Set<string>();
  const activePositions = constellation.starIds.flatMap((starId) => {
    if (seenIds.has(starId)) return [];
    seenIds.add(starId);
    const star = starsById.get(starId);
    return star === undefined ? [] : [cloneVec3(star.position)];
  });

  return activePositions.length < 2
    ? { ok: false, reason: CONSTELLATION_FIT_REJECTION_REASON }
    : {
        ok: true,
        request: {
          type: 'constellation',
          constellationId: constellation.id,
          activePositions,
        },
      };
}

/** Frame-driven tween state; replace() atomically discards any previous tween. */
export class CameraTweenController {
  private activeTween: ActiveCameraTween | null = null;

  get isActive(): boolean {
    return this.activeTween !== null;
  }

  replace(
    from: CameraPose,
    to: CameraPose,
    durationSeconds = CAMERA_FOCUS_DURATION_SECONDS,
  ): void {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError('durationSeconds must be a positive finite number');
    }
    this.activeTween = {
      from: clonePose(from),
      to: clonePose(to),
      durationSeconds,
      elapsedSeconds: 0,
    };
  }

  cancel(): void {
    this.activeTween = null;
  }

  advance(deltaSeconds: number): CameraTweenSample | null {
    if (this.activeTween === null) return null;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be a non-negative finite number');
    }

    this.activeTween.elapsedSeconds = Math.min(
      this.activeTween.durationSeconds,
      this.activeTween.elapsedSeconds + deltaSeconds,
    );
    const progress = this.activeTween.elapsedSeconds / this.activeTween.durationSeconds;
    const completed = progress >= 1;
    const pose = completed
      ? clonePose(this.activeTween.to)
      : interpolateCameraPose(
          this.activeTween.from,
          this.activeTween.to,
          progress,
        );
    if (completed) this.activeTween = null;
    return { pose, completed };
  }
}
