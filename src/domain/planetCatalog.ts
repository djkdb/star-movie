import type { PlanetRarity } from './models';

/** Silhouette family used by the 3D renderer and the codex card art. */
export type PlanetGeometryKind = 'sphere' | 'crystal' | 'twin';

/** Procedural surface pattern painted from the species palette. */
export type PlanetSurfacePattern =
  | 'solid'
  | 'bands'
  | 'blotches'
  | 'swirl'
  | 'cracks'
  | 'facets';

export interface PlanetRing {
  color: string;
  /** Inner/outer radius as multiples of the planet radius. */
  innerScale: number;
  outerScale: number;
}

export interface PlanetSpecies {
  id: string;
  /** Display name (Korean). */
  name: string;
  rarity: PlanetRarity;
  /** One-line flavor text for the codex card. */
  flavor: string;
  geometry: PlanetGeometryKind;
  pattern: PlanetSurfacePattern;
  baseColor: string;
  accentColor: string;
  /** Glow color; higher rarities self-illuminate. */
  emissiveColor: string;
  emissiveIntensity: number;
  ring?: PlanetRing;
  /** Soft camera-facing halo color, e.g. an atmosphere or aura. */
  atmosphere?: string;
  moons?: number;
}

export const PLANET_RARITIES: readonly PlanetRarity[] = [
  'common',
  'rare',
  'epic',
  'legendary',
] as const;

export const RARITY_LABELS: Readonly<Record<PlanetRarity, string>> = {
  common: '일반',
  rare: '레어',
  epic: '에픽',
  legendary: '전설',
};

/** Signature color per tier, used for card borders and rarity chips. */
export const RARITY_COLORS: Readonly<Record<PlanetRarity, string>> = {
  common: '#9ca3af',
  rare: '#38bdf8',
  epic: '#a855f7',
  legendary: '#fbbf24',
};

/**
 * The 28-species dex: 12 common, 8 rare, 5 epic, 3 legendary. Each species has a
 * distinctive silhouette, palette, and surface so a pull instantly reads as
 * "another rusty desert world" or "the legendary living star".
 */
