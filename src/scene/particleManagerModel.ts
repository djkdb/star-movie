import type { RuntimeEvent, Vec3 } from '../domain/models';

export const FIREWORK_PARTICLE_RANGE = [90, 150] as const;
export const FIREWORK_DURATION_SECONDS = 2.4;
export const FIREWORK_MAX_BURSTS = 6;

/** Default spark color when a firework carries no genre tint. */
export const DEFAULT_FIREWORK_COLOR = '#ffe27a';

/**
 * Genre → firework tint, mirroring each genre galaxy's primary color so a burst
 * instantly reads as "another SF work", "another romance", and so on.
 */
export const GENRE_FIREWORK_COLORS: Readonly<Record<string, string>> = {
  SF: '#3B82F6',
  로맨스: '#F472B6',
  스릴러: '#DC2626',
  드라마: '#F59E0B',
  애니: '#A855F7',
  코미디: '#FDE047',
  액션: '#F97316',
  기타: '#14B8A6',
};

/** More works in a genre → a grander, multi-shell burst, capped for sanity. */
export function fireworkBurstCount(genreCount: number): number {
  if (!Number.isFinite(genreCount) || genreCount < 1) return 1;
  return Math.min(FIREWORK_MAX_BURSTS, 1 + Math.floor((genreCount - 1) / 2));
}

/** Total shell budget for the whole-archive "personal show" across genres. */
export const PERSONAL_SHOW_MAX_TOTAL_BURSTS = 20;
/** Longer window so staggered show shells finish their full fade. */
export const PERSONAL_SHOW_DURATION_SECONDS = 3.6;

/**
 * Shell counts for the personal show: every genre with at least one star gets
 * a shell group sized by its count, then the largest groups shed shells until
 * the total fits the global budget (each genre always keeps one).
 */
export function personalShowBurstCounts(
  genreCounts: readonly number[],
): number[] {
  const bursts = genreCounts.map((count) =>
    Number.isFinite(count) && count >= 1
      ? Math.min(FIREWORK_MAX_BURSTS, 1 + Math.floor(count / 2))
      : 1,
  );
  let total = bursts.reduce((sum, value) => sum + value, 0);
  while (total > PERSONAL_SHOW_MAX_TOTAL_BURSTS) {
    let largestIndex = 0;
    bursts.forEach((value, index) => {
      if (value > bursts[largestIndex]!) largestIndex = index;
    });
    if (bursts[largestIndex]! <= 1) break;
    bursts[largestIndex] = bursts[largestIndex]! - 1;
    total -= 1;
  }
  return bursts;
}
export const METEOR_SHOWER_TRAIL_RANGE = [2, 3] as const;
export const METEOR_SHOWER_DURATION_SECONDS = 1.5;
export const ASTEROID_DEBRIS_RANGE = [20, 40] as const;
export const ASTEROID_IMPACT_DURATION_SECONDS = 0.8;
export const BLACKHOLE_SPIRAL_DURATION_SECONDS = 1.2;
export const BLACKHOLE_SPIRAL_ROTATIONS = 2;
export const BACKGROUND_METEOR_INTERVAL_SECONDS = [15, 40] as const;
export const BACKGROUND_METEOR_DURATION_SECONDS = [0.5, 1] as const;

export type ParticleEffectKind =
  | 'fireworks'
  | 'meteor-shower'
  | 'asteroid-impact'
  | 'blackhole-spiral'
  | 'restore-pulse'
  | 'milestone-celebration'
  | 'achievement-celebration'
  | 'background-meteor';

export interface ParticleEffectDescriptor {
  id: string;
  sourceEventId: string;
  kind: ParticleEffectKind;
  origin: Vec3;
  particleCount: number;
  trailCount: number;
  durationSeconds: number;
  rotations: number;
  seed: number;
  scaleFrom: number;
  scaleTo: number;
  /** Hex tint for genre-colored fireworks; renderers fall back when absent. */
  color?: string;
  /** Number of simultaneous burst shells (grandeur), defaults to one. */
  burstCount?: number;
  /**
   * 'archive' marks a whole-archive celebration shell group: renderers spread
   * it across the entire visible sky instead of the work's own position.
   */
  celebrationScope?: 'single' | 'archive';
}

