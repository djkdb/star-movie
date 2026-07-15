import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, DoubleSide, type Group, type ShaderMaterial } from 'three';

import type { StarDragPayload } from './starVisualModel';
import {
  BLACKHOLE_CORE_RADIUS,
  BLACKHOLE_DISK_INNER_RADIUS,
  BLACKHOLE_DISK_OUTER_RADIUS,
  BLACKHOLE_DISTORTION_MAX_STRENGTH,
  BLACKHOLE_DISTORTION_RADIUS,
  BLACKHOLE_POSITION,
  getBlackholeRotation,
  isBlackholeDropHit,
  isValidBlackholeDragPayload,
} from './blackholeModel';
import { useVisibleElapsedSeconds } from './VisibilityClock';

const DISTORTION_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISTORTION_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uMaxStrength;

  void main() {
    vec2 centered = vUv - vec2(0.5);
    float radius = length(centered) * 2.0;
    if (radius >= 1.0 || radius <= 0.32) discard;
    float boundedStrength = min(uMaxStrength, uMaxStrength * sin((radius - 0.32) / 0.68 * 3.14159265));
    float lensBand = 0.45 + 0.55 * sin(radius * 32.0 - uTime * 2.0);
    float alpha = boundedStrength * lensBand * smoothstep(1.0, 0.74, radius);
    gl_FragColor = vec4(0.25, 0.48, 1.0, alpha);
  }
`;

export interface BlackholeRendererProps {
  activeDragPayload?: StarDragPayload | null;
  onDropStar(payload: StarDragPayload): void;
  onOpenArchive(): void;
}

export function BlackholeRenderer({
  activeDragPayload = null,
  onDropStar,
  onOpenArchive,
}: BlackholeRendererProps) {
  const diskRef = useRef<Group>(null);
  const distortionRef = useRef<ShaderMaterial>(null);
  const didDropRef = useRef(false);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const position = useMemo(
    () => [BLACKHOLE_POSITION.x, BLACKHOLE_POSITION.y, BLACKHOLE_POSITION.z] as const,
    [],
  );

  useFrame(() => {
    if (diskRef.current !== null) {
      diskRef.current.rotation.z = getBlackholeRotation(elapsedVisibleSeconds.current);
    }
    if (distortionRef.current !== null) {
      distortionRef.current.uniforms.uTime!.value = elapsedVisibleSeconds.current;
    }
  });

  const handleDrop = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (
      isValidBlackholeDragPayload(activeDragPayload)
      && isBlackholeDropHit(event.point)
    ) {
      didDropRef.current = true;
      onDropStar(activeDragPayload);
    }
  };
  const handleOpenArchive = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (didDropRef.current) {
      didDropRef.current = false;
      return;
    }
    onOpenArchive();
  };

  return (
    <group
      name="blackhole"
      position={position}
      userData={{
        archiveObjectType: 'blackhole',
        fixedPosition: BLACKHOLE_POSITION,
        dropRadius: BLACKHOLE_DISTORTION_RADIUS,
        maxDistortion: BLACKHOLE_DISTORTION_MAX_STRENGTH,
      }}
    >
      <mesh
        name="blackhole-core"
        onClick={handleOpenArchive}
        onPointerUp={handleDrop}
      >
        <sphereGeometry args={[BLACKHOLE_CORE_RADIUS, 32, 24]} />
        <meshBasicMaterial color="#000006" toneMapped={false} />
      </mesh>
      <group ref={diskRef}>
        <mesh
          name="blackhole-accretion-disk"
          onClick={handleOpenArchive}
          onPointerUp={handleDrop}
        >
          <ringGeometry
            args={[BLACKHOLE_DISK_INNER_RADIUS, BLACKHOLE_DISK_OUTER_RADIUS, 96, 3]}
          />
          <meshBasicMaterial
            blending={AdditiveBlending}
            color="#8aa8ff"
            depthWrite={false}
            opacity={0.58}
            side={DoubleSide}
            transparent
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh
        name="blackhole-bounded-distortion"
        onClick={handleOpenArchive}
        onPointerUp={handleDrop}
        scale={[BLACKHOLE_DISTORTION_RADIUS * 2, BLACKHOLE_DISTORTION_RADIUS * 2, 1]}
      >
        <planeGeometry args={[1, 1, 1, 1]} />
        <shaderMaterial
          blending={AdditiveBlending}
          depthWrite={false}
          fragmentShader={DISTORTION_FRAGMENT_SHADER}
          ref={distortionRef}
          side={DoubleSide}
          transparent
          uniforms={{
            uTime: { value: 0 },
            uMaxStrength: { value: BLACKHOLE_DISTORTION_MAX_STRENGTH },
          }}
          vertexShader={DISTORTION_VERTEX_SHADER}
        />
      </mesh>
    </group>
  );
}
