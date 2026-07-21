import { TOUCH } from 'three';

/** One-finger rotation plus two-finger pinch zoom (with pan) for touch viewports. */
export const ORBIT_TOUCH_GESTURES = Object.freeze({
  ONE: TOUCH.ROTATE,
  TWO: TOUCH.DOLLY_PAN,
});

/**
 * How far panning may carry the camera's focus point from the archive's
 * heart. Without this bound, two-finger panning drifts the target — and the
 * camera with it — out of the starry universe entirely.
 */
export const CAMERA_TARGET_MAX_RADIUS = 60;

export interface TrackballSpeeds {
  rotate: number;
  zoom: number;
  pan: number;
}

/**
 * Gesture speeds per pointer kind. Touch gets a much gentler tuning: the
 * desktop speeds made a phone swipe spin the whole sky and a small pinch
 * fly out of the universe.
 */
export function getTrackballSpeeds(coarsePointer: boolean): TrackballSpeeds {
  return coarsePointer
    ? { rotate: 1.1, zoom: 0.5, pan: 0.28 }
    : { rotate: 2.4, zoom: 1.2, pan: 0.8 };
}

/**
 * Clamps a focus-point distance back inside the target bound. Callers scale
 * their target vector by clamped/current when the current length exceeds it.
 */
export function clampTargetLength(length: number): number {
  if (!Number.isFinite(length) || length <= CAMERA_TARGET_MAX_RADIUS) {
    return Math.max(0, Number.isFinite(length) ? length : 0);
  }
  return CAMERA_TARGET_MAX_RADIUS;
}
