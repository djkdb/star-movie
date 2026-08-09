// The rest of the suite opens panels with keyboard activation, which bypasses
// hit-testing entirely — so it happily passed while every dock button on a
// phone was covered by the first-visit guide and could not be tapped at all.
// These tests use real taps and real hit-testing, on a first visit, because
// that is the only visit a stranger following a shared link ever makes.

import { expect, test, type Page } from '@playwright/test';

import { bootArchive } from './fixtures/archiveFixture';

const PANEL_LABELS = [
  '아카이브 현황',
  '작품 목록 패널',
  '작품 추가',
  '행성 도감',
  '작품 DOM 탐색 패널',
] as const;

const PHONE = { width: 390, height: 844 };

/** What a real tap at each dock button's centre would actually land on. */
async function findCoveredDockButtons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.dock-button')]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit === null || !(hit === button || button.contains(hit));
      })
      .map((button) => button.getAttribute('data-label') ?? '(unlabelled)'),
  );
}

test.describe('first visit on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('every dock button is tappable while the welcome guide is showing', async ({ page }) => {
    await bootArchive(page);
    await page.waitForTimeout(2_500);

    // The guide must actually be up, or this asserts nothing.
    await expect(page.locator('.gesture-guide')).toBeVisible();

    expect(await findCoveredDockButtons(page)).toEqual([]);
  });

  test('a tap opens the panel rather than being swallowed by the guide', async ({ page }) => {
    await bootArchive(page);
    await page.waitForTimeout(2_500);

    for (const label of PANEL_LABELS) {
      const dockButton = page.getByRole('button', { name: label });
      // No force: a tap that needs forcing is a tap a finger cannot make.
      await dockButton.tap();
      await expect(dockButton).toHaveAttribute('aria-expanded', 'true');
      await dockButton.tap();
    }
  });

  test('the guide never sits on top of the dock', async ({ page }) => {
    await bootArchive(page);
    await page.waitForTimeout(2_500);

    const overlap = await page.evaluate(() => {
      const guide = document.querySelector('.gesture-guide')?.getBoundingClientRect();
      const dock = document.querySelector('.shell-dock')?.getBoundingClientRect();
      if (guide === undefined || dock === undefined) return null;
      return Math.min(guide.bottom, dock.bottom) - Math.max(guide.top, dock.top);
    });

    expect(overlap).not.toBeNull();
    expect(overlap!).toBeLessThanOrEqual(0);
  });

  test('guide copy breaks between words, not through them', async ({ page }) => {
    await bootArchive(page);
    await page.waitForTimeout(2_500);

    // Hangul has no mid-word break opportunity, so `word-break: keep-all` is
    // what stops 손가락 being split across two lines.
    const breaking = await page.evaluate(() => {
      const moves = document.querySelector('.gesture-guide-moves');
      return moves === null ? null : getComputedStyle(moves).wordBreak;
    });
    expect(breaking).toBe('keep-all');
  });
});
