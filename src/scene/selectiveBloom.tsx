import { Bloom, EffectComposer } from '@react-three/postprocessing';

import type { Constellation, Star } from '../domain/models';
import { createConstellationLineViewModels } from './constellationRendererModel';

export const BLOOM_TARGET_USER_DATA_KEY = 'selectiveBloomTarget';

export type BloomTargetKey = `star:${string}` | `constellation:${string}`;

export interface SelectiveBloomViewModel {
  enabled: boolean;
  targetKeys: BloomTargetKey[];
}

/**
 * Derives the conceptual Bloom selection without depending on Three.js objects.
 * A constellation enters the set only when it currently has at least two active stars.
 */
export function createSelectiveBloomViewModel(
  stars: readonly Star[],
  constellations: readonly Constellation[],
): SelectiveBloomViewModel {
  const targetKeys: BloomTargetKey[] = [
    ...stars.map(({ id }) => `star:${id}` as const),
    ...createConstellationLineViewModels(constellations, stars)
      .map(({ id }) => `constellation:${id}` as const),
  ];

  return {
    enabled: targetKeys.length > 0,
    targetKeys,
  };
}

/** Mounted only while the Selection context contains a Star or active line. */
export function SelectiveBloomPass({
  enabled,
  reducedQuality = false,
}: {
  enabled: boolean;
  reducedQuality?: boolean;
}) {
  if (!enabled) return null;

  return (
    // A plain threshold bloom, not SelectiveBloom. SelectiveBloom re-renders the
    // selected objects sharing the scene depth buffer, and its depth blit aliases
    // the read/write depth-stencil attachment ("cannot be the same image"), which
    // flickered or blacked out the scene on real GPUs whenever an effect added
    // geometry. A luminance threshold keeps only genuinely bright things — star
    // cores, constellation lines, fireworks, the accretion ring — glowing while
    // the dim nebula stays matte.
    <EffectComposer multisampling={reducedQuality ? 0 : 4}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.35}
        luminanceSmoothing={0.25}
        mipmapBlur={!reducedQuality}
      />
    </EffectComposer>
  );
}
