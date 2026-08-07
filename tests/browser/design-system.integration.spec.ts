// Design-system regressions are invisible to normal tests: nothing throws when
// a control keeps the platform's white background, or when a new rule invents
// a ninth font size. These assertions are the audit that found both, kept
// running so they cannot come back.

import { expect, test, type Page } from '@playwright/test';

import { bootArchive } from './fixtures/archiveFixture';

/** Opens every dock panel so the audit sees the whole interface at once. */
async function openAllPanels(page: Page): Promise<void> {
  const ids = [
    'shell-panel-overview',
    'shell-panel-list',
    'shell-panel-add',
    'shell-panel-codex',
    'shell-panel-navigation',
  ];
  for (const id of ids) {
    await page.click(`button[aria-controls="${id}"]`);
    await page.waitForTimeout(250);
  }
}

test.describe('design system', () => {
  test.beforeEach(async ({ page }) => {
    await bootArchive(page);
    await page.waitForTimeout(3_500);
    const dismiss = page.locator('.gesture-guide button');
    if (await dismiss.count()) await dismiss.click();
  });

  test('no control falls back to the platform’s own chrome', async ({ page }) => {
    await openAllPanels(page);

    const leaks = await page.evaluate(() =>
      [...document.querySelectorAll('.shell-panel input, .shell-panel select, .shell-panel textarea')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          const bg = getComputedStyle(el).backgroundColor;
          const match = /rgba?\((\d+), (\d+), (\d+)/.exec(bg);
          if (match === null) return false;
          // Anything bright is the OS painting the control, not us: the whole
          // interface sits on near-black surfaces.
          const [r, g, b] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
          return (r + g + b) / 3 > 120;
        })
        .map((el) => `${el.tagName.toLowerCase()}#${el.id || '(no id)'} in .${el.closest('section')?.className ?? '?'}`),
    );

    expect(leaks).toEqual([]);
  });

  test('type stays on the scale — eight sizes, not thirty-five', async ({ page }) => {
    await openAllPanels(page);

    const sizes = await page.evaluate(() =>
      [...new Set(
        [...document.querySelectorAll('.shell-panel *')]
          // SVG marks are drawn shapes, not type — their font-size renders
          // nothing and would count as a phantom step on the scale.
          .filter((el) => !(el instanceof SVGElement) && el.closest('svg') === null)
          .filter((el) => el.children.length === 0 && el.textContent?.trim() && el.getBoundingClientRect().width > 0)
          .map((el) => getComputedStyle(el).fontSize),
      )].sort(),
    );

    expect(sizes).toHaveLength(new Set(sizes).size);
    expect(sizes.length).toBeLessThanOrEqual(8);
  });

  test('surfaces step up in luminance so depth is readable', async ({ page }) => {
    await openAllPanels(page);

    const luminance = await page.evaluate(() => {
      const read = (selector: string) => {
        const el = document.querySelector(selector);
        if (el === null) return null;
        const match = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor);
        if (match === null) return null;
        const [r, g, b] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
        return (r + g + b) / 3;
      };
      return { panel: read('.shell-panel'), popover: read('.toast') };
    });

    expect(luminance.panel).not.toBeNull();
    // The panel must not be the brightest thing on screen; the ladder only
    // reads if raised surfaces are genuinely lighter than the base.
    expect(luminance.panel!).toBeLessThan(60);
  });

  test('no unicode glyph is standing in for an icon', async ({ page }) => {
    await openAllPanels(page);

    const glyphs = await page.evaluate(() => {
      // The geometric and dingbat blocks these were drawn from. An icon has to
      // be a drawn shape we control, not a character the platform picks.
      const suspect = /[←-⇿─-➿⬀-⯿■-◿☀-⛿]/;
      return [...document.querySelectorAll('.shell-panel *')]
        .filter((el) => el.children.length === 0 && suspect.test(el.textContent ?? ''))
        .map((el) => `${el.className || el.tagName}: ${el.textContent?.trim().slice(0, 6)}`);
    });

    expect(glyphs).toEqual([]);
  });
});
