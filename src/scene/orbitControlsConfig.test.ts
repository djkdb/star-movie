import { TOUCH } from 'three';
import { describe, expect, it } from 'vitest';

import {
  CAMERA_TARGET_MAX_RADIUS,
  ORBIT_TOUCH_GESTURES,
  clampTargetLength,
  getTrackballSpeeds,
} from './orbitControlsConfig';

describe('OrbitControls touch configuration', () => {
  it('R14.7 maps one finger to rotation and two fingers to pinch zoom/pan', () => {
    expect(ORBIT_TOUCH_GESTURES).toEqual({
      ONE: TOUCH.ROTATE,
      TWO: TOUCH.DOLLY_PAN,
    });
  });
});

describe('camera gesture bounds and speeds', () => {
  it('keeps a focus point inside the target bound, preserving shorter lengths', () => {
    expect(clampTargetLength(0)).toBe(0);
    expect(clampTargetLength(45)).toBe(45);
    expect(clampTargetLength(CAMERA_TARGET_MAX_RADIUS)).toBe(CAMERA_TARGET_MAX_RADIUS);
    expect(clampTargetLength(500)).toBe(CAMERA_TARGET_MAX_RADIUS);
    expect(clampTargetLength(Number.NaN)).toBe(0);
  });

  it('gives touch a gentler tuning than the mouse on every gesture', () => {
    const touch = getTrackballSpeeds(true);
    const mouse = getTrackballSpeeds(false);
    expect(touch.rotate).toBeLessThan(mouse.rotate);
    expect(touch.zoom).toBeLessThan(mouse.zoom);
    expect(touch.pan).toBeLessThan(mouse.pan);
  });
});
