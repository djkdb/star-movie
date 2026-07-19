import type { PlanetRarity } from '../domain/models';
import { RARITY_COLORS } from '../domain/planetCatalog';

/**
 * Per-rarity staging for the gacha pull reveal. Higher tiers get a brighter
 * flash, more light rays, denser particles, and a longer, grander sequence so a
 * legendary pull reads as a supernova moment and a common stays a quick puff.
 */
export interface PullRevealParams {
  rarity: PlanetRarity;
  /** Signature rarity color (rays, shockwave, particles). */
  color: string;
  /** Full-screen flash intensity 0..1 (legendary = blinding white burst). */
  flash: number;
  /** Number of radial light rays behind the planet. */
  rayCount: number;
  /** Burst particle count. */
  particleCount: number;
  /** Whether an expanding shockwave ring plays at the climax. */
  shockwave: boolean;
  /** Total sequence length in seconds. */
  durationSeconds: number;
  /** Fraction of the duration at which the planet has fully emerged. */
  emergeFraction: number;
}

const PARAMS: Readonly<Record<PlanetRarity, Omit<PullRevealParams, 'rarity' | 'color'>>> = {
  common: {
    flash: 0,
    rayCount: 0,
    particleCount: 45,
    shockwave: false,
    durationSeconds: 1.7,
    emergeFraction: 0.5,
  },
  rare: {
    flash: 0.18,
    rayCount: 6,
    particleCount: 80,
    shockwave: true,
    durationSeconds: 2.1,
    emergeFraction: 0.52,
  },
  epic: {
    flash: 0.45,
    rayCount: 12,
    particleCount: 140,
    shockwave: true,
    durationSeconds: 2.5,
    emergeFraction: 0.55,
  },
  legendary: {
    flash: 1,
    rayCount: 22,
    particleCount: 220,
    shockwave: true,
    durationSeconds: 3.1,
    emergeFraction: 0.6,
  },
};

export function getPullRevealParams(rarity: PlanetRarity): PullRevealParams {
  return { rarity, color: RARITY_COLORS[rarity], ...PARAMS[rarity] };
}

/**
 * Flash envelope over normalized time: a fast spike just before the planet
 * emerges, then a quick decay. Returns 0..1 scaled by the tier's flash.
 */
export function flashEnvelope(params: PullRevealParams, progress: number): number {
  if (params.flash <= 0) return 0;
  const peak = params.emergeFraction - 0.12;
  const rise = Math.max(0, Math.min(1, (progress - (peak - 0.1)) / 0.1));
  const fall = Math.max(0, 1 - Math.max(0, progress - peak) / 0.22);
  return params.flash * rise * fall;
}