export const PLANET_SPECIES: readonly PlanetSpecies[] = [
  // ---- Common (12) ----
  {
    id: 'verde',
    name: '베르데',
    rarity: 'common',
    flavor: '숲과 얕은 바다로 뒤덮인 온화한 세계.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#2f7d4f',
    accentColor: '#7fd6a0',
    emissiveColor: '#0b2a1a',
    emissiveIntensity: 0.05,
    atmosphere: '#8ff0c0',
  },
  {
    id: 'rust',
    name: '루스트',
    rarity: 'common',
    flavor: '붉은 산화철 먼지가 끝없이 이는 사막 행성.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#a34a2a',
    accentColor: '#d98a5f',
    emissiveColor: '#3a1206',
    emissiveIntensity: 0.05,
  },
  {
    id: 'pale',
    name: '팔레',
    rarity: 'common',
    flavor: '크레이터로 얽은 창백한 암석 위성.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#9ca3af',
    accentColor: '#d6dae0',
    emissiveColor: '#1b1d22',
    emissiveIntensity: 0.03,
  },
  {
    id: 'azur',
    name: '아주르',
    rarity: 'common',
    flavor: '온통 잔잔한 바다뿐인 푸른 물의 행성.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#2563a8',
    accentColor: '#7ec8f0',
    emissiveColor: '#08243f',
    emissiveIntensity: 0.05,
    atmosphere: '#8fd3ff',
  },
  {
    id: 'sandy',
    name: '샌드',
    rarity: 'common',
    flavor: '황토빛 모래 언덕이 물결치는 건조한 세계.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#c79a52',
    accentColor: '#e7cd93',
    emissiveColor: '#3d2c10',
    emissiveIntensity: 0.04,
  },
  {
    id: 'moss',
    name: '모스',
    rarity: 'common',
    flavor: '이끼가 낀 축축한 작은 위성.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#5b6e3a',
    accentColor: '#9fb56a',
    emissiveColor: '#1a220f',
    emissiveIntensity: 0.04,
  },
  {
    id: 'cloud',
    name: '클라우드',
    rarity: 'common',
    flavor: '두꺼운 흰 구름에 영원히 가려진 행성.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#d7dce6',
    accentColor: '#ffffff',
    emissiveColor: '#2a2f3a',
    emissiveIntensity: 0.05,
    atmosphere: '#eef3ff',
  },
  {
    id: 'ember',
    name: '엠버',
    rarity: 'common',
    flavor: '식어가는 지각 사이로 옅은 불씨가 비친다.',
    geometry: 'sphere',
    pattern: 'cracks',
    baseColor: '#6b2f22',
    accentColor: '#e06a34',
    emissiveColor: '#c0431a',
    emissiveIntensity: 0.25,
  },
  {
    id: 'dust',
    name: '더스트',
    rarity: 'common',
    flavor: '갈색 먼지 폭풍이 잦아들 줄 모르는 황무지.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#8a6a45',
    accentColor: '#b89468',
    emissiveColor: '#2a1e10',
    emissiveIntensity: 0.03,
  },
  {
    id: 'frost',
    name: '프로스트',
    rarity: 'common',
    flavor: '옅은 서리가 내려앉은 차가운 회백색 세계.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#aeb9c4',
    accentColor: '#e6eef6',
    emissiveColor: '#20272e',
    emissiveIntensity: 0.04,
    atmosphere: '#cfe6ff',
  },
  {
    id: 'clay',
    name: '클레이',
    rarity: 'common',
    flavor: '점토빛 평원이 갈라진 마른 행성.',
    geometry: 'sphere',
    pattern: 'cracks',
    baseColor: '#b06a44',
    accentColor: '#d99a6c',
    emissiveColor: '#301608',
    emissiveIntensity: 0.03,
  },
  {
    id: 'slate',
    name: '슬레이트',
    rarity: 'common',
    flavor: '짙은 현무암으로 뒤덮인 무거운 세계.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#4b515c',
    accentColor: '#767d8a',
    emissiveColor: '#14171c',
    emissiveIntensity: 0.03,
  },

  // ---- Rare (8) ----
  {
    id: 'ringlet',
    name: '링렛',
    rarity: 'rare',
    flavor: '가느다란 얼음 고리를 두른 담청색 행성.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#4a7fb5',
    accentColor: '#a9cdf0',
    emissiveColor: '#0e2740',
    emissiveIntensity: 0.08,
    ring: { color: '#cfe4ff', innerScale: 1.5, outerScale: 2.2 },
  },
  {
    id: 'aurora',
    name: '오로라',
    rarity: 'rare',
    flavor: '극지방에 초록빛 오로라가 넘실대는 세계.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#1f3b5c',
    accentColor: '#57e6a2',
    emissiveColor: '#1c6b52',
    emissiveIntensity: 0.3,
    atmosphere: '#79ffbe',
  },
  {
    id: 'twin',
    name: '트윈',
    rarity: 'rare',
    flavor: '서로를 맴도는 쌍둥이 암석 세계.',
    geometry: 'twin',
    pattern: 'blotches',
    baseColor: '#8a7bd8',
    accentColor: '#c3b8f5',
    emissiveColor: '#241a4a',
    emissiveIntensity: 0.12,
  },
  {
    id: 'jade',
    name: '제이드',
    rarity: 'rare',
    flavor: '옥빛 대륙과 유리 바다가 어우러진 행성.',
    geometry: 'sphere',
    pattern: 'blotches',
    baseColor: '#1f9e86',
    accentColor: '#8ef0d8',
    emissiveColor: '#0c3d34',
    emissiveIntensity: 0.12,
    atmosphere: '#9dffe6',
  },
  {
    id: 'coral',
    name: '코랄',
    rarity: 'rare',
    flavor: '산호빛 구름 띠가 감싼 따뜻한 세계.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#e0736b',
    accentColor: '#ffc2a0',
    emissiveColor: '#5a1f1c',
    emissiveIntensity: 0.14,
    atmosphere: '#ffb7a8',
  },
  {
    id: 'storm',
    name: '스톰',
    rarity: 'rare',
    flavor: '거센 폭풍 띠가 휘도는 작은 가스 행성.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#5b6b8c',
    accentColor: '#aebfdd',
    emissiveColor: '#1a2233',
    emissiveIntensity: 0.1,
  },
  {
    id: 'violet',
    name: '바이올렛',
    rarity: 'rare',
    flavor: '보랏빛 안개가 자욱하게 감도는 행성.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#7c3fb0',
    accentColor: '#c79bf0',
    emissiveColor: '#3a1560',
    emissiveIntensity: 0.2,
    atmosphere: '#d3a6ff',
  },
  {
    id: 'gold',
    name: '골드',
    rarity: 'rare',
    flavor: '금빛으로 빛나는 금속성 지각의 세계.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#c99a3c',
    accentColor: '#ffe08a',
    emissiveColor: '#4a3208',
    emissiveIntensity: 0.16,
  },

  // ---- Epic (5) ----
  {
    id: 'crystalis',
    name: '크리스탈리스',
    rarity: 'epic',
    flavor: '거대한 결정 격자로 자라난 광물 행성.',
    geometry: 'crystal',
    pattern: 'facets',
    baseColor: '#38bdf8',
    accentColor: '#bff0ff',
    emissiveColor: '#1e7fb0',
    emissiveIntensity: 0.5,
    atmosphere: '#a7ecff',
  },
  {
    id: 'saturnia',
    name: '새턴시아',
    rarity: 'epic',
    flavor: '광대한 삼중 고리를 두른 위풍당당한 거인.',
    geometry: 'sphere',
    pattern: 'bands',
    baseColor: '#d8b06a',
    accentColor: '#f4e0a8',
    emissiveColor: '#514013',
    emissiveIntensity: 0.2,
    ring: { color: '#f0dca6', innerScale: 1.6, outerScale: 2.8 },
    moons: 2,
  },
  {
    id: 'infernus',
    name: '인페르누스',
    rarity: 'epic',
    flavor: '갈라진 지각 사이로 용암이 흐르는 불의 세계.',
    geometry: 'sphere',
    pattern: 'cracks',
    baseColor: '#3a1008',
    accentColor: '#ff7a2a',
    emissiveColor: '#ff5a1a',
    emissiveIntensity: 0.8,
    atmosphere: '#ff8a4a',
  },
  {
    id: 'glacies',
    name: '글라시에스',
    rarity: 'epic',
    flavor: '푸른 빙하가 온 표면을 뒤덮은 얼음 거인.',
    geometry: 'sphere',
    pattern: 'cracks',
    baseColor: '#7fb8e6',
    accentColor: '#eaf7ff',
    emissiveColor: '#2a6ea0',
    emissiveIntensity: 0.35,
    atmosphere: '#cdeeff',
    ring: { color: '#dff2ff', innerScale: 1.5, outerScale: 2.1 },
  },
  {
    id: 'nebulon',
    name: '네뷸론',
    rarity: 'epic',
    flavor: '성운빛으로 물든 몽환적인 가스 거인.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#6d4fd0',
    accentColor: '#f090d8',
    emissiveColor: '#4a2a90',
    emissiveIntensity: 0.45,
    atmosphere: '#e0a0ff',
  },

  // ---- Legendary (3) ----
  {
    id: 'astralis',
    name: '아스트랄리스',
    rarity: 'legendary',
    flavor: '은하의 오라를 두르고 고리가 빛나는 전설의 세계.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#3b2a7a',
    accentColor: '#7fd8ff',
    emissiveColor: '#5a3fd0',
    emissiveIntensity: 0.7,
    ring: { color: '#a9f0ff', innerScale: 1.5, outerScale: 2.7 },
    atmosphere: '#8fd8ff',
    moons: 2,
  },
  {
    id: 'prisma',
    name: '프리스마',
    rarity: 'legendary',
    flavor: '빛을 무지개로 쪼개는 살아있는 프리즘 결정.',
    geometry: 'crystal',
    pattern: 'facets',
    baseColor: '#f472b6',
    accentColor: '#a7f3ff',
    emissiveColor: '#c026d3',
    emissiveIntensity: 0.9,
    atmosphere: '#ffd6ff',
  },
  {
    id: 'solcore',
    name: '솔코어',
    rarity: 'legendary',
    flavor: '스스로 타오르는 작은 항성을 품은 세계.',
    geometry: 'sphere',
    pattern: 'swirl',
    baseColor: '#ffb020',
    accentColor: '#fff1b0',
    emissiveColor: '#ff8a00',
    emissiveIntensity: 1.4,
    atmosphere: '#ffd27a',
    moons: 3,
  },
] as const;

const SPECIES_BY_ID: ReadonlyMap<string, PlanetSpecies> = new Map(
  PLANET_SPECIES.map((species) => [species.id, species]),
);

export const PLANET_SPECIES_IDS: readonly string[] = PLANET_SPECIES.map(
  ({ id }) => id,
);

export const TOTAL_SPECIES_COUNT = PLANET_SPECIES.length;

export function getPlanetSpecies(speciesId: string): PlanetSpecies | undefined {
  return SPECIES_BY_ID.get(speciesId);
}

export function isKnownSpeciesId(speciesId: string): boolean {
  return SPECIES_BY_ID.has(speciesId);
}

export function speciesByRarity(rarity: PlanetRarity): PlanetSpecies[] {
  return PLANET_SPECIES.filter((species) => species.rarity === rarity);
}

/** Pull odds per rarity tier; must sum to 1. */
export const RARITY_ODDS: Readonly<Record<PlanetRarity, number>> = {
  common: 0.6,
  rare: 0.27,
  epic: 0.1,
  legendary: 0.03,
};
