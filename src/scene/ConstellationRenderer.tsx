import { Html, Line } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import type { Group, Object3D } from 'three';

import type { Constellation, ConstellationDraft, Star } from '../domain/models';
import {
  calculateConstellationLabelPosition,
  CONSTELLATION_HOVER_OPACITY,
  CONSTELLATION_IDLE_OPACITY,
  CONSTELLATION_NAME_FADE_SECONDS,
  createConstellationDraftPreviewPoints,
  createConstellationLineViewModels,
  sampleConstellationLinePoints,
  type ConstellationLineViewModel,
} from './constellationRendererModel';
import { useThreeResourceTracking } from './threeResourceRegistry';
import { useVisibleElapsedSeconds } from './VisibilityClock';

type LineHandle = ComponentRef<typeof Line>;

interface ActiveConstellationLineProps {
  line: ConstellationLineViewModel;
  activeStars: readonly Star[];
  reducedMotion: boolean;
}

function ActiveConstellationLine({
  line,
  activeStars,
  reducedMotion,
}: ActiveConstellationLineProps) {
  const [hovered, setHovered] = useState(false);
  const trackGlowResources = useThreeResourceTracking<Object3D>();
  const trackLineResources = useThreeResourceTracking<Object3D>();
  const glowLineRef = useRef<LineHandle | null>(null);
  const mainLineRef = useRef<LineHandle | null>(null);
  const labelGroupRef = useRef<Group>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const opacity = hovered
    ? CONSTELLATION_HOVER_OPACITY
    : CONSTELLATION_IDLE_OPACITY;
  const stop = (event: ThreeEvent<PointerEvent>) => event.stopPropagation();

  const setGlowRef = useCallback((node: LineHandle | null) => {
    glowLineRef.current = node;
    trackGlowResources(node);
  }, [trackGlowResources]);
  const setMainRef = useCallback((node: LineHandle | null) => {
    mainLineRef.current = node;
    trackLineResources(node);
  }, [trackLineResources]);

  useFrame(() => {
    const points = sampleConstellationLinePoints(
      activeStars,
      elapsedVisibleSeconds.current,
      reducedMotion,
    );
    if (points.length < 2) return;
    const flat = points.flat();
    glowLineRef.current?.geometry.setPositions(flat);
    mainLineRef.current?.geometry.setPositions(flat);
    const label = calculateConstellationLabelPosition(points);
    labelGroupRef.current?.position.set(label[0], label[1], label[2]);
  });

  return (
    <Select enabled>
      <group
      name={`constellation-${line.id}`}
      userData={{
        activeStarIds: line.activeStarIds,
        archiveObjectType: 'constellation',
        constellationId: line.id,
      }}
    >
      <Line
        color={line.color}
        dispose={null}
        lineWidth={6}
        opacity={opacity * 0.2}
        points={line.points}
        ref={setGlowRef}
        transparent
        toneMapped={false}
        userData={{
          archiveObjectType: 'active-constellation-line',
          constellationId: line.id,
          selectiveBloomTarget: true,
        }}
      />
      <Line
        color={line.color}
        dispose={null}
        lineWidth={2}
        onPointerOut={(event) => {
          stop(event);
          setHovered(false);
        }}
        onPointerOver={(event) => {
          stop(event);
          setHovered(true);
        }}
        opacity={opacity}
        points={line.points}
        ref={setMainRef}
        transparent
        toneMapped={false}
        userData={{
          archiveObjectType: 'active-constellation-line',
          bloomIntensity: 1,
          constellationId: line.id,
          selectiveBloomTarget: true,
        }}
      />
      <group ref={labelGroupRef} position={line.labelPosition}>
      <Html
        center
        style={{
          opacity: hovered ? 1 : 0,
          pointerEvents: 'none',
          transition: `opacity ${CONSTELLATION_NAME_FADE_SECONDS}s ease`,
          visibility: hovered ? 'visible' : 'hidden',
          transitionProperty: 'opacity, visibility',
          transitionDuration: `${CONSTELLATION_NAME_FADE_SECONDS}s, 0s`,
          transitionDelay: hovered
            ? '0s, 0s'
            : `0s, ${CONSTELLATION_NAME_FADE_SECONDS}s`,
        }}
        wrapperClass="constellation-name-label-anchor"
      >
        <span className="constellation-name-label" role="tooltip">
          {line.name}
        </span>
      </Html>
      </group>
      </group>
    </Select>
  );
}

export interface ConstellationRendererProps {
  stars: readonly Star[];
  constellations: readonly Constellation[];
  draft: Readonly<ConstellationDraft>;
  reducedMotion: boolean;
}

export function ConstellationRenderer({
  stars,
  constellations,
  draft,
  reducedMotion,
}: ConstellationRendererProps) {
  const lines = useMemo(
    () => createConstellationLineViewModels(constellations, stars),
    [constellations, stars],
  );
  const starsById = useMemo(
    () => new Map(stars.map((star) => [star.id, star] as const)),
    [stars],
  );
  const previewPoints = useMemo(
    () => draft.active
      ? createConstellationDraftPreviewPoints(draft.starIds, stars)
      : [],
    [draft.active, draft.starIds, stars],
  );

  return (
    <group
      name="constellations"
      userData={{
        activeLineCount: lines.length,
        draftPreviewVisible: previewPoints.length >= 2,
      }}
    >
      {lines.map((line) => (
        <ActiveConstellationLine
          activeStars={line.activeStarIds.flatMap((id) => {
            const star = starsById.get(id);
            return star === undefined ? [] : [star];
          })}
          key={line.id}
          line={line}
          reducedMotion={reducedMotion}
        />
      ))}
      {previewPoints.length >= 2 && (
        <Line
          color="#ffffff"
          dashed
          dashScale={1.5}
          gapSize={0.45}
          lineWidth={2}
          name="constellation-draft-preview"
          opacity={0.8}
          points={previewPoints}
          transparent
          toneMapped={false}
          userData={{ archiveObjectType: 'constellation-draft-preview' }}
        />
      )}
    </group>
  );
}