export interface ParticleTimer {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface DisposableEffectResource {
  dispose(): void;
}

export type EffectResourceKind = 'geometry' | 'material' | 'texture';

export interface DisposalDiagnostic {
  effectId: string;
  resourceKind: EffectResourceKind;
  attempts: 2;
  message: string;
  resource: DisposableEffectResource;
}

interface EffectRegistryEntry {
  resources: Array<{
    kind: EffectResourceKind;
    resource: DisposableEffectResource;
  }>;
  timers: Set<number>;
  animations: Set<() => void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns every imperative reference created for a running effect. */
export class EffectLifecycleRegistry {
  private readonly entries = new Map<string, EffectRegistryEntry>();
  private readonly quarantinedResources = new WeakSet<DisposableEffectResource>();
  private readonly diagnostics: DisposalDiagnostic[] = [];

  constructor(
    private readonly timer: ParticleTimer,
    private readonly reportDiagnostic: (diagnostic: DisposalDiagnostic) => void = () => undefined,
  ) {}

  open(effectId: string): void {
    if (!this.entries.has(effectId)) {
      this.entries.set(effectId, {
        resources: [],
        timers: new Set(),
        animations: new Set(),
      });
    }
  }

  addResource(
    effectId: string,
    resourceKind: EffectResourceKind,
    resource: DisposableEffectResource,
  ): boolean {
    if (this.quarantinedResources.has(resource)) return false;
    const entry = this.entries.get(effectId);
    if (entry === undefined) {
      this.disposeWithRetry(effectId, resourceKind, resource);
      return false;
    }
    if (entry.resources.some(({ resource: current }) => current === resource)) {
      return true;
    }
    entry.resources.push({ kind: resourceKind, resource });
    return true;
  }

  addTimer(effectId: string, timerId: number): void {
    this.entries.get(effectId)?.timers.add(timerId);
  }

  addAnimation(effectId: string, cancel: () => void): void {
    this.entries.get(effectId)?.animations.add(cancel);
  }

  cleanup(effectId: string): void {
    const entry = this.entries.get(effectId);
    if (entry === undefined) return;
    this.entries.delete(effectId);

    for (const timerId of entry.timers) this.timer.clearTimeout(timerId);
    entry.timers.clear();
    for (const cancel of entry.animations) {
      try {
        cancel();
      } catch {
        // A failed cancellation must not prevent owned GPU resources from being released.
      }
    }
    entry.animations.clear();
    for (const { kind, resource } of entry.resources) {
      this.disposeWithRetry(effectId, kind, resource);
    }
    entry.resources.length = 0;
  }

  cleanupAll(): void {
    for (const effectId of [...this.entries.keys()]) this.cleanup(effectId);
  }

  isQuarantined(resource: DisposableEffectResource): boolean {
    return this.quarantinedResources.has(resource);
  }

  getDisposalDiagnostics(): readonly DisposalDiagnostic[] {
    return this.diagnostics;
  }

  snapshot(): {
    effectCount: number;
    resourceCount: number;
    timerCount: number;
    animationCount: number;
    quarantineCount: number;
  } {
    let resourceCount = 0;
    let timerCount = 0;
    let animationCount = 0;
    for (const entry of this.entries.values()) {
      resourceCount += entry.resources.length;
      timerCount += entry.timers.size;
      animationCount += entry.animations.size;
    }
    return {
      effectCount: this.entries.size,
      resourceCount,
      timerCount,
      animationCount,
      quarantineCount: this.diagnostics.length,
    };
  }

  private disposeWithRetry(
    effectId: string,
    resourceKind: EffectResourceKind,
    resource: DisposableEffectResource,
  ): void {
    try {
      resource.dispose();
      return;
    } catch {
      // Requirement 11.10: retry immediately once before isolating the resource.
    }

    try {
      resource.dispose();
    } catch (error) {
      this.quarantinedResources.add(resource);
      const diagnostic: DisposalDiagnostic = {
        effectId,
        resourceKind,
        attempts: 2,
        message: errorMessage(error),
        resource,
      };
      this.diagnostics.push(diagnostic);
      this.reportDiagnostic(diagnostic);
    }
  }
}

function finiteUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999999, Math.max(0, value));
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + finiteUnit(random()) * (maximum - minimum);
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return Math.floor(randomBetween(random, minimum, maximum + 1));
}

