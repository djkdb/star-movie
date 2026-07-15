import { TOUCH } from 'three';
import { describe, expect, it } from 'vitest';

import { ORBIT_TOUCH_GESTURES } from './orbitControlsConfig';

describe('OrbitControls touch configuration', () => {
  it('R14.7 maps one finger to rotation and two fingers to pinch zoom/pan', () => {
    expect(ORBIT_TOUCH_GESTURES).toEqual({
      ONE: TOUCH.ROTATE,
      TWO: TOUCH.DOLLY_PAN,
    });
  });
});
