/**
 * The shareable-clip model: everything about the vertical export that can be
 * decided without a browser — the camera path, the caption timeline, the
 * filename, and which container the recorder should ask for.
 *
 * Kept pure so the timing that actually decides whether the clip reads well
 * is unit-testable; `reelCapture.ts` owns the canvas and MediaRecorder.
 */

/** 9:16 at the resolution Instagram/TikTok re-encode from without softening. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

/**
 * Twelve seconds: long enough for the camera to travel somewhere, short
 * enough that the whole thing is watched rather than scrolled past.
 */
export const REEL_DURATION_MS = 12_000;

export interface ReelStats {
  starCount: number;
  genreCount: number;
  /** Most-recorded genre, or null when the archive is empty. */
  topGenre: string | null;
  /** Mean rating rounded to one decimal, or null when nothing is rated. */
  averageRating: number | null;
  constellationCount: number;
  planetCount: number;
}

export interface ReelCaption {
  fromMs: number;
  toMs: number;
  /** Small mono line above the headline. Empty string draws nothing. */
  eyebrow: string;
  headline: string;
  sub: string;
}

/** Spherical camera placement, resolved to a position by the tour component. */
export interface ReelCameraSample {
  /** Radians around the Y axis. */
  azimuth: number;
  /** Radians above the XZ plane. */
  elevation: number;
  distance: number;
  /** Height of the point the camera aims at, so the pass tilts as it flies. */
  targetY: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Cosine ease — no overshoot, so the path never snaps at a keyframe. */
function easeInOut(t: number): number {
  return 0.5 - Math.cos(clamp01(t) * Math.PI) / 2;
}

interface CameraKeyframe extends ReelCameraSample {
  /** Position in the clip, 0..1. */
  at: number;
}

/**
 * Four moves: hold wide on the black hole, descend into the field, sweep
 * through it, then pull back out. The azimuth only ever increases so the
 * whole clip reads as one continuous travelling shot.
 */
const CAMERA_PATH: readonly CameraKeyframe[] = [
  { at: 0, azimuth: 0, elevation: 0.30, distance: 46, targetY: 2.5 },
  { at: 0.22, azimuth: 0.55, elevation: 0.16, distance: 32, targetY: 1.2 },
  { at: 0.55, azimuth: 1.75, elevation: -0.05, distance: 20, targetY: 0 },
  { at: 0.80, azimuth: 2.70, elevation: 0.12, distance: 26, targetY: 0.6 },
  { at: 1, azimuth: 3.35, elevation: 0.34, distance: 44, targetY: 2.0 },
];

/** Camera placement at `elapsedMs` into the clip. */
export function reelCameraAt(elapsedMs: number): ReelCameraSample {
  const t = clamp01(elapsedMs / REEL_DURATION_MS);
  let previous = CAMERA_PATH[0]!;
  for (const frame of CAMERA_PATH) {
    if (frame.at >= t) {
      const span = frame.at - previous.at;
      const local = span <= 0 ? 1 : easeInOut((t - previous.at) / span);
      return {
        azimuth: previous.azimuth + (frame.azimuth - previous.azimuth) * local,
        elevation: previous.elevation + (frame.elevation - previous.elevation) * local,
        distance: previous.distance + (frame.distance - previous.distance) * local,
        targetY: previous.targetY + (frame.targetY - previous.targetY) * local,
      };
    }
    previous = frame;
  }
  const last = CAMERA_PATH[CAMERA_PATH.length - 1]!;
  return { azimuth: last.azimuth, elevation: last.elevation, distance: last.distance, targetY: last.targetY };
}

function ratingLabel(average: number | null): string {
  return average === null ? '아직 없음' : `${average.toFixed(1)}점`;
}

/**
 * The caption timeline. The first card lands immediately and asks a question,
 * because a clip that opens on a logo is a clip nobody finishes.
 */
export function buildReelCaptions(stats: ReelStats): readonly ReelCaption[] {
  const captions: ReelCaption[] = [
    {
      fromMs: 200,
      toMs: 3_000,
      eyebrow: '',
      headline: '내가 본 영화가\n밤하늘이 된다면',
      sub: '',
    },
    {
      fromMs: 3_400,
      toMs: 6_100,
      eyebrow: '기록한 작품',
      headline: `${stats.starCount}편`,
      sub: stats.starCount === 0 ? '첫 번째 별을 기다리는 중' : '별 하나가 이야기 하나',
    },
  ];

  if (stats.topGenre !== null) {
    captions.push({
      fromMs: 6_500,
      toMs: 9_000,
      eyebrow: '가장 많이 본 장르',
      headline: stats.topGenre,
      sub: `장르 ${stats.genreCount}개 · 평균 ${ratingLabel(stats.averageRating)}`,
    });
  } else {
    captions.push({
      fromMs: 6_500,
      toMs: 9_000,
      eyebrow: '지금부터',
      headline: '기록하는 만큼',
      sub: '하늘이 넓어집니다',
    });
  }

  captions.push({
    fromMs: 9_400,
    toMs: REEL_DURATION_MS,
    eyebrow: 'ASTERON',
    headline: '내 우주 만들기',
    sub: 'star-movie.pages.dev',
  });

  return captions;
}

/** The caption showing at `elapsedMs`, or null between cards. */
export function captionAt(
  captions: readonly ReelCaption[],
  elapsedMs: number,
): ReelCaption | null {
  return captions.find(({ fromMs, toMs }) => elapsedMs >= fromMs && elapsedMs < toMs) ?? null;
}

const CAPTION_FADE_MS = 400;

/** 0..1 alpha so cards fade rather than cut, including the final card's hold. */
export function captionOpacity(caption: ReelCaption, elapsedMs: number): number {
  const sinceIn = elapsedMs - caption.fromMs;
  const untilOut = caption.toMs - elapsedMs;
  if (sinceIn < 0 || untilOut <= 0) return 0;
  return clamp01(Math.min(sinceIn, untilOut) / CAPTION_FADE_MS);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Container extension for a recorder mime type, defaulting to webm. */
export function reelExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export function reelFilename(date: Date, mimeType: string): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  return `asteron-reel-${stamp}.${reelExtension(mimeType)}`;
}

/**
 * Candidate containers, most-shareable first. Instagram and TikTok both
 * accept MP4 directly; WebM has to be converted, so it is only the fallback
 * for browsers that cannot mux MP4 (Chrome on desktop, today).
 */
const MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * First container the recorder claims to support, or null when none is.
 * `isSupported` is injected so the choice is testable without MediaRecorder.
 */
export function pickReelMimeType(isSupported: (mimeType: string) => boolean): string | null {
  return MIME_CANDIDATES.find((candidate) => isSupported(candidate)) ?? null;
}
