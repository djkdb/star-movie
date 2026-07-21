import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { AdditiveBlending, type Group, type PointsMaterial } from 'three';

import type { Galaxy, Genre } from '../domain/models';
import type { GalaxyPrimitive } from './galaxyThemes';
import {
  buildGenreGalaxyRenderModels,
  classifyGalaxyPrimitive,
  effectiveGalaxyOpacity,
  GALAXY_ROTATION_RADIANS_PER_SECOND,
  primitiveLinePoints,
  primitivePositions,
  resolveGalaxyIntensityTarget,
  stepGalaxyIntensity,
  type GenreGalaxyRenderModel,
} from './galaxyRendererModel';

type LineHandle = ComponentRef<typeof Line>;

/** Live intensity is shared by ref so a galaxy's whole primitive set brightens
 *  and dims together each frame without re-rendering React. */
type IntensityRef = { readonly current: number };

interface PrimitiveProps {
  primitive: GalaxyPrimitive;
  color: string;
  intensityRef: IntensityRef;
  renderIntensity: number;
  placementRadius: number;
}

function GalaxyLinePrimitive({ primitive, color, intensityRef, renderIntensity }: PrimitiveProps) {
  const lineRef = useRef<LineHandle | null>(null);
  const points = useMemo(() => primitiveLinePoints(primitive), [primitive]);

  useEffect(() => {
    const material = lineRef.current?.material;
    if (material === undefined) return;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.needsUpdate = true;
  }, []);

  useFrame(() => {
    const material = lineRef.current?.material;
    if (material !== undefined) {
      material.opacity = effectiveGalaxyOpacity(primitive.opacity, intensityRef.current);
    }
  });

  return (
    <Line
      color={color}
      lineWidth={3}
      opacity={effectiveGalaxyOpacity(primitive.opacity, renderIntensity)}
      points={points}
      ref={lineRef}
      toneMapped={false}
      transparent
    />
  );
}

function GalaxyPointsPrimitive({
  primitive,
  color,
  intensityRef,
  renderIntensity,
  placementRadius,
}: PrimitiveProps) {
  const materialRef = useRef<PointsMaterial>(null);
  const positions = useMemo(() => primitivePositions(primitive), [primitive]);
  const size = primitive.particleSize ?? placementRadius * 0.045;

  useFrame(() => {
    if (materialRef.current !== null) {
      materialRef.current.opacity = effectiveGalaxyOpacity(primitive.opacity, intensityRef.current);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
      </bufferGeometry>
      <pointsMaterial
        blending={AdditiveBlending}
        color={color}
        depthWrite={false}
        opacity={effectiveGalaxyOpacity(primitive.opacity, renderIntensity)}
        ref={materialRef}
        size={size}
        sizeAttenuation
        toneMapped={false}
        transparent
      />
    </points>
  );
}

function renderPrimitive(
  primitive: GalaxyPrimitive,
  index: number,
  props: Omit<PrimitiveProps, 'primitive'>,
) {
  const key = `${primitive.kind}-${index}`;
  const strategy = classifyGalaxyPrimitive(primitive.kind);
  if (strategy === 'line') {
    return <GalaxyLinePrimitive key={key} primitive={primitive} {...props} />;
  }
  return <GalaxyPointsPrimitive key={key} primitive={primitive} {...props} />;
}

interface GenreGalaxyProps {
  model: GenreGalaxyRenderModel;
  selectedGenres: ReadonlySet<Genre>;
  reducedMotion: boolean;
}

function GenreGalaxy({ model, selectedGenres, reducedMotion }: GenreGalaxyProps) {
  const groupRef = useRef<Group>(null);
  const target = resolveGalaxyIntensityTarget(model.genre, selectedGenres);
  const targetRef = useRef(target);
  targetRef.current = target;
  const intensityRef = useRef(target);

  useFrame((_, delta) => {
    if (reducedMotion) {
      // Under reduced motion the frame loop is on demand; the render-time
      // opacity already reflects the target, so just keep the ref in sync.
      intensityRef.current = targetRef.current;
      return;
    }
    intensityRef.current = stepGalaxyIntensity(intensityRef.current, targetRef.current, delta);
    if (groupRef.current !== null) {
      groupRef.current.rotation.y += delta * GALAXY_ROTATION_RADIANS_PER_SECOND;
    }
  });

  // Reduced motion snaps to the target so genre dimming applies without frames;
  // full motion starts from the live tween value to avoid a jump on re-render.
  const renderIntensity = reducedMotion ? target : intensityRef.current;

  return (
    <group
      name={`genre-galaxy-${model.id}`}
      position={[model.center.x, model.center.y, model.center.z]}
      ref={groupRef}
      userData={{ archiveObjectType: 'genre-galaxy', genre: model.genre }}
    >
      {model.primitives.map((primitive, index) =>
        renderPrimitive(primitive, index, {
          color: model.primaryColor,
          intensityRef,
          renderIntensity,
          placementRadius: model.placementRadius,
        }),
      )}
    </group>
  );
}

export interface GalaxyRendererProps {
  galaxies: readonly Galaxy[];
  selectedGenres: ReadonlySet<Genre>;
  reducedMotion: boolean;
}

/**
 * Renders the always-present genre galaxies that until now existed only in
 * state and tests. Each genre gets its themed silhouette (spiral, nebula,
 * rings…), and the genre filter ignites the chosen galaxy while dimming the
 * others, sharing the star spotlight's tween.
 */
export function GalaxyRenderer({ galaxies, selectedGenres, reducedMotion }: GalaxyRendererProps) {
  const models = useMemo(() => buildGenreGalaxyRenderModels(galaxies), [galaxies]);

  return (
    <group name="genre-galaxies">
      {models.map((model) => (
        <GenreGalaxy
          key={model.id}
          model={model}
          reducedMotion={reducedMotion}
          selectedGenres={selectedGenres}
        />
      ))}
    </group>
  );
}
