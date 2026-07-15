import { Html, Line } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import type { Object3D } from 'three';

import type { Constellation, ConstellationDraft, Star } from '../domain/models';
import {
  CONSTELLATION_HOVER_OPACITY,
  CONSTELLATION_IDLE_OPACITY,
  CONSTELLATION_NAME_FADE_SECONDS,
  createConstellationDraftPreviewPoints,
  createConstellationLineViewModels,
  type ConstellationLineViewModel,
} from './constellationRendererModel';
import { useThreeResourceTracking } from './threeResourceRegistry';

interface ActiveConstellationLineProps {
  line: ConstellationLineViewModel;
}

function ActiveConstellationLine({ line }: ActiveConstellationLineProps) {
  const [hovered, setHovered] = useState(false);
  const trackGlowResources = useThreeResourceTracking<Object3D>();
  const trackLineResources = useThreeResourceTracking<Object3D>();
  const opacity = hovered
    ? CONSTELLATION_HOVER_OPACITY
    : CONSTELLATION_IDLE_OPACITY;
  const stop = (event: ThreeEvent<PointerEvent>) => event.stopPropagation();

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
        ref={trackGlowResources}
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
        ref={trackLineResources}
        transparent
        toneMapped={false}
        userData={{
          archiveObjectType: 'active-constellation-line',
          bloomIntensity: 1,
          constellationId: line.id,
          selectiveBloomTarget: true,
        }}
      />
      <Html
        center
        position={line.labelPosition}
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
    </Select>
  );
}

export interface ConstellationRendererProps {
  stars: readonly Star[];
  constellations: readonly Constellation[];
  draft: Readonly<ConstellationDraft>;
}

export function ConstellationRenderer({
  stars,
  constellations,
  draft,
}: ConstellationRendererProps) {
  const lines = useMemo(
    () => createConstellationLineViewModels(constellations, stars),
    [constellations, stars],
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
        <ActiveConstellationLine key={line.id} line={line} />
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
