import type { Vec3 } from '../domain/models';
import type { CameraPose } from './cameraMath';
import { SPACE_CAMERA_FOV } from './backgroundModel';

/**
 * Opening arrival flight: the viewer rides in from deep space and settles at
 * the home framing. It is a first-person ride rather than a ship model on
 * screen — a low-poly rocket would clash with the raymarched sky, and the
 * archive's premise is that this is *your* universe you are flying into.
 *
 * Speed is sold three ways at once: a long dolly that punches through the
 * backdrop star shell (radius ~380-620), a lateral arc so the move reads as
 * piloted instead of a zoom, and a wide field of view that narrows as you
 * slow down.
 */
export const ARRIVAL_DURATION_SECONDS = 2.6;

/**
 * Distance the flight starts from the home target. Sits inside the near
 * backdrop shell so those stars sweep past the camera on the way in, and
 * stays well under SPACE_CAMERA_MAX_DISTANCE.
 */
export const ARRIVAL_START_DISTANCE = 640;

/** Extra degrees of field of view at the start, eased back to normal. */
export const ARRIVAL_FOV_BOOST = 26;

/** Lateral swing, in world units, applied at the midpoint of the flight. */
export const ARRIVAL_ARC: Vec3 = Object.freeze({ x: 64, y: 38, z: 0 });

export interface ArrivalFlightSample {
  pose: CameraPose;
  fov: number;
  completed: boolean;
}

/**
 * Quintic ease-out: leaves at speed and settles softly, which is what makes
 * the arrival feel like braking into orbit rather than a linear zoom.
 */
export function easeOutQuint(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) ** 5;
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function lerp(from: Vec3, to: Vec3, amount: number): Vec3 {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

/**
 * Where the flight begins: straight back along the home view axis at
 * ARRIVAL_START_DISTANCE, so any home pose produces a sensible approach.
 */
export function calculateArrivalStartPose(homePose: CameraPose): CameraPose {
  const offset = subtract(homePose.position, homePose.target);
  const length = Math.hypot(offset.x, offset.y, offset.z);
  const direction = length <= 1e-9
    ? { x: 0, y: 0, z: 1 }
    : { x: offset.x / length, y: offset.y / length, z: offset.z / length };

  return {
    position: {
      x: homePose.target.x + direction.x * ARRIVAL_START_DISTANCE,
      y: homePose.target.y + direction.y * ARRIVAL_START_DISTANCE,
      z: homePose.target.z + direction.z * ARRIVAL_START_DISTANCE,
    },
    // Aim slightly off the home target so the view swings as it arrives.
    target: {
      x: homePose.target.x - ARRIVAL_ARC.x * 0.35,
      y: homePose.target.y - ARRIVAL_ARC.y * 0.35,
      z: homePose.target.z,
    },
  };
}

/**
 * Samples the flight at `elapsedSeconds`. Always lands exactly on `homePose`
 * with the normal field of view once the duration is spent, so handing control
 * back to the trackball never snaps.
 */
export function sampleArrivalFlight(
  elapsedSeconds: number,
  homePose: CameraPose,
  durationSeconds = ARRIVAL_DURATION_SECONDS,
): ArrivalFlightSample {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('elapsedSeconds must be a non-negative finite number');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError('durationSeconds must be a positive finite number');
  }

  const progress = Math.min(1, elapsedSeconds / durationSeconds);
  if (progress >= 1) {
    return {
      pose: {
        position: { ...homePose.position },
        target: { ...homePose.target },
      },
      fov: SPACE_CAMERA_FOV,
      completed: true,
    };
  }

  const eased = easeOutQuint(progress);
  const start = calculateArrivalStartPose(homePose);
  const swing = Math.sin(Math.PI * eased);
  const straight = lerp(start.position, homePose.position, eased);

  return {
    pose: {
      position: {
        x: straight.x + ARRIVAL_ARC.x * swing,
        y: straight.y + ARRIVAL_ARC.y * swing,
        z: straight.z + ARRIVAL_ARC.z * swing,
      },
      target: lerp(start.target, homePose.target, eased),
    },
    fov: SPACE_CAMERA_FOV + ARRIVAL_FOV_BOOST * (1 - eased),
    completed: false,
  };
}
