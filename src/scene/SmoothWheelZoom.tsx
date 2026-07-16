import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Vector3 } from 'three';

import type { CameraControlsLike } from './CameraRig';
import {
  applyWheelToZoomTarget,
  dampZoomDistance,
  SMOOTH_ZOOM_MIN_DISTANCE,
} from './smoothZoomModel';

export interface SmoothWheelZoomProps {
  controlsRef: RefObject<CameraControlsLike | null>;
  maxDistance: number;
  /** Disabled under reduced motion: OrbitControls' instant wheel dolly runs instead. */
  enabled?: boolean;
}

/**
 * Rubber-band wheel zoom. A capture-phase wheel listener on the canvas
 * container swallows wheel events before OrbitControls sees them and only
 * stretches a target distance; each frame the camera glides toward it along
 * the current view axis. Touch pinch still uses OrbitControls' native dolly.
 */
export function SmoothWheelZoom({
  controlsRef,
  maxDistance,
  enabled = true,
}: SmoothWheelZoomProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const targetDistanceRef = useRef<number | null>(null);
  const scratchOffset = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (!enabled) return undefined;
    targetDistanceRef.current = null;
    const canvas = gl.domElement;
    const listenTarget = canvas.parentElement ?? canvas;

    const handleWheel = (event: WheelEvent) => {
      // Leave wheels aimed at HTML overlays (labels, dialogs) alone.
      if (event.target !== canvas) return;
      const controls = controlsRef.current;
      if (controls === null) return;
      event.preventDefault();
      event.stopPropagation();

      const currentDistance = camera.position.distanceTo(controls.target);
      const base = targetDistanceRef.current ?? currentDistance;
      targetDistanceRef.current = applyWheelToZoomTarget(
        base,
        event.deltaY,
        SMOOTH_ZOOM_MIN_DISTANCE,
        maxDistance,
      );
    };

    // Capture on the parent so this runs before OrbitControls' own canvas
    // listener; stopPropagation keeps the instant dolly from double-applying.
    listenTarget.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      listenTarget.removeEventListener('wheel', handleWheel, { capture: true });
      targetDistanceRef.current = null;
    };
  }, [camera, controlsRef, enabled, gl, maxDistance]);

  useFrame((_, deltaSeconds) => {
    const targetDistance = targetDistanceRef.current;
    if (targetDistance === null) return;
    const controls = controlsRef.current;
    if (controls === null) return;

    scratchOffset.copy(camera.position).sub(controls.target);
    const currentDistance = scratchOffset.length();
    if (currentDistance <= 1e-6) {
      targetDistanceRef.current = null;
      return;
    }

    const sample = dampZoomDistance(currentDistance, targetDistance, deltaSeconds);
    scratchOffset.multiplyScalar(sample.distance / currentDistance);
    camera.position.copy(controls.target).add(scratchOffset);
    controls.update();
    if (sample.settled) targetDistanceRef.current = null;
  });

  return null;
}
