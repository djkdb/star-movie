import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { AdditiveBlending, type Group, type Mesh, type SpriteMaterial } from 'three';

import type { Star } from '../domain/models';
import { getStarInstancePhase } from './starRendererModel';
import { getStarHaloTexture, getStarSpikeTexture } from './starSpriteTextures';
import { useThreeResourceTracking } from './threeResourceRegistry';
import { useVisibleElapsedSeconds } from './VisibilityClock';
import {
  createStarDragPayload,
  getStarAppearance,
  sampleStarRenderTransform,
  STAR_HOVER_SCALE,
  STAR_IDLE_SCALE,
  STAR_LABEL_FADE_SECONDS,
  type StarDragPayload,
} from './starVisualModel';

const NO_RAYCAST = () => null;

export interface IndividualStarMeshProps {
  star: Star;
  selected?: boolean;
  opacity?: number;
  reducedMotion?: boolean;
  onSelect: (starId: string) => void;
  onDragStart?: (payload: StarDragPayload) => void;
  onDragEnd?: (payload: StarDragPayload) => void;
}

/** Individual renderer used for archives containing at most 50 active works. */
export function IndividualStarMesh({
  star,
  selected = false,
  opacity = 1,
  reducedMotion = false,
  onSelect,
  onDragStart,
  onDragEnd,
}: IndividualStarMeshProps) {
  const groupRef = useRef<Group>(null);
  const haloMaterialRef = useRef<SpriteMaterial>(null);
  const hoverBlendRef = useRef(0);
  const trackMeshResources = useThreeResourceTracking<Mesh>();
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const gl = useThree((state) => state.gl);
  const [hovered, setHovered] = useState(false);
  const visual = useMemo(
    () => getStarAppearance(star.id, star.rating, star.genre, star.rewatchCount ?? 0),
    [star.id, star.rating, star.genre],
  );
  const spikeAngles = useMemo(() => {
    if (visual.spikeCount === 0) return [] as number[];
    const step = Math.PI / (visual.spikeCount / 2);
    return Array.from(
      { length: visual.spikeCount / 2 },
      (_, index) => visual.spikeRotation + index * step,
    );
  }, [visual.spikeCount, visual.spikeRotation]);
  const phaseSeed = useMemo(() => getStarInstancePhase(star.id), [star.id]);
  const dragPayload = useMemo(
    () => createStarDragPayload(star.id, star.position),
    [star.id, star.position],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (group === null) return;
    const transform = sampleStarRenderTransform(
      star,
      elapsedVisibleSeconds.current,
      phaseSeed,
      hovered,
      reducedMotion,
    );
    group.position.set(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    );
    group.rotation.y = transform.rotationY;

    // Ease toward the hover state instead of snapping scale 1→1.5, and lift
    // the halo so the star swells like a long exposure catching the light.
    const target = hovered ? 1 : 0;
    hoverBlendRef.current = reducedMotion
      ? target
      : hoverBlendRef.current + (target - hoverBlendRef.current) * (1 - Math.exp(-9 * delta));
    const blend = hoverBlendRef.current;
    group.scale.setScalar(STAR_IDLE_SCALE + (STAR_HOVER_SCALE - STAR_IDLE_SCALE) * blend);
    const halo = haloMaterialRef.current;
    if (halo !== null) halo.opacity = visual.haloOpacity * opacity * (1 + 0.6 * blend);
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
      scale={STAR_IDLE_SCALE}
      // A filtered-out star (dimmed by the genre spotlight) is removed from the
      // sky entirely so only the chosen genre remains — spotlit stars stay lit.
      visible={opacity > 0.5}
      userData={{
        archiveObjectType: 'star',
        starId: star.id,
        dragPayload,
      }}
    >
      {/* Generous invisible tap target: the core sphere is far too small for a
          fingertip, so taps kept missing on phones. */}
      <mesh
        name={`star-hit-${star.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(star.id);
        }}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        userData={{ archiveObjectType: 'star-hit', starId: star.id }}
      >
        <sphereGeometry args={[Math.max(visual.radius * 3, 2.4), 12, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0} transparent />
      </mesh>
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
          gl.domElement.style.cursor = '';
        }}
        onPointerOver={(event) => {
          stop(event);
          setHovered(true);
          gl.domElement.style.cursor = 'pointer';
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
      {/* Soft halo so every star glows like a long-exposure photograph. */}
      <sprite
        name="star-halo"
        raycast={NO_RAYCAST}
        scale={[
          visual.radius * visual.haloScale,
          visual.radius * visual.haloScale,
          1,
        ]}
      >
        <spriteMaterial
          blending={AdditiveBlending}
          color={visual.color}
          depthWrite={false}
          map={getStarHaloTexture()}
          opacity={visual.haloOpacity * opacity}
          ref={haloMaterialRef}
          transparent
          toneMapped={false}
        />
      </sprite>
      {/* Diffraction spikes: each elongated sprite draws two opposite points. */}
      {spikeAngles.map((angle) => (
        <sprite
          key={`spike-${angle}`}
          name="star-spike"
          raycast={NO_RAYCAST}
          scale={[
            visual.radius * visual.spikeScale,
            visual.radius * visual.spikeScale * 0.4,
            1,
          ]}
        >
          <spriteMaterial
            blending={AdditiveBlending}
            color={visual.color}
            depthWrite={false}
            map={getStarSpikeTexture()}
            opacity={0.5 * opacity}
            rotation={angle}
            transparent
            toneMapped={false}
          />
        </sprite>
      ))}
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
