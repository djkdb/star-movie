import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, DoubleSide, type Group, type ShaderMaterial } from 'three';

import type { StarDragPayload } from './starVisualModel';
import {
  BLACKHOLE_CORE_RADIUS,
  BLACKHOLE_DISK_INNER_RADIUS,
  BLACKHOLE_DISTORTION_MAX_STRENGTH,
  BLACKHOLE_DISTORTION_RADIUS,
  BLACKHOLE_POSITION,
  getBlackholeRotation,
  isBlackholeDropHit,
  isValidBlackholeDragPayload,
} from './blackholeModel';
import { useVisibleElapsedSeconds } from './VisibilityClock';

const DISK_INNER = BLACKHOLE_DISK_INNER_RADIUS;
const DISK_OUTER = 11;

const PASS_THROUGH_VERTEX_SHADER = `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Photographic accretion disk: a white-hot inner edge fading out through orange
 * to deep red, with Doppler beaming (one rotating side brighter) and fine
 * turbulent streaks — the Interstellar / Event-Horizon-Telescope read.
 */
const DISK_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;

  void main() {
    float r = length(vLocal);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float angle = atan(vLocal.y, vLocal.x);

    float radial = smoothstep(1.0, 0.0, t);
    float doppler = 0.5 + 0.5 * cos(angle - uTime * 0.7);
    float streaks = 0.82 + 0.18 * sin(angle * 20.0 + uTime * 1.6 - t * 7.0);
    float intensity = radial * mix(0.65, 1.4, doppler) * streaks;

    vec3 hot = vec3(1.0, 0.96, 0.88);
    vec3 mid = vec3(1.0, 0.62, 0.26);
    vec3 cool = vec3(0.72, 0.2, 0.07);
    vec3 color = mix(hot, mid, smoothstep(0.0, 0.4, t));
    color = mix(color, cool, smoothstep(0.4, 1.0, t));

    float alpha = intensity * (0.95 - 0.45 * t);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** Soft billboard halo so the hole reads as a bright, bloomed light source. */
const GLOW_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vLocal;
  uniform float uRadius;

  void main() {
    float d = length(vLocal) / uRadius;
    float alpha = pow(clamp(1.0 - d, 0.0, 1.0), 2.6) * 0.5;
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(1.0, 0.68, 0.4, alpha);
  }
`;

const DISTORTION_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uMaxStrength;
  uniform float uRadius;

  void main() {
    float radius = length(vLocal) / uRadius;
    if (radius >= 1.0 || radius <= 0.32) discard;
    float boundedStrength = min(uMaxStrength, uMaxStrength * sin((radius - 0.32) / 0.68 * 3.14159265));
    float lensBand = 0.45 + 0.55 * sin(radius * 30.0 - uTime * 2.0);
    float alpha = boundedStrength * lensBand * smoothstep(1.0, 0.74, radius) * 0.28;
    gl_FragColor = vec4(0.85, 0.72, 0.55, alpha);
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
  const diskMaterialRef = useRef<ShaderMaterial>(null);
  const distortionRef = useRef<ShaderMaterial>(null);
  const didDropRef = useRef(false);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const position = useMemo(
    () => [BLACKHOLE_POSITION.x, BLACKHOLE_POSITION.y, BLACKHOLE_POSITION.z] as const,
    [],
  );

  useFrame(() => {
    const elapsed = elapsedVisibleSeconds.current;
    if (diskRef.current !== null) {
      diskRef.current.rotation.z = getBlackholeRotation(elapsed);
    }
    if (diskMaterialRef.current !== null) {
      diskMaterialRef.current.uniforms.uTime!.value = elapsed;
    }
    if (distortionRef.current !== null) {
      distortionRef.current.uniforms.uTime!.value = elapsed;
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
      {/* Soft orange halo behind everything. */}
      <mesh name="blackhole-glow" position={[0, 0, -0.2]}>
        <planeGeometry args={[DISK_OUTER * 3, DISK_OUTER * 3]} />
        <shaderMaterial
          blending={AdditiveBlending}
          depthWrite={false}
          fragmentShader={GLOW_FRAGMENT_SHADER}
          transparent
          uniforms={{ uRadius: { value: DISK_OUTER * 1.5 } }}
          vertexShader={PASS_THROUGH_VERTEX_SHADER}
        />
      </mesh>

      {/* Event horizon shadow. */}
      <mesh
        name="blackhole-core"
        onClick={handleOpenArchive}
        onPointerUp={handleDrop}
      >
        <sphereGeometry args={[BLACKHOLE_CORE_RADIUS, 48, 32]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>

      {/* Bright photon ring hugging the shadow. */}
      <mesh name="blackhole-photon-ring">
        <ringGeometry args={[BLACKHOLE_CORE_RADIUS + 0.05, BLACKHOLE_CORE_RADIUS + 0.45, 128, 1]} />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#ffe6bf"
          depthWrite={false}
          opacity={0.95}
          side={DoubleSide}
          transparent
          toneMapped={false}
        />
      </mesh>

      {/* Tilted, spinning accretion disk. */}
      <group rotation={[1.12, 0, 0]}>
        <group ref={diskRef}>
          <mesh
            name="blackhole-accretion-disk"
            onClick={handleOpenArchive}
            onPointerUp={handleDrop}
          >
            <ringGeometry args={[DISK_INNER, DISK_OUTER, 160, 8]} />
            <shaderMaterial
              blending={AdditiveBlending}
              depthWrite={false}
              fragmentShader={DISK_FRAGMENT_SHADER}
              ref={diskMaterialRef}
              side={DoubleSide}
              transparent
              uniforms={{
                uTime: { value: 0 },
                uInner: { value: DISK_INNER },
                uOuter: { value: DISK_OUTER },
              }}
              vertexShader={PASS_THROUGH_VERTEX_SHADER}
            />
          </mesh>
        </group>
      </group>

      {/* Lensing shimmer / drop-zone hint. */}
      <mesh
        name="blackhole-bounded-distortion"
        onClick={handleOpenArchive}
        onPointerUp={handleDrop}
      >
        <planeGeometry args={[BLACKHOLE_DISTORTION_RADIUS * 2, BLACKHOLE_DISTORTION_RADIUS * 2]} />
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
            uRadius: { value: BLACKHOLE_DISTORTION_RADIUS },
          }}
          vertexShader={PASS_THROUGH_VERTEX_SHADER}
        />
      </mesh>
    </group>
  );
}
