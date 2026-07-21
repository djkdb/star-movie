import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { DoubleSide, Vector3, type Group, type ShaderMaterial } from 'three';

import type { QualityLevel } from '../domain/models';
import {
  BLACKHOLE_RAYMARCH_FRAGMENT_SHADER,
  BLACKHOLE_VERTEX_SHADER,
} from './BlackholeRenderer';
import { useVisibleElapsedSeconds } from './VisibilityClock';

/** A grand, non-interactive black hole hung deep in the background sky. */
const BACKGROUND_BLACKHOLE_CENTER = new Vector3(-140, 230, -640);
/** How large the hole is in world units (the raymarch physics scale). */
const BACKGROUND_BLACKHOLE_SCALE = 26;
/** Local half-size of the raymarch quad; generous so the full lensed ring and
 *  disk never clip at the quad edge. */
const BACKGROUND_BLACKHOLE_HALF = 17;
/** Tilt the disk toward a fuller 3/4 presentation instead of a thin edge. */
const BACKGROUND_BLACKHOLE_DISK_TILT = 0.62;

/** A distant backdrop needs far fewer march steps than the near hero hole. */
const BACKGROUND_STEPS_BY_QUALITY: Readonly<Record<QualityLevel, number>> = {
  full: 52,
  reducedBackground: 36,
  minimumParticles: 28,
  reducedBloom: 24,
};

export interface BackgroundBlackholeProps {
  reducedMotion?: boolean;
  qualityLevel?: QualityLevel;
}

/**
 * The same raymarched Gargantua as the archive hole, but staged as a vast,
 * silent centerpiece far in the deep background — no interaction, a slow
 * majestic drift, and a low step budget since it is only a backdrop. It faces
 * the camera so its lensed disk always reads front-on as the sky's grand
 * anchor, and stays transparent everywhere else so it composites into the
 * star field.
 */
export function BackgroundBlackhole({
  reducedMotion = false,
  qualityLevel = 'full',
}: BackgroundBlackholeProps) {
  const billboardRef = useRef<Group>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uArousal: { value: 0 },
      uCameraPos: { value: new Vector3() },
      uCenter: { value: BACKGROUND_BLACKHOLE_CENTER.clone() },
      uScale: { value: BACKGROUND_BLACKHOLE_SCALE },
      uSteps: { value: BACKGROUND_STEPS_BY_QUALITY.full },
      uDiskTilt: { value: BACKGROUND_BLACKHOLE_DISK_TILT },
    }),
    [],
  );

  const steps = BACKGROUND_STEPS_BY_QUALITY[qualityLevel];

  useFrame((state) => {
    const billboard = billboardRef.current;
    if (billboard !== null) billboard.quaternion.copy(state.camera.quaternion);
    const material = materialRef.current;
    if (material !== null) {
      material.uniforms.uTime!.value = reducedMotion ? 0 : elapsedVisibleSeconds.current;
      material.uniforms.uSteps!.value = steps;
      (material.uniforms.uCameraPos!.value as Vector3).copy(state.camera.position);
    }
  });

  return (
    <group
      name="background-blackhole"
      position={[
        BACKGROUND_BLACKHOLE_CENTER.x,
        BACKGROUND_BLACKHOLE_CENTER.y,
        BACKGROUND_BLACKHOLE_CENTER.z,
      ]}
      ref={billboardRef}
      scale={BACKGROUND_BLACKHOLE_SCALE}
    >
      <mesh name="background-blackhole-disk">
        <planeGeometry args={[BACKGROUND_BLACKHOLE_HALF * 2, BACKGROUND_BLACKHOLE_HALF * 2]} />
        <shaderMaterial
          depthWrite={false}
          fragmentShader={BLACKHOLE_RAYMARCH_FRAGMENT_SHADER}
          ref={materialRef}
          side={DoubleSide}
          transparent
          toneMapped={false}
          uniforms={uniforms}
          vertexShader={BLACKHOLE_VERTEX_SHADER}
        />
      </mesh>
    </group>
  );
}
