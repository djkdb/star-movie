import { Select } from '@react-three/postprocessing';

import type { Star } from '../domain/models';
import { IndividualStarMesh } from './IndividualStarMesh';
import { InstancedStarField } from './InstancedStarField';
import { SelectedStarWorld } from './SelectedStarWorld';
import type { StarDragPayload } from './starVisualModel';
import { getStarRenderMode } from './starRendererModel';

export interface StarRendererProps {
  stars: readonly Star[];
  selectedStarId: string | null;
  reducedMotion: boolean;
  onSelect: (starId: string) => void;
  onDragStart?: (payload: StarDragPayload) => void;
  onDragEnd?: (payload: StarDragPayload) => void;
}

/**
 * Switches only the GPU representation. Selection and camera requests stay ID-based
 * in the parent runtime store, so a 50↔51 transition cannot reset either state.
 */
export function StarRenderer({
  stars,
  selectedStarId,
  reducedMotion,
  onSelect,
  onDragStart,
  onDragEnd,
}: StarRendererProps) {
  const renderMode = getStarRenderMode(stars.length);
  const selectedStar =
    selectedStarId === null
      ? undefined
      : stars.find((star) => star.id === selectedStarId);

  const field =
    renderMode === 'instanced' ? (
      <InstancedStarField
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onSelect={onSelect}
        reducedMotion={reducedMotion}
        selectedStarId={selectedStarId}
        stars={stars}
      />
    ) : (
      <group
        name="stars-individual"
        userData={{ renderMode: 'individual', selectedStarId }}
      >
        {stars.map((star) => (
          <IndividualStarMesh
            key={star.id}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
            onSelect={onSelect}
            reducedMotion={reducedMotion}
            selected={selectedStarId === star.id}
            star={star}
          />
        ))}
      </group>
    );

  return (
    <>
      <Select enabled>{field}</Select>
      {/* The selected work blooms into an inspectable world, kept out of the
          bloom selection so its surface reads instead of blowing out. */}
      {selectedStar !== undefined && (
        <SelectedStarWorld reducedMotion={reducedMotion} star={selectedStar} />
      )}
    </>
  );
}
