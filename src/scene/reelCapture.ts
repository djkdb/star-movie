/**
 * Records the sky as a vertical clip that can be posted without editing.
 *
 * The scene canvas is already 9:16 by the time we get here — the shell puts
 * the app into reel framing first — so each frame is one `drawImage` into a
 * 1080x1920 compositing canvas, plus the caption card for that moment. The
 * compositing canvas is what MediaRecorder captures, so the overlay is baked
 * into the file rather than living in the DOM.
 */

import { getRegisteredCanvas } from './galaxyCapture';
import {
  buildReelCaptions,
  captionAt,
  captionOpacity,
  pickReelMimeType,
  reelFilename,
  REEL_DURATION_MS,
  REEL_HEIGHT,
  REEL_WIDTH,
  type ReelCaption,
  type ReelStats,
} from './reelCaptureModel';

export type ReelFailure =
  | 'unsupported'
  | 'no-canvas'
  | 'no-context'
  | 'empty-recording'
  | 'recorder-error';

export type ReelResult =
  | { ok: true; filename: string }
  | { ok: false; reason: ReelFailure };

/** Whether this browser can record a canvas at all. */
export function canRecordReel(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.MediaRecorder === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
  return pickReelMimeType((type) => window.MediaRecorder.isTypeSupported(type)) !== null;
}

const INK = '#050813';

/** Held past the clip end so the muxer cannot clip the closing card. */
const TAIL_MS = 250;

/**
 * Resolves once the display faces are resident, so captions do not bake in a
 * fallback. Call this *before* taking the clip clock origin: anything awaited
 * between the origin and `recorder.start()` is flight time that never makes it
 * into the file, which showed up as a clip a full second short.
 */
export async function awaitReelFonts(): Promise<void> {
  if (typeof document === 'undefined' || document.fonts?.ready === undefined) return;
  try {
    await document.fonts.ready;
  } catch {
    // Fall back to whatever is available rather than abandoning the export.
  }
}

function drawSceneFrame(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  if (scene.width === 0 || scene.height === 0) return;

  // Cover: the shell already frames the canvas 9:16, but a stale resize would
  // otherwise letterbox the clip, so crop to fill either way.
  const scale = Math.max(REEL_WIDTH / scene.width, REEL_HEIGHT / scene.height);
  const width = scene.width * scale;
  const height = scene.height * scale;
  ctx.drawImage(scene, (REEL_WIDTH - width) / 2, (REEL_HEIGHT - height) / 2, width, height);
}

function drawScrim(ctx: CanvasRenderingContext2D): void {
  // Instagram overlays its own UI top and bottom; darkening those bands keeps
  // the captions readable and stops the sky fighting the platform chrome.
  const top = ctx.createLinearGradient(0, 0, 0, REEL_HEIGHT * 0.3);
  top.addColorStop(0, 'rgba(3, 5, 14, 0.72)');
  top.addColorStop(1, 'rgba(3, 5, 14, 0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT * 0.3);

  // The caption block sits at 0.76, so the scrim has to be near-solid by then
  // — a bright star behind a headline turns it to mush.
  const bottom = ctx.createLinearGradient(0, REEL_HEIGHT * 0.5, 0, REEL_HEIGHT);
  bottom.addColorStop(0, 'rgba(3, 5, 14, 0)');
  bottom.addColorStop(0.45, 'rgba(3, 5, 14, 0.62)');
  bottom.addColorStop(0.7, 'rgba(3, 5, 14, 0.88)');
  bottom.addColorStop(1, 'rgba(3, 5, 14, 0.95)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, REEL_HEIGHT * 0.5, REEL_WIDTH, REEL_HEIGHT * 0.5);
}

function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  }
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  caption: ReelCaption,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = caption.headline.split('\n');
  // Cards sit low: the top third of a Reel is where the account header lands.
  const blockCenter = REEL_HEIGHT * 0.76;
  const headlineSize = lines.length > 1 ? 92 : 132;
  const lineHeight = headlineSize * 1.28;
  const headlineTop = blockCenter - ((lines.length - 1) * lineHeight) / 2;

  if (caption.eyebrow !== '') {
    ctx.fillStyle = '#7aa5ff';
    ctx.font = "400 34px 'IBM Plex Mono', ui-monospace, monospace";
    setTracking(ctx, 6);
    ctx.fillText(caption.eyebrow, REEL_WIDTH / 2, headlineTop - headlineSize * 0.95);
    setTracking(ctx, 0);
  }

  ctx.fillStyle = '#e9edfa';
  ctx.font = `600 ${headlineSize}px 'Hahmlet', 'Nanum Myeongjo', serif`;
  ctx.shadowColor = 'rgba(122, 165, 255, 0.5)';
  ctx.shadowBlur = 44;
  lines.forEach((line, index) => {
    ctx.fillText(line, REEL_WIDTH / 2, headlineTop + index * lineHeight);
  });
  ctx.shadowBlur = 0;

  if (caption.sub !== '') {
    ctx.fillStyle = 'rgba(188, 198, 224, 0.94)';
    ctx.font = "400 40px 'IBM Plex Sans KR', system-ui, sans-serif";
    ctx.fillText(
      caption.sub,
      REEL_WIDTH / 2,
      headlineTop + (lines.length - 1) * lineHeight + headlineSize * 0.92,
    );
  }
  ctx.restore();
}

