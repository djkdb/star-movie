import {
  GALAXY_POSTER_EYEBROW,
  GALAXY_POSTER_TITLE,
  galaxyPosterDateLabel,
  galaxyPosterFilename,
  galaxyStatsLine,
  type GalaxyPosterStats,
} from './galaxyCaptureModel';

/**
 * The live scene canvas is registered here (on Canvas creation) so the codex
 * panel can snapshot it without threading refs through the tree. Capturing the
 * WebGL buffer requires `preserveDrawingBuffer: true` on the Canvas.
 */
let registeredCanvas: HTMLCanvasElement | null = null;

export function registerGalaxyCanvas(canvas: HTMLCanvasElement): void {
  registeredCanvas = canvas;
}

/** Reads the current sky frame as a PNG data URL, or null if unavailable. */
export function captureGalaxyDataUrl(): string | null {
  if (registeredCanvas === null) return null;
  try {
    const url = registeredCanvas.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('poster image failed to load'));
    image.src = src;
  });
}

function drawPoster(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  stats: GalaxyPosterStats,
  now: Date,
): void {
  const w = image.width;
  const h = image.height;
  ctx.drawImage(image, 0, 0, w, h);

  // Darkening bands top and bottom so the text stays legible over the sky.
  const topBand = ctx.createLinearGradient(0, 0, 0, h * 0.26);
  topBand.addColorStop(0, 'rgba(2, 3, 8, 0.8)');
  topBand.addColorStop(1, 'rgba(2, 3, 8, 0)');
  ctx.fillStyle = topBand;
  ctx.fillRect(0, 0, w, h * 0.26);

  const bottomBand = ctx.createLinearGradient(0, h * 0.78, 0, h);
  bottomBand.addColorStop(0, 'rgba(2, 3, 8, 0)');
  bottomBand.addColorStop(1, 'rgba(2, 3, 8, 0.85)');
  ctx.fillStyle = bottomBand;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Eyebrow.
  ctx.fillStyle = 'rgba(124, 214, 255, 0.9)';
  ctx.font = `600 ${Math.round(w * 0.013)}px system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(w * 0.004)}px`;
  }
  ctx.fillText(GALAXY_POSTER_EYEBROW, w / 2, h * 0.085);
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  }

  // Title — the elegant serif display voice.
  ctx.fillStyle = '#f2f5ff';
  ctx.font = `700 ${Math.round(w * 0.05)}px 'Nanum Myeongjo', serif`;
  ctx.shadowColor = 'rgba(120, 180, 255, 0.45)';
  ctx.shadowBlur = Math.round(w * 0.022);
  ctx.fillText(GALAXY_POSTER_TITLE, w / 2, h * 0.16);
  ctx.shadowBlur = 0;

  // Stats.
  ctx.fillStyle = 'rgba(220, 236, 255, 0.92)';
  ctx.font = `500 ${Math.round(w * 0.02)}px system-ui, sans-serif`;
  ctx.fillText(galaxyStatsLine(stats), w / 2, h * 0.925);

  // Date.
  ctx.fillStyle = 'rgba(139, 149, 186, 0.85)';
  ctx.font = `400 ${Math.round(w * 0.0135)}px system-ui, sans-serif`;
  ctx.fillText(galaxyPosterDateLabel(now), w / 2, h * 0.958);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Snapshots the sky, composes the titled poster, and downloads it as a PNG.
 * Returns false when the canvas could not be captured.
 */
export async function exportGalaxyPoster(
  stats: GalaxyPosterStats,
  now: Date = new Date(),
): Promise<boolean> {
  const dataUrl = captureGalaxyDataUrl();
  if (dataUrl === null) return false;

  // Ensure the serif display face is ready so the poster title renders in it.
  if (typeof document !== 'undefined' && document.fonts?.ready !== undefined) {
    try {
      await document.fonts.ready;
    } catch {
      // Fall back to whatever is available.
    }
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return false;

  drawPoster(ctx, image, stats, now);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), 'image/png'),
  );
  if (blob === null) return false;

  triggerDownload(blob, galaxyPosterFilename(now));
  return true;
}
