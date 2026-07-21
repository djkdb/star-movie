import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Vector2 } from 'three';

import type { Constellation, Star } from '../domain/models';
import { createConstellationLineViewModels } from './constellationRendererModel';

/** Per-channel pixel offset for the chromatic fringe — tiny, a lens quality. */
const CHROMATIC_ABERRATION_OFFSET = new Vector2(0.0006, 0.0009);

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

/**
 * The scene's post-processing stack. Bloom makes bright things glow; a subtle
 * cinematic grade on top — a faint chromatic fringe, a vignette that frames the
 * sky, and a whisper of film grain — makes the whole thing read like a long-
 * exposure astrophotograph rather than a flat WebGL render. All of these are
 * pure screen-space passes (no depth re-render), so none reintroduce the
 * SelectiveBloom depth-blit flicker that a threshold Bloom was chosen to avoid.
 *
 * Mounted only while the Selection context contains a Star or active line.
 */
export function SelectiveBloomPass({
  enabled,
  reducedQuality = false,
  reducedMotion = false,
}: {
  enabled: boolean;
  reducedQuality?: boolean;
  reducedMotion?: boolean;
}) {
  if (!enabled) return null;

  return (
    <EffectComposer multisampling={reducedQuality ? 0 : 4}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.35}
        luminanceSmoothing={0.25}
        mipmapBlur={!reducedQuality}
      />
      {/* Cinematic grade. Chromatic aberration and grain are the animated/heavier
          touches, so they step aside under reduced quality or reduced motion. */}
      {!reducedQuality ? (
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={CHROMATIC_ABERRATION_OFFSET}
          radialModulation={false}
          modulationOffset={0}
        />
      ) : (
        <></>
      )}
      <Vignette eskil={false} offset={0.32} darkness={0.62} />
      {!reducedQuality && !reducedMotion ? (
        <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} premultiply />
      ) : (
        <></>
      )}
    </EffectComposer>
  );
}