function drawProgress(ctx: CanvasRenderingContext2D, elapsedMs: number): void {
  const progress = Math.min(1, elapsedMs / REEL_DURATION_MS);
  ctx.fillStyle = 'rgba(122, 165, 255, 0.22)';
  ctx.fillRect(0, REEL_HEIGHT - 6, REEL_WIDTH, 3);
  ctx.fillStyle = '#7aa5ff';
  ctx.fillRect(0, REEL_HEIGHT - 6, REEL_WIDTH * progress, 3);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface RecordReelOptions {
  stats: ReelStats;
  /** Clip clock origin — shared with the camera tour so captions line up. */
  startedAtMs: number;
  /** 0..1, for the progress readout in the UI. */
  onProgress?: (progress: number) => void;
  now?: () => number;
  date?: Date;
}

/**
 * Runs the clip to completion and downloads it. Assumes the caller has
 * already framed the canvas and started the camera tour at `startedAtMs`.
 */
export async function recordReel(options: RecordReelOptions): Promise<ReelResult> {
  if (!canRecordReel()) return { ok: false, reason: 'unsupported' };

  const scene = getRegisteredCanvas();
  if (scene === null) return { ok: false, reason: 'no-canvas' };

  const mimeType = pickReelMimeType((type) => window.MediaRecorder.isTypeSupported(type));
  if (mimeType === null) return { ok: false, reason: 'unsupported' };

  const stage = document.createElement('canvas');
  stage.width = REEL_WIDTH;
  stage.height = REEL_HEIGHT;
  // The compositing canvas doubles as the preview: mounting it over the framed
  // scene is the only way the viewer sees the captions and the crop they are
  // actually recording, rather than a bare vertical slice of the sky.
  stage.className = 'reel-stage';
  stage.setAttribute('aria-hidden', 'true');
  document.body.appendChild(stage);
  const ctx = stage.getContext('2d');
  if (ctx === null) {
    stage.remove();
    return { ok: false, reason: 'no-context' };
  }

  // Cheap here: the caller is expected to have already awaited this before it
  // took the clip clock origin (see `awaitReelFonts`). Kept as a guard for a
  // caller that forgets, where a late font load only costs a few frames.
  await awaitReelFonts();

  const captions = buildReelCaptions(options.stats);
  const clock = options.now ?? (() => performance.now());
  try {
    return await runRecording(stage, ctx, captions, mimeType, clock, options);
  } finally {
    stage.remove();
  }
}

async function runRecording(
  stage: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  captions: readonly ReelCaption[],
  mimeType: string,
  clock: () => number,
  options: RecordReelOptions,
): Promise<ReelResult> {
  const scene = getRegisteredCanvas();
  if (scene === null) return { ok: false, reason: 'no-canvas' };

  // No fps argument: the stream then timestamps each frame as it is actually
  // painted. Declaring 30 instead makes the container divide the real frame
  // count by 30, so a device that renders at 26fps writes a clip that is short
  // by the same ratio — 12 seconds of flight muxed as 10.4.
  const stream = stage.captureStream();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<ReelFailure | null>((resolve) => {
    recorder.onstop = () => resolve(null);
    recorder.onerror = () => resolve('recorder-error');
  });

  recorder.start();

  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsed = clock() - options.startedAtMs;
      drawSceneFrame(ctx, scene);
      drawScrim(ctx);
      const caption = captionAt(captions, elapsed);
      if (caption !== null) drawCaption(ctx, caption, captionOpacity(caption, elapsed));
      drawProgress(ctx, elapsed);
      options.onProgress?.(Math.min(1, elapsed / REEL_DURATION_MS));

      // A short tail past the end so the closing card is not clipped by the
      // muxer dropping the final partial frame.
      if (elapsed >= REEL_DURATION_MS + TAIL_MS) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());

  const failure = await finished;
  if (failure !== null) return { ok: false, reason: failure };

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return { ok: false, reason: 'empty-recording' };

  const filename = reelFilename(options.date ?? new Date(), mimeType);
  triggerDownload(blob, filename);
  return { ok: true, filename };
}
