import {
  Bloom,
  EffectComposer,
  Noise,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import type { RefObject } from 'react';

import type { Constellation, Star } from '../domain/models';
import { createConstellationLineViewModels } from './constellationRendererModel';
import { GravitationalLens, type GravitationalLensRef } from './gravitationalLens';

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
 * cinematic grade on top — a vignette that frames the sky and a whisper of film
 * grain — makes the whole thing read like a long-exposure astrophotograph
 * rather than a flat WebGL render. (Chromatic aberration was tried here but
 * dropped: applied screen-wide it fringes every star and reads as an out-of-
 * focus blur across the dense starfield.) All of these are pure screen-space
 * passes (no depth re-render), so none reintroduce the SelectiveBloom
 * depth-blit flicker that a threshold Bloom was chosen to avoid.
 *
 * Mounted only while the Selection context contains a Star or active line.
 */
export function SelectiveBloomPass({
  enabled,
  reducedQuality = false,
  reducedMotion = false,
  lensRef,
}: {
  enabled: boolean;
  reducedQuality?: boolean;
  reducedMotion?: boolean;
  /** When provided, a gravitational lens bends the starfield around the hole. */
  lensRef?: RefObject<GravitationalLensRef | null>;
}) {
  if (!enabled) return null;

  return (
    <EffectComposer multisampling={reducedQuality ? 0 : 4}>
      {/* Lens first: it bends the sampled scene so Bloom then glows the warped
          stars. Its center/radius are driven from the hole's screen position. */}
      {lensRef !== undefined ? <GravitationalLens ref={lensRef} /> : <></>}
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.35}
        luminanceSmoothing={0.25}
        mipmapBlur={!reducedQuality}
      />
      {/* Cinematic grade. The vignette frames the sky; the grain is the heavier
          animated touch, so it steps aside under reduced quality or motion. */}
      <Vignette eskil={false} offset={0.32} darkness={0.62} />
      {!reducedQuality && !reducedMotion ? (
        <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} premultiply />
      ) : (
        <></>
      )}
    </EffectComposer>
  );
}
