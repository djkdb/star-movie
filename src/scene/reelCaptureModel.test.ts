// The clip only works if its timing does: captions must never overlap, the
// camera must never jump, and the container must be the most shareable one
// the browser can actually mux.

import { describe, expect, it } from 'vitest';

import {
  buildReelCaptions,
  captionAt,
  captionOpacity,
  pickReelMimeType,
  reelCameraAt,
  reelExtension,
  reelFilename,
  REEL_DURATION_MS,
  type ReelStats,
} from './reelCaptureModel';

const FULL: ReelStats = {
  starCount: 42,
  genreCount: 6,
  topGenre: 'SF',
  averageRating: 4.25,
  constellationCount: 3,
  planetCount: 7,
};

const EMPTY: ReelStats = {
  starCount: 0,
  genreCount: 0,
  topGenre: null,
  averageRating: null,
  constellationCount: 0,
  planetCount: 0,
};

describe('reel captions', () => {
  it('opens on a hook within the first frames, not on a logo', () => {
    const first = buildReelCaptions(FULL)[0]!;
    expect(first.fromMs).toBeLessThanOrEqual(500);
    expect(first.eyebrow).toBe('');
    expect(first.headline).toContain('밤하늘');
  });

  it('never shows two cards at once and always ends on the call to action', () => {
    for (const stats of [FULL, EMPTY]) {
      const captions = buildReelCaptions(stats);
      for (let index = 1; index < captions.length; index += 1) {
        expect(captions[index]!.fromMs).toBeGreaterThanOrEqual(captions[index - 1]!.toMs);
      }
      const last = captions[captions.length - 1]!;
      expect(last.toMs).toBe(REEL_DURATION_MS);
      expect(last.sub).toContain('star-movie');
    }
  });

  it('reports the real numbers and degrades to an invitation on an empty archive', () => {
    const full = buildReelCaptions(FULL);
    expect(full.some((caption) => caption.headline === '42편')).toBe(true);
    expect(full.some((caption) => caption.headline === 'SF')).toBe(true);
    // 4.25 is presented at one decimal, never as a raw float.
    expect(full.some((caption) => caption.sub.includes('4.3점'))).toBe(true);

    const empty = buildReelCaptions(EMPTY);
    expect(empty.some((caption) => caption.headline === '0편')).toBe(true);
    expect(empty.some((caption) => caption.sub.includes('점'))).toBe(false);
  });

  it('resolves the card showing at a moment, and nothing in the gaps', () => {
    const captions = buildReelCaptions(FULL);
    expect(captionAt(captions, 1_000)?.headline).toContain('밤하늘');
    expect(captionAt(captions, 4_000)?.headline).toBe('42편');
    expect(captionAt(captions, 3_200)).toBeNull();
    expect(captionAt(captions, REEL_DURATION_MS + 1)).toBeNull();
  });

  it('fades cards in and out instead of cutting', () => {
    const caption = buildReelCaptions(FULL)[1]!;
    expect(captionOpacity(caption, caption.fromMs)).toBe(0);
    expect(captionOpacity(caption, caption.fromMs + 200)).toBeCloseTo(0.5, 2);
    expect(captionOpacity(caption, caption.fromMs + 1_200)).toBe(1);
    expect(captionOpacity(caption, caption.toMs - 200)).toBeCloseTo(0.5, 2);
    expect(captionOpacity(caption, caption.toMs)).toBe(0);
    expect(captionOpacity(caption, caption.fromMs - 1)).toBe(0);
  });
});

describe('reel camera path', () => {
  it('stays continuous — no frame-to-frame jump the eye would read as a cut', () => {
    const step = 1000 / 30;
    let previous = reelCameraAt(0);
    for (let ms = step; ms <= REEL_DURATION_MS; ms += step) {
      const current = reelCameraAt(ms);
      expect(Math.abs(current.azimuth - previous.azimuth)).toBeLessThan(0.08);
      expect(Math.abs(current.distance - previous.distance)).toBeLessThan(1.2);
      expect(Math.abs(current.elevation - previous.elevation)).toBeLessThan(0.03);
      previous = current;
    }
  });

  it('travels — it must not be a static shot dressed up as a flight', () => {
    const start = reelCameraAt(0);
    const middle = reelCameraAt(REEL_DURATION_MS / 2);
    const end = reelCameraAt(REEL_DURATION_MS);
    expect(middle.azimuth).toBeGreaterThan(start.azimuth);
    expect(end.azimuth).toBeGreaterThan(middle.azimuth);
    // Descends into the field, then pulls back out for the closing card.
    expect(middle.distance).toBeLessThan(start.distance);
    expect(end.distance).toBeGreaterThan(middle.distance);
  });

  it('clamps outside the clip rather than extrapolating off into space', () => {
    expect(reelCameraAt(-5_000)).toEqual(reelCameraAt(0));
    expect(reelCameraAt(REEL_DURATION_MS * 3)).toEqual(reelCameraAt(REEL_DURATION_MS));
    expect(reelCameraAt(Number.NaN).distance).toBeGreaterThan(0);
  });
});

describe('reel container', () => {
  it('prefers MP4, which uploads without conversion', () => {
    expect(pickReelMimeType(() => true)).toContain('mp4');
  });

  it('falls back to WebM when the browser cannot mux MP4', () => {
    const mime = pickReelMimeType((type) => type.includes('webm'));
    expect(mime).toContain('webm');
    expect(reelExtension(mime!)).toBe('webm');
  });

  it('reports null when nothing is supported, so the UI can say so', () => {
    expect(pickReelMimeType(() => false)).toBeNull();
  });

  it('names the file by date and container', () => {
    const date = new Date(2026, 7, 6);
    expect(reelFilename(date, 'video/mp4')).toBe('asteron-reel-20260806.mp4');
    expect(reelFilename(date, 'video/webm;codecs=vp9')).toBe('asteron-reel-20260806.webm');
  });
});
