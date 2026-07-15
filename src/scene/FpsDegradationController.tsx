import { useEffect } from 'react';

import type { QualityLevel } from '../domain/models';
import { degradeQualityLevel } from '../domain/qualityLevel';
import type { ArchiveStoreApi } from '../store/archiveStore';
import type { FpsWindowMeasurement } from './performanceBenchmark';

export const FPS_MEASUREMENT_WINDOW_MS = 5_000;
export const MINIMUM_ACCEPTABLE_FPS = 30;

export interface AnimationFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(requestId: number): void;
}

export const browserAnimationFrameScheduler: AnimationFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (requestId) => cancelAnimationFrame(requestId),
};

export interface FpsDegradationControllerOptions {
  scheduler?: AnimationFrameScheduler;
  getQualityLevel(): QualityLevel;
  onQualityLevelChange(next: QualityLevel, averageFps: number): void;
  onWindowMeasured?(measurement: FpsWindowMeasurement): void;
  windowMs?: number;
  minimumFps?: number;
}

/**
 * Measures non-overlapping RAF windows. A slow window can request exactly one
 * cumulative degradation stage; acceptable windows never restore quality.
 */
export class FpsDegradationController {
  private readonly scheduler: AnimationFrameScheduler;
  private readonly windowMs: number;
  private readonly minimumFps: number;
  private requestId: number | null = null;
  private windowStartedAt: number | null = null;
  private frameIntervals = 0;

  constructor(private readonly options: FpsDegradationControllerOptions) {
    this.scheduler = options.scheduler ?? browserAnimationFrameScheduler;
    this.windowMs = options.windowMs ?? FPS_MEASUREMENT_WINDOW_MS;
    this.minimumFps = options.minimumFps ?? MINIMUM_ACCEPTABLE_FPS;
  }

  start(): void {
    if (this.requestId !== null) return;
    this.requestId = this.scheduler.request(this.sample);
  }

  stop(): void {
    if (this.requestId !== null) this.scheduler.cancel(this.requestId);
    this.requestId = null;
    this.resetWindow();
  }

  private readonly sample: FrameRequestCallback = (timestamp) => {
    this.requestId = null;

    if (!Number.isFinite(timestamp)) {
      this.requestId = this.scheduler.request(this.sample);
      return;
    }

    if (this.windowStartedAt === null || timestamp < this.windowStartedAt) {
      this.windowStartedAt = timestamp;
      this.frameIntervals = 0;
    } else {
      this.frameIntervals += 1;
      const elapsedMs = timestamp - this.windowStartedAt;
      if (elapsedMs >= this.windowMs) {
        const averageFps = (this.frameIntervals * 1_000) / elapsedMs;
        const current = this.options.getQualityLevel();
        const next = degradeQualityLevel(current);
        const degradedTo = averageFps < this.minimumFps && next !== current
          ? next
          : null;
        if (degradedTo !== null) {
          this.options.onQualityLevelChange(degradedTo, averageFps);
        }
        this.options.onWindowMeasured?.({
          startedAt: this.windowStartedAt,
          endedAt: timestamp,
          durationMs: elapsedMs,
          frameCount: this.frameIntervals,
          averageFps,
          qualityLevel: current,
          degradedTo,
        });
        this.windowStartedAt = timestamp;
        this.frameIntervals = 0;
      }
    }

    this.requestId = this.scheduler.request(this.sample);
  };

  private resetWindow(): void {
    this.windowStartedAt = null;
    this.frameIntervals = 0;
  }
}

export interface FpsDegradationMonitorProps {
  store: ArchiveStoreApi;
  onWindowMeasured?: (measurement: FpsWindowMeasurement) => void;
}

export function FpsDegradationMonitor({
  store,
  onWindowMeasured,
}: FpsDegradationMonitorProps) {
  useEffect(() => {
    const controller = new FpsDegradationController({
      getQualityLevel: () => store.getState().runtime.qualityLevel,
      onQualityLevelChange: () => {
        store.getState().commands.degradeQuality();
      },
      onWindowMeasured,
    });
    const updateVisibility = () => {
      if (document.visibilityState === 'visible') controller.start();
      else controller.stop();
    };

    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      controller.stop();
    };
  }, [onWindowMeasured, store]);

  return null;
}
