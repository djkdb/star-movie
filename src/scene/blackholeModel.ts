import type { RuntimeEvent, Vec3 } from '../domain/models';
import type { StarDragPayload } from './starVisualModel';

export const BLACKHOLE_POSITION: Vec3 = Object.freeze({ x: 0, y: -18, z: -25 });
export const BLACKHOLE_CORE_RADIUS = 3;
export const BLACKHOLE_DISK_INNER_RADIUS = 3.4;
export const BLACKHOLE_DISK_OUTER_RADIUS = 7;
export const BLACKHOLE_DISTORTION_RADIUS = 9;
export const BLACKHOLE_DISTORTION_MAX_STRENGTH = 0.18;
export const BLACKHOLE_DROP_DEPTH = 3;
export const BLACKHOLE_ROTATION_RADIANS_PER_SECOND = Math.PI / 5;
export const BLACKHOLE_SPIRAL_DURATION_SECONDS = 1.2;
export const BLACKHOLE_SPIRAL_TURNS = 2;
export const BLACKHOLE_RESTORE_DURATION_SECONDS = 0.65;

export interface BlackholeEffectDescriptor {
  eventId: string;
  kind: 'soft-delete-spiral' | 'restore-pulse';
  starId: string;
  sourcePosition: Vec3;
  durationSeconds: number;
}

export function getBlackholeRotation(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('elapsedSeconds must be a non-negative finite number');
  }
  return elapsedSeconds * BLACKHOLE_ROTATION_RADIANS_PER_SECOND;
}

/** Visual growth per archived work and the ceiling the hole can reach. */
export const BLACKHOLE_MASS_SCALE_PER_WORK = 0.035;
export const BLACKHOLE_MAX_MASS_SCALE = 1.6;

/**
 * The black hole's rendered size grows with everything it has swallowed —
 * each archived work adds a sliver of "mass" up to a bounded ceiling, so a
 * long-lived archive reads as a visibly heavier black hole.
 */
export function getBlackholeMassScale(archivedCount: number): number {
  if (!Number.isFinite(archivedCount) || archivedCount <= 0) return 1;
  return Math.min(
    BLACKHOLE_MAX_MASS_SCALE,
    1 + Math.floor(archivedCount) * BLACKHOLE_MASS_SCALE_PER_WORK,
  );
}

/** Ember orbit band, relative to the billboard's unit half-size (10 world units). */
export const EMBER_ORBIT_MIN_RADIUS = 4.4;
export const EMBER_ORBIT_MAX_RADIUS = 7.6;
export const EMBER_MIN_ANGULAR_SPEED = 0.12;
export const EMBER_MAX_ANGULAR_SPEED = 0.34;

export interface ArchivedEmberOrbit {
  radius: number;
  angularSpeedRadiansPerSecond: number;
  phaseRadians: number;
  size: number;
}

function hashEmberSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic orbit for an archived work circling the accretion disk. The
 * same work always keeps the same orbit, so the ring of embers is stable
 * across sessions and only changes when works enter or leave the archive.
 */
export function getArchivedEmberOrbit(workId: string): ArchivedEmberOrbit {
  if (workId.length === 0) throw new RangeError('workId must not be empty');
  const hash = hashEmberSeed(workId);
  const radiusUnit = (hash & 0xffff) / 0xffff;
  const speedUnit = ((hash >>> 16) & 0xff) / 0xff;
  const phaseUnit = ((hash >>> 24) & 0xff) / 0xff;
  return {
    radius:
      EMBER_ORBIT_MIN_RADIUS
      + radiusUnit * (EMBER_ORBIT_MAX_RADIUS - EMBER_ORBIT_MIN_RADIUS),
    angularSpeedRadiansPerSecond:
      EMBER_MIN_ANGULAR_SPEED
      + speedUnit * (EMBER_MAX_ANGULAR_SPEED - EMBER_MIN_ANGULAR_SPEED),
    phaseRadians: phaseUnit * Math.PI * 2,
    size: 0.8 + radiusUnit * 0.5,
  };
}

/** Returns a finite radial lens strength and zero outside the halo boundary. */
export function getBoundedLightDistortion(distanceFromCenter: number): number {
  if (!Number.isFinite(distanceFromCenter) || distanceFromCenter < 0) return 0;
  if (distanceFromCenter >= BLACKHOLE_DISTORTION_RADIUS) return 0;

  const innerBoundary = BLACKHOLE_CORE_RADIUS;
  if (distanceFromCenter <= innerBoundary) return 0;
  const normalized =
    (distanceFromCenter - innerBoundary)
    / (BLACKHOLE_DISTORTION_RADIUS - innerBoundary);
  return BLACKHOLE_DISTORTION_MAX_STRENGTH * Math.sin(normalized * Math.PI);
}

/** World-space drop test matching the visible disk/halo footprint. */
export function isBlackholeDropHit(point: Vec3): boolean {
  const radialDistance = Math.hypot(
    point.x - BLACKHOLE_POSITION.x,
    point.y - BLACKHOLE_POSITION.y,
  );
  const depthDistance = Math.abs(point.z - BLACKHOLE_POSITION.z);
  return radialDistance <= BLACKHOLE_DISTORTION_RADIUS
    && depthDistance <= BLACKHOLE_DROP_DEPTH;
}

export function isValidBlackholeDragPayload(
  payload: StarDragPayload | null | undefined,
): payload is StarDragPayload {
  return payload?.type === 'star' && payload.starId.trim().length > 0;
}

function readEventPosition(event: RuntimeEvent): Vec3 | null {
  const position = event.payload.position;
  if (typeof position !== 'object' || position === null) return null;
  const candidate = position as Partial<Record<keyof Vec3, unknown>>;
  if (
    typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
    || typeof candidate.z !== 'number'
    || !Number.isFinite(candidate.x)
    || !Number.isFinite(candidate.y)
    || !Number.isFinite(candidate.z)
  ) return null;
  return { x: candidate.x, y: candidate.y, z: candidate.z };
}

/** Maps only committed blackhole operations; failed commands never create these events. */
export function getBlackholeEffectDescriptor(
  event: RuntimeEvent,
): BlackholeEffectDescriptor | null {
  const starId = event.payload.starId;
  const sourcePosition = readEventPosition(event);
  if (typeof starId !== 'string' || sourcePosition === null) return null;

  if (event.type === 'work-soft-deleted') {
    const particleEffects = event.payload.particleEffects;
    if (!Array.isArray(particleEffects) || !particleEffects.includes('blackhole-spiral')) {
      return null;
    }
    return {
      eventId: event.id,
      kind: 'soft-delete-spiral',
      starId,
      sourcePosition,
      durationSeconds: BLACKHOLE_SPIRAL_DURATION_SECONDS,
    };
  }
  if (event.type === 'work-restored') {
    return {
      eventId: event.id,
      kind: 'restore-pulse',
      starId,
      sourcePosition,
      durationSeconds: BLACKHOLE_RESTORE_DURATION_SECONDS,
    };
  }
  return null;
}

/** Filters already handled IDs so React retries cannot replay a success effect. */
export function collectPendingBlackholeEffects(
  events: readonly RuntimeEvent[],
  handledEventIds: ReadonlySet<string>,
): BlackholeEffectDescriptor[] {
  const pending: BlackholeEffectDescriptor[] = [];
  const seen = new Set(handledEventIds);
  for (const event of events) {
    if (seen.has(event.id)) continue;
    const effect = getBlackholeEffectDescriptor(event);
    if (effect === null) continue;
    seen.add(event.id);
    pending.push(effect);
  }
  return pending;
}
