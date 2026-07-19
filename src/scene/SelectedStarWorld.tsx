import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BackSide, DoubleSide, type Group } from 'three';

import type { Star } from '../domain/models';
import { getSurfaceTexture } from './planetSurfaceTextures';
import { getStarInstancePhase } from './starRendererModel';
import { getStarWorldVisual } from './starWorldModel';
import { sampleStarDisplayOffset } from './starVisualModel';
import { useVisibleElapsedSeconds } from './VisibilityClock';

const NO_RAYCAST = () => null;

export interface SelectedStarWorldProps {
  star: Star;
  reducedMotion?: boolean;
}

/**
 * The selected star bloomed into a detailed world: a genre-colored, textured
 * planet that scales up in place at the star's drifting position, slowly spins,
 * and (for well-rated works) wears a ring. Purely decorative — it never
 * intercepts pointer input, so selection and camera behavior are unchanged.
 */
export function SelectedStarWorld({ star, reducedMotion = false }: SelectedStarWorldProps) {
  const groupRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const scaleRef = useRef(reducedMotion ? 1 : 0.02);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const phase = useMemo(() => getStarInstancePhase(star.id), [star.id]);
  const visual = useMemo(() => getStarWorldVisual(star), [star]);
  const texture = useMemo(() => getSurfaceTexture(visual.spec), [visual.spec]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (group === null) return;
    const time = reducedMotion ? 0 : elapsedVisibleSeconds.current;
    const offset = sampleStarDisplayOffset(star.position, time, phase);
    group.position.set(
      star.position.x + offset.x,
      star.position.y + offset.y,
      star.position.z + offset.z,
    );
    // Ease the world open on selection.
    scaleRef.current += (1 - scaleRef.current) * Math.min(1, delta * 4.5);
    if (reducedMotion) scaleRef.current = 1;
    group.scale.setScalar(scaleRef.current);
    if (spinRef.current !== null && !reducedMotion) {
      spinRef.current.rotation.y = time * 0.3;
    }
  });

  return (
    <group
      name={`selected-star-world-${star.id}`}
      ref={groupRef}
      position={[star.position.x, star.position.y, star.position.z]}
      scale={scaleRef.current}
      userData={{ archiveObjectType: 'star-world', starId: star.id }}
    >
      <group ref={spinRef}>
        <mesh raycast={NO_RAYCAST}>
          <sphereGeometry args={[visual.size, 40, 28]} />
          <meshStandardMaterial
            map={texture}
            emissive={visual.spec.emissiveColor}
            emissiveIntensity={visual.emissiveIntensity}
            metalness={0.12}
            roughness={0.82}
          />
        </mesh>
        {visual.ring !== undefined && (
          <mesh raycast={NO_RAYCAST} rotation={[Math.PI / 2.3, 0.3, 0]}>
            <ringGeometry
              args={[
                visual.size * visual.ring.innerScale,
                visual.size * visual.ring.outerScale,
                72,
              ]}
            />
            <meshBasicMaterial
              color={visual.ring.color}
              transparent
              opacity={0.5}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
      {/* Atmospheric rim glow. */}
      <mesh raycast={NO_RAYCAST} scale={[1.2, 1.2, 1.2]}>
        <sphereGeometry args={[visual.size, 28, 20]} />
        <meshBasicMaterial
          color={visual.atmosphere}
          transparent
          opacity={0.22}
          side={BackSide}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight color={visual.atmosphere} distance={visual.size * 10} intensity={0.7} />
    </group>
  );
}
