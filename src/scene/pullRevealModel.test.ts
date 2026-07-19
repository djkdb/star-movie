import { describe, expect, it } from 'vitest';

import { PLANET_RARITIES } from '../domain/planetCatalog';
import { flashEnvelope, getPullRevealParams } from './pullRevealModel';

describe('pull reveal params', () => {
  it('escalates drama with rarity', () => {
    const common = getPullRevealParams('common');
    const legendary = getPullRevealParams('legendary');
    expect(legendary.flash).toBeGreaterThan(common.flash);
    expect(legendary.rayCount).toBeGreaterThan(common.rayCount);
    expect(legendary.particleCount).toBeGreaterThan(common.particleCount);
    expect(legendary.durationSeconds).toBeGreaterThan(common.durationSeconds);
  });

  it('gives every rarity a valid hex color and non-negative params', () => {
    for (const rarity of PLANET_RARITIES) {
      const p = getPullRevealParams(rarity);
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.particleCount).toBeGreaterThan(0);
      expect(p.durationSeconds).toBeGreaterThan(0);
      expect(p.emergeFraction).toBeGreaterThan(0);
      expect(p.emergeFraction).toBeLessThan(1);
    }
  });

  it('common never flashes; legendary flashes hard near the emerge point', () => {
    const common = getPullRevealParams('common');
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(flashEnvelope(common, t)).toBe(0);
    }
    const legendary = getPullRevealParams('legendary');
    const peak = flashEnvelope(legendary, legendary.emergeFraction - 0.12);
    expect(peak).toBeGreaterThan(0.5);
    expect(flashEnvelope(legendary, 0)).toBe(0);
    expect(flashEnvelope(legendary, 1)).toBe(0);
  });
});
