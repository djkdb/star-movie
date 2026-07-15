import { GENRES, type ConstellationDraft, type Genre, type Star } from '../domain/models';
import { normalizeDisplayText } from '../domain/normalization';

export const MAX_CONSTELLATION_STARS = 200;
export const MIN_CONSTELLATION_STARS = 2;
export const MAX_CONSTELLATION_NAME_LENGTH = 30;

export const CONSTELLATION_COLOR_PALETTE = [
  '#60A5FA',
  '#F472B6',
  '#F87171',
  '#FBBF24',
  '#C084FC',
  '#FDE047',
  '#FB923C',
  '#2DD4BF',
  '#A3E635',
  '#22D3EE',
] as const;

export interface ConstellationValidationResult {
  success: boolean;
  name?: string;
  errors: {
    name?: string;
    starIds?: string;
  };
}

export interface GenreConstellationGroup {
  genre: Genre;
  starIds: string[];
}

export function createInactiveConstellationDraft(): ConstellationDraft {
  return { active: false, phase: 'selecting', starIds: [], error: null };
}

export function createActiveConstellationDraft(
  initialStarId?: string,
): ConstellationDraft {
  return {
    active: true,
    phase: 'selecting',
    starIds: initialStarId === undefined ? [] : [initialStarId],
    error: null,
  };
}

/** Adds a click once, preserving first-click order and the 200 item bound. */
export function selectConstellationDraftStar(
  draft: Readonly<ConstellationDraft>,
  starId: string,
): ConstellationDraft {
  if (!draft.active || draft.starIds.includes(starId)) return cloneDraft(draft);
  if (draft.starIds.length >= MAX_CONSTELLATION_STARS) {
    return {
      ...cloneDraft(draft),
      phase: 'selecting',
      error: `별자리는 최대 ${MAX_CONSTELLATION_STARS}개의 작품까지 선택할 수 있습니다.`,
    };
  }
  return {
    ...cloneDraft(draft),
    phase: 'selecting',
    starIds: [...draft.starIds, starId],
    error: null,
  };
}

export function requestConstellationName(
  draft: Readonly<ConstellationDraft>,
): ConstellationDraft {
  if (
    draft.starIds.length < MIN_CONSTELLATION_STARS ||
    draft.starIds.length > MAX_CONSTELLATION_STARS
  ) {
    return {
      ...cloneDraft(draft),
      phase: 'selecting',
      error: `별자리는 ${MIN_CONSTELLATION_STARS}개 이상 ${MAX_CONSTELLATION_STARS}개 이하의 작품이 필요합니다.`,
    };
  }
  return { ...cloneDraft(draft), phase: 'naming', error: null };
}

export function validateConstellationCreation(
  rawName: string,
  starIds: readonly string[],
): ConstellationValidationResult {
  const name = normalizeDisplayText(rawName);
  const errors: ConstellationValidationResult['errors'] = {};
  if (name.length === 0) {
    errors.name = '별자리 이름을 입력해 주세요.';
  } else if (name.length > MAX_CONSTELLATION_NAME_LENGTH) {
    errors.name = `별자리 이름은 ${MAX_CONSTELLATION_NAME_LENGTH}자 이하여야 합니다.`;
  }
  if (
    starIds.length < MIN_CONSTELLATION_STARS ||
    starIds.length > MAX_CONSTELLATION_STARS
  ) {
    errors.starIds = `별자리는 ${MIN_CONSTELLATION_STARS}개 이상 ${MAX_CONSTELLATION_STARS}개 이하의 작품이 필요합니다.`;
  } else if (new Set(starIds).size !== starIds.length) {
    errors.starIds = '같은 작품을 별자리에 중복으로 추가할 수 없습니다.';
  }
  return Object.keys(errors).length === 0
    ? { success: true, name, errors }
    : { success: false, errors };
}

/** Groups eligible active works in fixed Genre order and deterministic work order. */
export function buildGenreConstellationGroups(
  stars: readonly Star[],
): GenreConstellationGroup[] {
  return GENRES.flatMap((genre) => {
    const starIds = stars
      .filter((star) => star.genre === genre)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .map(({ id }) => id);
    return starIds.length >= MIN_CONSTELLATION_STARS ? [{ genre, starIds }] : [];
  });
}

/**
 * Picks the palette entry whose nearest CIE76 distance from existing colors is
 * greatest. Palette order is the stable tie-breaker.
 */
export function selectDeterministicConstellationColor(
  existingColors: readonly string[],
): string {
  if (existingColors.length === 0) return CONSTELLATION_COLOR_PALETTE[0];
  const existingLabs = existingColors.map(hexToLab);
  let selected: string = CONSTELLATION_COLOR_PALETTE[0];
  let selectedDistance = -1;
  for (const color of CONSTELLATION_COLOR_PALETTE) {
    const candidate = hexToLab(color);
    const nearestDistance = Math.min(
      ...existingLabs.map((existing) => cie76(candidate, existing)),
    );
    if (nearestDistance > selectedDistance) {
      selected = color;
      selectedDistance = nearestDistance;
    }
  }
  return selected;
}

function cloneDraft(draft: Readonly<ConstellationDraft>): ConstellationDraft {
  return { ...draft, starIds: [...draft.starIds] };
}

type Lab = readonly [number, number, number];

function hexToLab(hex: string): Lab {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const linear = [red, green, blue].map((value) =>
    value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4,
  );
  const x = (linear[0]! * 0.4124 + linear[1]! * 0.3576 + linear[2]! * 0.1805) / 0.95047;
  const y = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  const z = (linear[0]! * 0.0193 + linear[1]! * 0.1192 + linear[2]! * 0.9505) / 1.08883;
  const transform = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function cie76(left: Lab, right: Lab): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
