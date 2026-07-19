import { describe, expect, it } from 'vitest';

import {
  PLANET_SPECIES,
  PLANET_SPECIES_IDS,
  RARITY_ODDS,
  TOTAL_SPECIES_COUNT,
  speciesByRarity,
} from './planetCatalog';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

describe('planet catalog integrity', () => {
  it('holds exactly 42 species with the required rarity distribution', () => {
    expect(TOTAL_SPECIES_COUNT).toBe(42);
    expect(speciesByRarity('common')).toHaveLength(18);
    expect(speciesByRarity('rare')).toHaveLength(12);
    expect(speciesByRarity('epic')).toHaveLength(8);
    expect(speciesByRarity('legendary')).toHaveLength(4);
  });

  it('has unique ids and unique names', () => {
    expect(new Set(PLANET_SPECIES_IDS).size).toBe(PLANET_SPECIES.length);
    const names = PLANET_SPECIES.map((species) => species.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses valid hex colors everywhere', () => {
    for (const species of PLANET_SPECIES) {
      expect(species.baseColor).toMatch(HEX_COLOR);
      expect(species.accentColor).toMatch(HEX_COLOR);
      expect(species.emissiveColor).toMatch(HEX_COLOR);
      if (species.ring !== undefined) expect(species.ring.color).toMatch(HEX_COLOR);
      if (species.atmosphere !== undefined) expect(species.atmosphere).toMatch(HEX_COLOR);
    }
  });

  it('has rarity odds that sum to 1', () => {
    const total =
      RARITY_ODDS.common + RARITY_ODDS.rare + RARITY_ODDS.epic + RARITY_ODDS.legendary;
    expect(total).toBeCloseTo(1, 10);
  });
});