function positionFromPayload(payload: Readonly<Record<string, unknown>>): Vec3 {
  const candidate = payload.position;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'x' in candidate &&
    'y' in candidate &&
    'z' in candidate &&
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    typeof candidate.z === 'number' &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.z)
  ) {
    return { x: candidate.x, y: candidate.y, z: candidate.z };
  }
  return { x: 0, y: 0, z: 0 };
}

function descriptor(
  event: RuntimeEvent,
  kind: ParticleEffectKind,
  index: number,
  random: () => number,
  values: Partial<Omit<ParticleEffectDescriptor, 'id' | 'sourceEventId' | 'kind' | 'origin' | 'seed'>>,
): ParticleEffectDescriptor {
  return {
    id: `${event.id}:${kind}:${index}`,
    sourceEventId: event.id,
    kind,
    origin: positionFromPayload(event.payload),
    particleCount: values.particleCount ?? 0,
    trailCount: values.trailCount ?? 0,
    durationSeconds: values.durationSeconds ?? 1,
    rotations: values.rotations ?? 0,
    seed: Math.floor(finiteUnit(random()) * 0x1_0000_0000) >>> 0,
    scaleFrom: values.scaleFrom ?? 1,
    scaleTo: values.scaleTo ?? 1,
    ...(values.color === undefined ? {} : { color: values.color }),
    ...(values.burstCount === undefined ? {} : { burstCount: values.burstCount }),
    ...(values.celebrationScope === undefined
      ? {}
      : { celebrationScope: values.celebrationScope }),
  };
}

/** Reads the whole-archive genre distribution, if the event carries one. */
function readGenreCounts(
  payload: Readonly<Record<string, unknown>>,
): ReadonlyArray<readonly [string, number]> | null {
  const counts = payload.genreCounts;
  if (typeof counts !== 'object' || counts === null) return null;
  const entries = Object.entries(counts).filter(
    (entry): entry is [string, number] =>
      entry[0] in GENRE_FIREWORK_COLORS
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
      && entry[1] >= 1,
  );
  return entries.length === 0 ? null : entries;
}

function readGenreColor(payload: Readonly<Record<string, unknown>>): string {
  const genre = payload.genre;
  if (typeof genre === 'string' && genre in GENRE_FIREWORK_COLORS) {
    return GENRE_FIREWORK_COLORS[genre] ?? DEFAULT_FIREWORK_COLOR;
  }
  return DEFAULT_FIREWORK_COLOR;
}

function readGenreCount(payload: Readonly<Record<string, unknown>>): number {
  const count = payload.genreCount;
  return typeof count === 'number' && Number.isFinite(count) && count >= 1
    ? Math.floor(count)
    : 1;
}

/** Quality overrides are cumulative and apply only to newly created effects. */
export interface ParticleEffectQualityOptions {
  minimumCounts?: boolean;
}

function boundedEffectCount(
  random: () => number,
  range: readonly [number, number],
  minimumCounts: boolean,
): number {
  return minimumCounts ? range[0] : randomInteger(random, ...range);
}

