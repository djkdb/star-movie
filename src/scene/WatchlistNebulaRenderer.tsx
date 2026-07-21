import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { AdditiveBlending, type Group } from 'three';

import type { WatchlistEntry } from '../domain/models';
import { GENRE_FIREWORK_COLORS } from './particleManagerModel';
import { getStarHaloTexture } from './starSpriteTextures';
import { useVisibleElapsedSeconds } from './VisibilityClock';

export interface WatchlistNebulaRendererProps {
  entries: readonly WatchlistEntry[];
  reducedMotion: boolean;
}

/**
 * Every want-to-watch work drifts as a hazy genre-tinted nebula at the spot
 * its star would be born, breathing softly until the log condenses it.
 */
export function WatchlistNebulaRenderer({
  entries,
  reducedMotion,
}: WatchlistNebulaRendererProps) {
  const groupRef = useRef<Group>(null);
  const elapsedVisibleSeconds = useVisibleElapsedSeconds();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null || reducedMotion) return;
    group.children.forEach((child, index) => {
      if (child.name !== 'watchlist-nebula') return;
      const breathe =
        4.6 + Math.sin(elapsedVisibleSeconds.current * 0.6 + index * 1.7) * 0.5;
      child.scale.set(breathe, breathe, 1);
    });
  });

  const hovered = entries.find((entry) => entry.id === hoveredId);

  return (
    <group name="watchlist-nebulae" ref={groupRef}>
      {entries.map((entry) => (
        <sprite
          key={entry.id}
          name="watchlist-nebula"
          position={[entry.position.x, entry.position.y, entry.position.z]}
          scale={[4.6, 4.6, 1]}
          onPointerOut={(event) => {
            event.stopPropagation();
            setHoveredId((current) => (current === entry.id ? null : current));
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHoveredId(entry.id);
          }}
          userData={{ archiveObjectType: 'watchlist-nebula', entryId: entry.id }}
        >
          <spriteMaterial
            blending={AdditiveBlending}
            color={GENRE_FIREWORK_COLORS[entry.genre] ?? '#9fb8ff'}
            depthWrite={false}
            map={getStarHaloTexture()}
            opacity={0.32}
            toneMapped={false}
            transparent
          />
        </sprite>
      ))}
      {hovered !== undefined && (
        <Html
          center
          position={[hovered.position.x, hovered.position.y + 3.4, hovered.position.z]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="star-title-label-anchor"
        >
          <span className="star-title-label" role="tooltip">
            {hovered.title} · 보고 싶어요
          </span>
        </Html>
      )}
    </group>
  );
}
