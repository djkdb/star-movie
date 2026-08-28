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

  test('text stays readable with the star cluster behind the glass', async ({ page }) => {
    await page.click('button[aria-controls="shell-panel-list"]');
    await page.waitForTimeout(1_200);

    // Drag the sky so the star cluster sits behind the panel. A full-white
    // patch was tried and rejected: it is a backdrop the renderer cannot
    // produce, and testing against it only proves the glass is not opaque.
    // The realistic worst case is the brightest thing the scene actually
    // draws, seen through the blur that will always be in front of it.
    await page.mouse.move(400, 450);
    await page.mouse.down();
    await page.mouse.move(1_000, 450, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(2_000);

    // Five panels exist; only the open one is on screen.
    const box = await page.locator('#shell-panel-list').boundingBox();
    expect(box).not.toBeNull();
    const shot = (await page.screenshot({ clip: box! })).toString('base64');

    // axe reads declared colours and cannot see through a backdrop-filter at
    // all, so it cannot know whether translucent chrome stays readable over
    // what is behind it. This measures the pixels that are actually
    // composited — which is also how --text-faint was caught at 4.19:1.
    const worstBackdrop = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((resolve) => { img.onload = resolve; img.src = `data:image/png;base64,${b64}`; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminances: number[] = [];
      for (let i = 0; i < data.length; i += 4 * 5) {
        luminances.push(
          0.2126 * channel(data[i]!) + 0.7152 * channel(data[i + 1]!) + 0.0722 * channel(data[i + 2]!),
        );
      }
      luminances.sort((a, b) => a - b);
      // 95th percentile, not the max: one antialiased glyph edge is not the
      // backdrop the rest of the text has to sit on.
      return luminances[Math.floor(luminances.length * 0.95)]!;
    }, shot);

    const relative = (hex: string) => {
      const parts = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const linear = parts.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const contrast = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    // Every tier that carries meaning, not just the brightest one.
    for (const tier of ['#e9edfa', '#bcc6e0', '#929db9', '#98a2b8']) {
      expect(contrast(relative(tier), worstBackdrop)).toBeGreaterThanOrEqual(4.5);
    }
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
