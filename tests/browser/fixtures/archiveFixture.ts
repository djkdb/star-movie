import type { Locator, Page } from '@playwright/test';

import { createDefaultPersistedStore } from '../../../src/domain/defaultState';
import type { PersistedStateV2, Star } from '../../../src/domain/models';
import { encodePersistedV2 } from '../../../src/persistence/persistedStateCodec';
import { PERSISTENCE_STORAGE_KEY } from '../../../src/persistence/persistenceService';

const FIXED_CREATED_AT = '2025-01-01T00:00:00.000Z';

const FIXED_STARS: readonly Star[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Seed Voyage',
    normalizedTitle: 'seed voyage',
    genre: 'SF',
    rating: 5,
    review: 'A deterministic seed work for browser interaction tests.',
    watchedDate: '2024-12-20',
    director: 'Seed Director',
    normalizedDirector: 'seed director',
    position: { x: -44, y: 0, z: -45 },
    createdAt: FIXED_CREATED_AT,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Second Signal',
    normalizedTitle: 'second signal',
    genre: 'SF',
    rating: 4,
    review: 'Long card content '.repeat(8).slice(0, 100),
    watchedDate: '2024-12-21',
    director: 'Second Director',
    normalizedDirector: 'second director',
    position: { x: -43, y: 1, z: -45 },
    createdAt: '2025-01-02T00:00:00.000Z',
  },
];

export interface ArchiveFixtureOptions {
  starCount?: 1 | 2;
}

export function createArchiveFixture(
  options: ArchiveFixtureOptions = {},
): PersistedStateV2 {
  const persisted = createDefaultPersistedStore();
  persisted.stars = FIXED_STARS
    .slice(0, options.starCount ?? 2)
    .map((star) => ({ ...star, position: { ...star.position } }));
  return persisted;
}

export async function bootArchive(
  page: Page,
  options: ArchiveFixtureOptions = {},
): Promise<void> {
  const encodedState = encodePersistedV2(createArchiveFixture(options));
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: PERSISTENCE_STORAGE_KEY, value: encodedState },
  );
  await page.goto('/');
  await page.getByRole('heading', { name: '나만의 밤하늘' }).waitFor();
}

/** Activates a control through its keyboard behavior rather than pointer input. */
export async function activateWithKeyboard(
  page: Page,
  locator: Locator,
): Promise<void> {
  await locator.focus();
  await page.keyboard.press('Enter');
}
