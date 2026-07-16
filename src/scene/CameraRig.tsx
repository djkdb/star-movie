import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import { PerspectiveCamera, Vector3, type Camera } from 'three';

import type { CameraRequest, Constellation, Star } from '../domain/models';
import {
  calculateBoundingBoxFitPose,
  calculateStarFocusPose,
  CameraTweenController,
  resolveCameraFocusRequest,
  type CameraPose,
} from './cameraMath';

export interface CameraControlsLike {
  target: Vector3;
  update(): void;
}

export interface CameraRigProps {
  request: CameraRequest | null;
  stars: readonly Star[];
  constellations: readonly Constellation[];
  selectedStarId?: string | null;
  controlsRef?: RefObject<CameraControlsLike | null>;
  reducedMotion?: boolean;
  onCapturePreFocusPose?: (pose: CameraPose) => void;
  onRequestRejected?: (reason: string, request: CameraRequest) => void;
  onRequestCompleted?: (request: CameraRequest) => void;
}

function readCurrentPose(
  cameraPosition: Vector3,
  controls: CameraControlsLike | null,
): CameraPose {
  return {
    position: {
      x: cameraPosition.x,
      y: cameraPosition.y,
      z: cameraPosition.z,
    },
    target: controls === null
      ? { x: 0, y: 0, z: 0 }
      : {
          x: controls.target.x,
          y: controls.target.y,
          z: controls.target.z,
        },
  };
}

function applyPose(
  pose: CameraPose,
  camera: Camera,
  controls: CameraControlsLike | null,
): void {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  if (controls === null) {
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  } else {
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    controls.update();
  }
}

/**
 * Applies resolved Star and Constellation focus requests without timers.
 * A new request replaces the in-flight tween from the camera's current pose.
 * Reduced-motion users receive the same focus result without interpolation.
 */
export function CameraRig({
  request,
  stars,
  constellations,
  selectedStarId = null,
  controlsRef,
  reducedMotion = false,
  onCapturePreFocusPose,
  onRequestRejected,
  onRequestCompleted,
}: CameraRigProps) {
  const camera = useThree(({ camera: activeCamera }) => activeCamera);
  const size = useThree(({ size: viewportSize }) => viewportSize);
  const tweenController = useRef(new CameraTweenController());
  const activeRequest = useRef<CameraRequest | null>(null);

  useEffect(() => {
    if (request === null) return;

    const controls = controlsRef?.current ?? null;
    const currentPose = readCurrentPose(camera.position, controls);

    // Free-viewpoint returns carry a resolved pose and reuse the focus tween.
    if (request.type === 'free') {
      if (reducedMotion) {
        tweenController.current.cancel();
        activeRequest.current = null;
        applyPose(request.pose, camera, controls);
        onRequestCompleted?.(request);
        return;
      }
      activeRequest.current = request;
      tweenController.current.replace(currentPose, request.pose);
      return;
    }

    const resolution = resolveCameraFocusRequest(request, stars, constellations);
    if (!resolution.ok) {
      tweenController.current.cancel();
      activeRequest.current = null;
      onRequestRejected?.(resolution.reason, request);
      return;
    }

    // Capture the pose entered from a selection so deselection can restore it.
    // The capture-once guard lives in the command, but the selection gate keeps
    // pure focus (e.g. ListView) from ever capturing a pose.
    if (resolution.request.type === 'star' && selectedStarId !== null) {
      onCapturePreFocusPose?.(currentPose);
    }

    const destination = resolution.request.type === 'star'
      ? calculateStarFocusPose(currentPose, resolution.request.position)
      : calculateBoundingBoxFitPose(
          currentPose,
          resolution.request.activePositions,
          camera instanceof PerspectiveCamera ? camera.fov : 75,
          size.width / Math.max(1, size.height),
        );

    if (reducedMotion) {
      tweenController.current.cancel();
      activeRequest.current = null;
      applyPose(destination, camera, controls);
      onRequestCompleted?.(request);
      return;
    }

    activeRequest.current = request;
    tweenController.current.replace(currentPose, destination);
  }, [
    camera,
    constellations,
    controlsRef,
    onCapturePreFocusPose,
    onRequestCompleted,
    onRequestRejected,
    reducedMotion,
    request,
    selectedStarId,
    size.height,
    size.width,
    stars,
  ]);

  useEffect(() => () => {
    tweenController.current.cancel();
    activeRequest.current = null;
  }, []);

  useFrame((_, deltaSeconds) => {
    const sample = tweenController.current.advance(deltaSeconds);
    if (sample === null) return;

    applyPose(sample.pose, camera, controlsRef?.current ?? null);
    if (sample.completed) {
      const completedRequest = activeRequest.current;
      activeRequest.current = null;
      if (completedRequest !== null) onRequestCompleted?.(completedRequest);
    }
  });

  return null;
}
