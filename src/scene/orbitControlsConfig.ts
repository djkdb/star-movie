import { TOUCH } from 'three';

/** One-finger rotation plus two-finger pinch zoom (with pan) for touch viewports. */
export const ORBIT_TOUCH_GESTURES = Object.freeze({
  ONE: TOUCH.ROTATE,
  TWO: TOUCH.DOLLY_PAN,
});
