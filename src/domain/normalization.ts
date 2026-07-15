import type { Star } from './models';

export type UniqueWorkKey = string;

/** Produces the NFC display value persisted for user-authored text fields. */
export function normalizeDisplayText(value: string): string {
  return value.trim().normalize('NFC');
}

/**
 * Canonical text used for case-insensitive comparisons and persisted
 * normalized title/director fields.
 */
export function normalizeText(value: string): string {
  return normalizeDisplayText(value).toLocaleLowerCase('und').normalize('NFC');
}

export function createUniqueWorkKey(title: string, director: string): UniqueWorkKey {
  return `${normalizeText(title)}::${normalizeText(director)}`;
}

export function getStarUniqueWorkKey(
  star: Pick<Star, 'normalizedTitle' | 'normalizedDirector'>,
): UniqueWorkKey {
  return `${normalizeText(star.normalizedTitle)}::${normalizeText(star.normalizedDirector)}`;
}
