import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import { Vector3 } from 'three';

import type { CameraControlsLike } from './CameraRig';
import { reelCameraAt, REEL_DURATION_MS } from './reelCaptureModel';

export interface CinematicTourProps {
  /** Clock origin of the running tour, or null when no tour is active. */
  startedAtMs: number | null;
  controlsRef?: RefObject<CameraControlsLike | null>;
  onFinished?: () => void;
}

const target = new Vector3();

/**
 * Takes the camera for the length of the shareable clip and flies the scripted
 * path from `reelCaptureModel`. Orbit controls are parked while it runs, so a
 * stray drag cannot fight the flight and end up baked into the recording.
 *
 * Adds no geometry and no passes — it only writes the camera each frame — so
 * it needs no quality gating; the clip looks the same on every tier the scene
 * already renders at.
 */
export function CinematicTour({ startedAtMs, controlsRef, onFinished }: CinematicTourProps) {
  const camera = useThree((state) => state.camera);
  const active = startedAtMs !== null;

  useEffect(() => {
    const controls = controlsRef?.current;
    if (!active || controls === undefined || controls === null) return undefined;
    const enabled = controls as CameraControlsLike & { enabled?: boolean };
    const previous = enabled.enabled;
    enabled.enabled = false;
    return () => {
      enabled.enabled = previous ?? true;
    };
  }, [active, controlsRef]);

  useFrame(() => {
    if (startedAtMs === null) return;
    const elapsed = performance.now() - startedAtMs;
    const pose = reelCameraAt(elapsed);

    const horizontal = Math.cos(pose.elevation) * pose.distance;
    camera.position.set(
      Math.sin(pose.azimuth) * horizontal,
      Math.sin(pose.elevation) * pose.distance,
      Math.cos(pose.azimuth) * horizontal,
    );
    target.set(0, pose.targetY, 0);
    camera.lookAt(target);

    const controls = controlsRef?.current;
    if (controls !== undefined && controls !== null) {
      controls.target.copy(target);
    }

    if (elapsed >= REEL_DURATION_MS) onFinished?.();
  });

  return null;
}
