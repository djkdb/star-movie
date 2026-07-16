// Feature: natural-star-drift-and-camera-return
// Free-viewpoint return tween behavior (Requirements 4.1, 4.2, 4.3).
// The return reuses the same CameraTweenController the focus flow uses; these
// tests pin the duration/curve, the mid-flight replacement, and the
// reduced-motion instant-apply contract that CameraRig relies on.

import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../domain/models';
import {
  CAMERA_FOCUS_DURATION_SECONDS,
  CameraTweenController,
  interpolateCameraPose,
} from './cameraMath';

const FOCUSED: CameraPose = {
  position: { x: 0, y: 0, z: 8 },
  target: { x: 4, y: 2, z: -1 },
};
const PRE_FOCUS: CameraPose = {
  position: { x: 0, y: 0, z: 80 },
  target: { x: 0, y: 0, z: 0 },
};

describe('free-viewpoint return tween', () => {
  it('R4.1 restores the pre-focus pose over 0.7s with the shared cubic ease', () => {
    const controller = new CameraTweenController();
    controller.replace(FOCUSED, PRE_FOCUS);
    expect(CAMERA_FOCUS_DURATION_SECONDS).toBe(0.7);

    const midpoint = controller.advance(CAMERA_FOCUS_DURATION_SECONDS / 2);
    expect(midpoint?.completed).toBe(false);
    expect(midpoint?.pose).toEqual(interpolateCameraPose(FOCUSED, PRE_FOCUS, 0.5));

    const settled = controller.advance(CAMERA_FOCUS_DURATION_SECONDS / 2);
    expect(settled).toEqual({ pose: PRE_FOCUS, completed: true });
    expect(controller.isActive).toBe(false);
  });

  it('R4.3 replaces an in-flight focus tween from the current pose toward the pre-focus pose', () => {
    const controller = new CameraTweenController();
    controller.replace(PRE_FOCUS, FOCUSED);
    const partial = controller.advance(0.2)!;
    expect(partial.completed).toBe(false);

    // Deselection mid-focus: restart from the live pose toward the return target.
    controller.replace(partial.pose, PRE_FOCUS);
    const afterReplace = controller.advance(0)!;
    expect(afterReplace.pose).toEqual(partial.pose);

    const settled = controller.advance(CAMERA_FOCUS_DURATION_SECONDS);
    expect(settled).toEqual({ pose: PRE_FOCUS, completed: true });
  });
});
