import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';

import type { Star } from '../domain/models';
import { useThreeResourceTracking } from './threeResourceRegistry';
import { useVisibleElapsedSeconds } from './VisibilityClock';
import {
  createStarDragPayload,
  getRatingVisual,
  sampleStarMotion,
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_LABEL_FADE_SECONDS,
  type StarDragPayload,
} from './starVisualModel';

export interface IndividualStarMeshProps {
  star: Star;
  selected?: boolean;
  opacity?: number;
  onSelect: (starId: string) => void;
  onDragStart?: (payload: StarDragPayload) => void;
  onDragEnd?: (payload: StarDragPayload) => void;
}

/** Individual renderer used for archives containing at most 50 active works. */
export function IndividualStarMesh({
  star,
  selected = false,
  opacity = 1,
  onSelect,
  onDragStart,
  onDragEnd,
}: IndividualStarMeshProps) {
  const groupRef = useRef<Group>(null);
  const trackMeshResources = useThreeResourceTracking<Mesh>();
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const [hovered, setHovered] = useState(false);
  const visual = getRatingVisual(star.rating);
  const dragPayload = useMemo(
    () => createStarDragPayload(star.id, star.position),
    [star.id, star.position],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;
    const motion = sampleStarMotion(elapsedVisibleSeconds.current, star.position.y);
    group.rotation.y = motion.rotationY;
    group.position.y = motion.y;
  });

  const stop = (event: ThreeEvent<PointerEvent>) => event.stopPropagation();
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    stop(event);
    onDragStart?.(dragPayload);
  };
  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    stop(event);
    onDragEnd?.(dragPayload);
  };

  return (
    <group
      ref={groupRef}
      position={[star.position.x, star.position.y, star.position.z]}
      scale={hovered ? STAR_HOVER_SCALE : STAR_IDLE_SCALE}
      userData={{
        archiveObjectType: 'star',
        starId: star.id,
        dragPayload,
      }}
    >
      <mesh
        dispose={null}
        name={`star-${star.id}`}
        ref={trackMeshResources}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(star.id);
        }}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerOut={(event) => {
          stop(event);
          setHovered(false);
        }}
        onPointerOver={(event) => {
          stop(event);
          setHovered(true);
        }}
        onPointerUp={handlePointerUp}
        userData={{
          archiveObjectType: 'star',
          bloomIntensity: visual.bloom,
          selectiveBloomTarget: true,
          rating: star.rating,
          selected,
          starId: star.id,
        }}
      >
        <sphereGeometry args={[visual.radius, 24, 16]} />
        <meshStandardMaterial
          color={visual.color}
          emissive={visual.color}
          emissiveIntensity={visual.bloom}
          opacity={opacity}
          transparent={opacity < 1}
          toneMapped={false}
        />
      </mesh>
      <Html
        center
        position={[0, visual.radius + 0.65, 0]}
        style={{
          opacity: hovered ? 1 : 0,
          pointerEvents: 'none',
          transition: `opacity ${STAR_LABEL_FADE_SECONDS}s ease`,
          visibility: hovered ? 'visible' : 'hidden',
          transitionProperty: 'opacity, visibility',
          transitionDuration: `${STAR_LABEL_FADE_SECONDS}s, 0s`,
          transitionDelay: hovered ? '0s, 0s' : `0s, ${STAR_LABEL_FADE_SECONDS}s`,
        }}
        wrapperClass="star-title-label-anchor"
      >
        <span className="star-title-label" role="tooltip">
          {star.title}
        </span>
      </Html>
    </group>
  );
}
