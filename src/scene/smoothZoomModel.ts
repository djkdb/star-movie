/**
 * Rubber-band wheel zoom model. OrbitControls applies each wheel tick as an
 * instant dolly step, which reads as stuttering. Instead, wheel input only
 * moves a *target* distance; every frame the actual camera distance eases
 * toward that target with an exponential (frame-rate independent) response,
 * so zooming feels like stretching and releasing a rubber band.
 */

export const SMOOTH_ZOOM_MIN_DISTANCE = 3;
/** Multiplier exponent per wheel deltaY unit; ~100 deltaY ≈ ×0.86 step. */
export const SMOOTH_ZOOM_WHEEL_SENSITIVITY = 0.0015;
/** Exponential response rate (1/s). Higher = snappier, lower = floatier. */
export const SMOOTH_ZOOM_RESPONSE = 5.5;
/** Relative gap under which the zoom is considered settled. */
export const SMOOTH_ZOOM_SETTLE_RATIO = 0.001;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
}

/**
 * Applies one wheel tick to the target distance. Positive deltaY (scroll
 * down) zooms out multiplicatively; the result is clamped to the allowed
 * distance range so the band can never stretch out of bounds.
 */
export function applyWheelToZoomTarget(
  targetDistance: number,
  deltaY: number,
  minDistance: number = SMOOTH_ZOOM_MIN_DISTANCE,
  maxDistance: number = Number.POSITIVE_INFINITY,
): number {
  assertFinite(targetDistance, 'targetDistance');
  assertFinite(deltaY, 'deltaY');
  const next = targetDistance * Math.exp(deltaY * SMOOTH_ZOOM_WHEEL_SENSITIVITY);
  return Math.min(maxDistance, Math.max(minDistance, next));
}

export interface ZoomDistanceSample {
  distance: number;
  settled: boolean;
}

/**
 * Eases the current distance toward the target using an exponential decay,
 * so two 1/120s steps land exactly where one 1/60s step would. Reports
 * `settled` once the remaining gap is negligible, letting callers release
 * control back to other camera systems.
 */
export function dampZoomDistance(
  currentDistance: number,
  targetDistance: number,
  deltaSeconds: number,
  response: number = SMOOTH_ZOOM_RESPONSE,
): ZoomDistanceSample {
  assertFinite(currentDistance, 'currentDistance');
  assertFinite(targetDistance, 'targetDistance');
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('deltaSeconds must be a non-negative finite number');
  }

  const blend = 1 - Math.exp(-response * deltaSeconds);
  const next = currentDistance + (targetDistance - currentDistance) * blend;
  const settled =
    Math.abs(next - targetDistance)
    <= SMOOTH_ZOOM_SETTLE_RATIO * Math.max(1, Math.abs(targetDistance));
  return { distance: settled ? targetDistance : next, settled };
}