/** Maps only committed domain events to visual effects. */
export function createParticleEffectsForEvent(
  event: RuntimeEvent,
  random: () => number,
  quality: ParticleEffectQualityOptions = {},
): ParticleEffectDescriptor[] {
  const minimumCounts = quality.minimumCounts ?? false;
  switch (event.type) {
    case 'work-added': {
      const genreEntries = readGenreCounts(event.payload);
      let effects: ParticleEffectDescriptor[];

      if (genreEntries === null || minimumCounts) {
        // Legacy payloads and degraded quality fall back to one modest burst.
        effects = [
          descriptor(event, 'fireworks', 0, random, {
            particleCount: boundedEffectCount(
              random,
              FIREWORK_PARTICLE_RANGE,
              minimumCounts,
            ),
            durationSeconds: FIREWORK_DURATION_SECONDS,
            color: readGenreColor(event.payload),
            burstCount: minimumCounts
              ? 1
              : fireworkBurstCount(readGenreCount(event.payload)),
          }),
        ];
      } else {
        // The personal show: every genre in the archive fires its own
        // genre-colored shell group, scaled by how many stars it holds.
        const burstCounts = personalShowBurstCounts(
          genreEntries.map(([, count]) => count),
        );
        effects = genreEntries.map(([genre], index) =>
          descriptor(event, 'fireworks', index, random, {
            particleCount: boundedEffectCount(
              random,
              FIREWORK_PARTICLE_RANGE,
              minimumCounts,
            ),
            durationSeconds: PERSONAL_SHOW_DURATION_SECONDS,
            color: GENRE_FIREWORK_COLORS[genre] ?? DEFAULT_FIREWORK_COLOR,
            burstCount: burstCounts[index] ?? 1,
            celebrationScope: 'archive',
          }),
        );
      }

      if (event.payload.rating === 5) {
        effects.push(
          descriptor(event, 'meteor-shower', effects.length, random, {
            trailCount: boundedEffectCount(
              random,
              METEOR_SHOWER_TRAIL_RANGE,
              minimumCounts,
            ),
            durationSeconds: METEOR_SHOWER_DURATION_SECONDS,
          }),
        );
      }
      return effects;
    }
    case 'work-hard-deleted':
      return [
        descriptor(event, 'asteroid-impact', 0, random, {
          particleCount: boundedEffectCount(
            random,
            ASTEROID_DEBRIS_RANGE,
            minimumCounts,
          ),
          durationSeconds: ASTEROID_IMPACT_DURATION_SECONDS,
          scaleFrom: 1,
          scaleTo: 0,
        }),
      ];
    case 'work-soft-deleted':
      return [
        descriptor(event, 'blackhole-spiral', 0, random, {
          particleCount: 24,
          durationSeconds: BLACKHOLE_SPIRAL_DURATION_SECONDS,
          rotations: BLACKHOLE_SPIRAL_ROTATIONS,
          scaleFrom: 1,
          scaleTo: 0,
        }),
      ];
    case 'work-restored':
      return [
        descriptor(event, 'restore-pulse', 0, random, {
          particleCount: 18,
          durationSeconds: 0.65,
          scaleFrom: 0.35,
          scaleTo: 2.15,
        }),
      ];
    case 'milestone-unlocked':
      return [
        descriptor(event, 'milestone-celebration', 0, random, {
          particleCount: 48,
          durationSeconds: 1.5,
        }),
      ];
    case 'achievement-unlocked':
      return [
        descriptor(event, 'achievement-celebration', 0, random, {
          particleCount: 36,
          durationSeconds: 1.2,
        }),
      ];
    default:
      return [];
  }
}

export class ParticleEffectController {
  private readonly effects = new Map<string, ParticleEffectDescriptor>();
  private readonly listeners = new Set<(effects: readonly ParticleEffectDescriptor[]) => void>();

  constructor(
    private readonly timer: ParticleTimer,
    readonly registry: EffectLifecycleRegistry,
    private readonly random: () => number,
  ) {}

  startEvent(
    event: RuntimeEvent,
    quality: ParticleEffectQualityOptions = {},
  ): readonly ParticleEffectDescriptor[] {
    const effects = createParticleEffectsForEvent(event, this.random, quality);
    for (const effect of effects) this.start(effect);
    return effects;
  }

  start(effect: ParticleEffectDescriptor, onExpired?: () => void): boolean {
    if (this.effects.has(effect.id)) return false;
    this.effects.set(effect.id, effect);
    this.registry.open(effect.id);
    const timerId = this.timer.setTimeout(() => {
      if (!this.effects.delete(effect.id)) return;
      this.registry.cleanup(effect.id);
      this.emit();
      onExpired?.();
    }, effect.durationSeconds * 1_000);
    this.registry.addTimer(effect.id, timerId);
    this.emit();
    return true;
  }

  cancel(effectId: string): void {
    if (!this.effects.delete(effectId)) return;
    this.registry.cleanup(effectId);
    this.emit();
  }

  addResource(
    effectId: string,
    kind: EffectResourceKind,
    resource: DisposableEffectResource,
  ): boolean {
    return this.registry.addResource(effectId, kind, resource);
  }

  addAnimation(effectId: string, cancel: () => void): void {
    this.registry.addAnimation(effectId, cancel);
  }

