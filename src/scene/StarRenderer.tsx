import type { Genre, Star } from '../domain/models';
import { IndividualStarMesh } from './IndividualStarMesh';
import { InstancedStarField } from './InstancedStarField';
import { resolveGenreOpacity } from './genreSpotlight';
import type { StarDragPayload } from './starVisualModel';
import { getStarRenderMode } from './starRendererModel';

export interface StarRendererProps {
  stars: readonly Star[];
  selectedStarId: string | null;
  selectedGenres: ReadonlySet<Genre>;
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
  selectedGenres,
  reducedMotion,
  onSelect,
  onDragStart,
  onDragEnd,
}: StarRendererProps) {
  const renderMode = getStarRenderMode(stars.length);

  if (renderMode === 'instanced') {
    return (
      <InstancedStarField
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onSelect={onSelect}
        reducedMotion={reducedMotion}
        selectedGenres={selectedGenres}
        selectedStarId={selectedStarId}
        stars={stars}
      />
    );
  }

  return (
    <group name="stars-individual" userData={{ renderMode: 'individual', selectedStarId }}>
      {stars.map((star) => (
        <IndividualStarMesh
          key={star.id}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onSelect={onSelect}
          opacity={resolveGenreOpacity(star.genre, selectedGenres)}
          reducedMotion={reducedMotion}
          selected={selectedStarId === star.id}
          star={star}
        />
      ))}
    </group>
  );
}
