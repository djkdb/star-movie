import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import { PerspectiveCamera } from 'three';

import { SPACE_CAMERA_FOV } from './backgroundModel';
import type { CameraControlsLike } from './CameraRig';
import type { CameraPose } from './cameraMath';
import { sampleArrivalFlight } from './arrivalFlightModel';

/** Input that cuts the arrival short — the viewer wants to fly it themselves. */
const SKIP_EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;

/**
 * Largest slice of the flight any single frame may advance. Scene start-up
 * hands the first frames deltas of a second or more, which would otherwise
 * teleport the camera through most of the arrival before it is ever painted.
 * Clamping spends the flight in rendered frames instead of wall-clock time.
 */
const MAX_FRAME_STEP_SECONDS = 1 / 30;

export interface ArrivalFlightProps {
  homePose: CameraPose;
  controlsRef: RefObject<CameraControlsLike | null>;
  /** False under reduced motion: the home framing is simply there on arrival. */
  enabled?: boolean;
  onCompleted?: () => void;
}

/**
 * Flies the camera in from deep space to the home framing once, on mount.
 *
 * The pose is written the same way CameraRig writes one — set the camera,
 * set the controls target, then `controls.update()` — so the trackball
 * recomputes its eye vector from the pose we just applied instead of
 * fighting it. Any input skips straight to the end, which also means the
 * trackball never receives a drag while the flight is still driving.
 */
export function ArrivalFlight({
  homePose,
  controlsRef,
  enabled = true,
  onCompleted,
}: ArrivalFlightProps) {
  const camera = useThree((state) => state.camera);
  const elapsedRef = useRef(0);
  const finishedRef = useRef(false);
  const skippedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const skip = () => {
      skippedRef.current = true;
    };
    for (const event of SKIP_EVENTS) {
      window.addEventListener(event, skip, { passive: true });
    }
    return () => {
      for (const event of SKIP_EVENTS) window.removeEventListener(event, skip);
    };
  }, [enabled]);

  useFrame((_, deltaSeconds) => {
    if (!enabled || finishedRef.current) return;

    elapsedRef.current += Math.min(deltaSeconds, MAX_FRAME_STEP_SECONDS);
    const sample = sampleArrivalFlight(elapsedRef.current, homePose);
    const landed = sample.completed || skippedRef.current;
    const pose = landed ? homePose : sample.pose;
    const fov = landed ? SPACE_CAMERA_FOV : sample.fov;

    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    if (camera instanceof PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const controls = controlsRef.current;
    if (controls === null) {
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    } else {
      controls.target.set(pose.target.x, pose.target.y, pose.target.z);
      controls.update();
    }

    if (landed) {
      finishedRef.current = true;
      onCompleted?.();
    }
  });

  return null;
}