  getActiveEffects(): readonly ParticleEffectDescriptor[] {
    return [...this.effects.values()];
  }

  subscribe(listener: (effects: readonly ParticleEffectDescriptor[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getActiveEffects());
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.effects.clear();
    this.registry.cleanupAll();
    this.emit();
    this.listeners.clear();
  }

  private emit(): void {
    const snapshot = this.getActiveEffects();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export interface BackgroundMeteorSchedulerSnapshot {
  visible: boolean;
  pending: boolean;
  activeMeteorId: string | null;
  lastScheduledDelaySeconds: number | null;
}

export interface BackgroundMeteorSchedulerOptions {
  timer: ParticleTimer;
  random: () => number;
  spawn(
    effect: ParticleEffectDescriptor,
    onExpired: () => void,
  ): boolean;
  cancel(effectId: string): void;
}

/** Visibility-aware one-at-a-time background meteor scheduler. */
export class BackgroundMeteorScheduler {
  private visible = false;
  private pendingTimerId: number | null = null;
  private activeMeteorId: string | null = null;
  private sequence = 0;
  private lastScheduledDelaySeconds: number | null = null;

  constructor(private readonly options: BackgroundMeteorSchedulerOptions) {}

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.clearPending();
      if (this.activeMeteorId !== null) {
        const activeId = this.activeMeteorId;
        this.activeMeteorId = null;
        this.options.cancel(activeId);
      }
      return;
    }
    this.scheduleFreshInterval();
  }

  dispose(): void {
    this.visible = false;
    this.clearPending();
    if (this.activeMeteorId !== null) {
      const activeId = this.activeMeteorId;
      this.activeMeteorId = null;
      this.options.cancel(activeId);
    }
  }

  snapshot(): BackgroundMeteorSchedulerSnapshot {
    return {
      visible: this.visible,
      pending: this.pendingTimerId !== null,
      activeMeteorId: this.activeMeteorId,
      lastScheduledDelaySeconds: this.lastScheduledDelaySeconds,
    };
  }

  private scheduleFreshInterval(): void {
    if (!this.visible || this.pendingTimerId !== null) return;
    const delaySeconds = randomBetween(
      this.options.random,
      BACKGROUND_METEOR_INTERVAL_SECONDS[0],
      BACKGROUND_METEOR_INTERVAL_SECONDS[1],
    );
    this.lastScheduledDelaySeconds = delaySeconds;
    this.pendingTimerId = this.options.timer.setTimeout(() => {
      this.pendingTimerId = null;
      if (!this.visible || this.activeMeteorId !== null) return;
      const durationSeconds = randomBetween(
        this.options.random,
        BACKGROUND_METEOR_DURATION_SECONDS[0],
        BACKGROUND_METEOR_DURATION_SECONDS[1],
      );
      const id = `background-meteor:${++this.sequence}`;
      const effect: ParticleEffectDescriptor = {
        id,
        sourceEventId: id,
        kind: 'background-meteor',
        origin: {
          x: randomBetween(this.options.random, -35, -20),
          y: randomBetween(this.options.random, 10, 28),
          z: randomBetween(this.options.random, -20, 10),
        },
        particleCount: 0,
        trailCount: 1,
        durationSeconds,
        rotations: 0,
        seed: Math.floor(finiteUnit(this.options.random()) * 0x1_0000_0000) >>> 0,
        scaleFrom: 1,
        scaleTo: 1,
      };
      this.activeMeteorId = id;
      const started = this.options.spawn(effect, () => {
        if (this.activeMeteorId === id) this.activeMeteorId = null;
        this.scheduleFreshInterval();
      });
      if (!started) {
        this.activeMeteorId = null;
        this.scheduleFreshInterval();
      } else {
        // The next delay is measured start-to-start; the 0.5-1.0s lifetime is
        // well below the minimum 15s interval, so concurrency remains capped at one.
        this.scheduleFreshInterval();
      }
    }, delaySeconds * 1_000);
  }

  private clearPending(): void {
    if (this.pendingTimerId === null) return;
    this.options.timer.clearTimeout(this.pendingTimerId);
    this.pendingTimerId = null;
  }
}

export const browserParticleTimer: ParticleTimer = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
};
