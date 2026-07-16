import {
  EffectComposer,
  SelectiveBloom,
} from '@react-three/postprocessing';

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
    // 4x MSAA keeps star cores crisp while the composer owns the render pass;
    // degraded quality drops it together with the mipmap blur.
    <EffectComposer autoClear={false} multisampling={reducedQuality ? 0 : 4}>
      <SelectiveBloom
        intensity={1}
        luminanceSmoothing={0.2}
        luminanceThreshold={0}
        mipmapBlur={!reducedQuality}
      />
    </EffectComposer>
  );
}
