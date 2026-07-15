import type { QualityLevel } from './models';

export const QUALITY_LEVEL_SEQUENCE = [
  'full',
  'reducedBackground',
  'minimumParticles',
  'reducedBloom',
] as const satisfies readonly QualityLevel[];

export interface SceneQualitySettings {
  backgroundStarScale: number;
  minimumParticleCounts: boolean;
  reducedBloom: boolean;
}

/** Returns the next cumulative quality level without allowing recovery or skipped stages. */
export function degradeQualityLevel(current: QualityLevel): QualityLevel {
  const index = QUALITY_LEVEL_SEQUENCE.indexOf(current);
  return QUALITY_LEVEL_SEQUENCE[Math.min(index + 1, QUALITY_LEVEL_SEQUENCE.length - 1)]!;
}

export function getSceneQualitySettings(level: QualityLevel): SceneQualitySettings {
  return {
    backgroundStarScale: level === 'full' ? 1 : 0.5,
    minimumParticleCounts:
      level === 'minimumParticles' || level === 'reducedBloom',
    reducedBloom: level === 'reducedBloom',
  };
}
