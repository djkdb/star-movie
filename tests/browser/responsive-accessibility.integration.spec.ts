import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { TOUCH } from 'three';

import { activateWithKeyboard, bootArchive } from './fixtures/archiveFixture';

interface ViewportCase {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

const VIEWPORT_MATRIX: readonly ViewportCase[] = [
  { name: '767px mobile boundary', width: 767, height: 900, mobile: true },
  { name: '768px tablet boundary', width: 768, height: 900, mobile: false },
  { name: 'tablet landscape', width: 1024, height: 768, mobile: false },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

const PANEL_LABELS = [
  '아카이브 현황',
  '작품 목록 패널',
  '작품 추가',
  '별자리 관리',
  '작품 DOM 탐색 패널',
] as const;

type PanelLabel = (typeof PANEL_LABELS)[number];

/** Opens a shell panel through its dock button using keyboard activation. */
async function openPanel(page: Page, label: PanelLabel): Promise<void> {
  const dockButton = page.getByRole('button', { name: label });
  const expanded = await dockButton.getAttribute('aria-expanded');
  if (expanded === 'true') return;
  await activateWithKeyboard(page, dockButton);
  await expect(dockButton).toHaveAttribute('aria-expanded', 'true');
}

async function addWorkWithKeyboard(page: Page): Promise<void> {
  await openPanel(page, '작품 추가');

  const title = page.getByLabel('제목', { exact: true });
  await title.focus();
  await title.pressSequentially('Keyboard Odyssey');

  const genre = page.getByLabel('장르', { exact: true });
  await genre.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  const rating = page.getByLabel('별점', { exact: true });
  await rating.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  const review = page.getByLabel('감상평', { exact: true });
  await review.focus();
  await review.pressSequentially('Keyboard-only archive journey');

  const watchedDate = page.getByLabel('감상일', { exact: true });
  await watchedDate.fill('2025-02-03');

  const director = page.getByLabel('직접 입력 감독', { exact: true });
  await director.focus();
  await director.pressSequentially('Keyboard Director');

  await activateWithKeyboard(page, page.getByRole('button', { name: '별로 등록하기' }));
}

test.describe('responsive browser acceptance', () => {
  for (const viewport of VIEWPORT_MATRIX) {
    test(`R5.6 R14.1-R14.4 ${viewport.name} immersive layout and dock contract`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await bootArchive(page);

      // The sky canvas fills the whole viewport on every breakpoint.
      const canvasRect = await page.locator('.archive-shell-canvas').boundingBox();
      expect(canvasRect).not.toBeNull();
      if (canvasRect !== null) {
        expect(canvasRect.x).toBeCloseTo(0, 0);
        expect(canvasRect.y).toBeCloseTo(0, 0);
        expect(canvasRect.width).toBeCloseTo(viewport.width, 0);
        expect(canvasRect.height).toBeCloseTo(viewport.height, 0);
      }

      const scene = page.getByRole('region', { name: '3D 우주 아카이브' });
      await expect(scene).toHaveAttribute('data-orbit-one-touch', String(TOUCH.ROTATE));
      await expect(scene).toHaveAttribute('data-orbit-two-touch', String(TOUCH.DOLLY_PAN));
      await expect(page.locator('.space-canvas-shell canvas')).toHaveCSS('touch-action', 'none');

      // Every panel starts closed behind the dock.
      for (const label of PANEL_LABELS) {
        const dockButton = page.getByRole('button', { name: label });
        await expect(dockButton).toBeVisible();
        await expect(dockButton).toHaveAttribute('aria-expanded', 'false');
      }

      // The dock hugs the bottom edge on mobile and the right edge on desktop.
      const dockRect = await page.locator('.shell-dock').boundingBox();
      expect(dockRect).not.toBeNull();
      if (dockRect !== null) {
        if (viewport.mobile) {
          expect(dockRect.y + dockRect.height).toBeGreaterThan(viewport.height * 0.8);
          expect(Math.abs(dockRect.x + dockRect.width / 2 - viewport.width / 2)).toBeLessThan(40);
        } else {
          expect(dockRect.x + dockRect.width).toBeGreaterThan(viewport.width * 0.9);
        }
      }

      // Panels open next to the dock and close again from the same control.
      await openPanel(page, '작품 목록 패널');
      await expect(page.getByRole('heading', { name: '활성 작품 (2)' })).toBeVisible();
      await activateWithKeyboard(page, page.getByRole('button', { name: '작품 목록 패널' }));
      await expect(page.getByRole('button', { name: '작품 목록 패널' }))
        .toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('R14.2-R14.3 toggles a dock panel with keyboard activation and Escape', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await bootArchive(page);

    await openPanel(page, '작품 목록 패널');
    await expect(page.getByRole('region', { name: '작품 목록 패널' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '활성 작품 (2)' })).toBeVisible();

    await page.keyboard.press('Escape');
    const dockButton = page.getByRole('button', { name: '작품 목록 패널' });
    await expect(dockButton).toHaveAttribute('aria-expanded', 'false');
    await expect(dockButton).toBeFocused();
    await expect(page.getByRole('region', { name: '작품 목록 패널' })).toBeHidden();
  });

  test('R4.2-R4.4 R14.5-R14.9 contains a scrolling Card and preserves all state across the breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 480 });
    await bootArchive(page);

    await openPanel(page, '작품 DOM 탐색 패널');
    await activateWithKeyboard(page, page.getByRole('button', { name: 'Second Signal 상세 및 관리' }));
    const card = page.getByRole('complementary', { name: 'Second Signal' });
    await expect(card).toBeVisible();

    const containment = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: rect.top,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
        left: rect.left,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    });
    expect(containment.top).toBeGreaterThanOrEqual(8);
    expect(containment.right).toBeGreaterThanOrEqual(8);
    expect(containment.bottom).toBeGreaterThanOrEqual(8);
    expect(containment.left).toBeGreaterThanOrEqual(8);
    expect(containment.overflowY).toBe('auto');

    await openPanel(page, '아카이브 현황');
    await activateWithKeyboard(page, page.getByRole('button', { name: 'SF', exact: true }));
    await activateWithKeyboard(page, card.getByRole('button', { name: '별자리에 묶기' }));

    await openPanel(page, '아카이브 현황');
    await expect(page.getByRole('button', { name: 'SF', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await openPanel(page, '별자리 관리');
    await expect(page.getByText('1/200개 작품 선택')).toBeVisible();
    await openPanel(page, '작품 DOM 탐색 패널');
    await expect(page.getByRole('button', { name: 'Second Signal 별자리 노드로 선택됨' })).toBeDisabled();

    // Crossing the breakpoint in both directions preserves every state slice.
    for (const width of [768, 767]) {
      await page.setViewportSize({ width, height: 700 });
      await expect(card).toBeVisible();
      await openPanel(page, '아카이브 현황');
      await expect(page.getByRole('button', { name: 'SF', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await openPanel(page, '별자리 관리');
      await expect(page.getByText('1/200개 작품 선택')).toBeVisible();
      await openPanel(page, '작품 DOM 탐색 패널');
      await expect(page.getByRole('button', { name: 'Second Signal 별자리 노드로 선택됨' })).toBeDisabled();
      await openPanel(page, '작품 목록 패널');
      await expect(page.getByRole('heading', { name: '활성 작품 (2)' })).toBeVisible();
    }
  });
});

test.describe('accessible browser acceptance', () => {
  test('R6.9 R12.6-R12.8 R14.1 runs an axe WCAG A/AA audit with closed and open panels', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await bootArchive(page);

    const closedResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(closedResults.violations, closedResults.violations.map((violation) => (
      `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
    )).join('\n')).toEqual([]);

    await openPanel(page, '작품 DOM 탐색 패널');
    const openResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(openResults.violations, openResults.violations.map((violation) => (
      `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
    )).join('\n')).toEqual([]);
  });

  test('R4.2-R4.13 R6.9 R7.6 R10.7-R10.8 R12.6-R12.8 completes the archive journey with keyboard controls', async ({ page }) => {
    // A long serial keyboard journey over the fullscreen WebGL sky needs
    // extra headroom under software rendering.
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1024, height: 900 });
    await bootArchive(page, { starCount: 1 });

    await addWorkWithKeyboard(page);
    await openPanel(page, '작품 목록 패널');
    await expect(page.getByRole('heading', { name: '활성 작품 (2)' })).toBeVisible();

    await openPanel(page, '작품 DOM 탐색 패널');
    await activateWithKeyboard(page, page.getByRole('button', { name: 'Keyboard Odyssey 상세 및 관리' }));
    const card = page.getByRole('complementary', { name: 'Keyboard Odyssey' });
    await expect(card).toContainText('Keyboard Director');
    await expect(card).toContainText('5/5');

    await openPanel(page, '아카이브 현황');
    const sfFilter = page.getByRole('button', { name: 'SF', exact: true });
    await activateWithKeyboard(page, sfFilter);
    await expect(sfFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('1개 장르 선택됨')).toBeVisible();

    await activateWithKeyboard(page, card.getByRole('button', { name: '블랙홀로 이동' }));
    const softDeleteDialog = page.getByRole('dialog', { name: '블랙홀 이동 확인' });
    await expect(softDeleteDialog.getByText('영향받는 별자리가 없습니다.')).toBeVisible();
    await activateWithKeyboard(page, softDeleteDialog.getByRole('button', { name: '블랙홀 이동 실행' }));
    await openPanel(page, '작품 목록 패널');
    await expect(page.getByRole('heading', { name: '활성 작품 (1)' })).toBeVisible();
    await openPanel(page, '작품 DOM 탐색 패널');
    await expect(page.getByLabel('보관 작품 1개')).toBeVisible();

    await activateWithKeyboard(page, page.getByRole('button', { name: 'Keyboard Odyssey 복원' }));
    await expect(page.getByLabel('보관 작품 0개')).toBeVisible();
    await openPanel(page, '작품 목록 패널');
    await expect(page.getByRole('heading', { name: '활성 작품 (2)' })).toBeVisible();

    await openPanel(page, '별자리 관리');
    await activateWithKeyboard(page, page.getByRole('button', { name: '수동으로 만들기' }));
    await openPanel(page, '작품 DOM 탐색 패널');
    await activateWithKeyboard(page, page.getByRole('button', { name: 'Seed Voyage 별자리 노드로 선택' }));
    await activateWithKeyboard(page, page.getByRole('button', { name: 'Keyboard Odyssey 별자리 노드로 선택' }));
    await openPanel(page, '별자리 관리');
    await activateWithKeyboard(page, page.getByRole('button', { name: '선택 완료' }));

    const constellationName = page.getByLabel('이름 (최대 30자)');
    await expect(constellationName).toBeFocused();
    await constellationName.pressSequentially('Keyboard Route');
    await activateWithKeyboard(page, page.getByRole('button', { name: '별자리 생성' }));
    await expect(page.getByText('별자리를 만들었습니다.')).toBeVisible();

    await openPanel(page, '작품 DOM 탐색 패널');
    const constellation = page.getByRole('button', { name: 'Keyboard Route (2개 작품)' });
    await expect(constellation).toBeEnabled();
    await activateWithKeyboard(page, constellation);

    await activateWithKeyboard(page, page.getByRole('button', { name: 'Keyboard Odyssey 상세 및 관리' }));
    await activateWithKeyboard(page, page.getByRole('complementary', { name: 'Keyboard Odyssey' })
      .getByRole('button', { name: '작품 영구 삭제' }));
    const hardDeleteDialog = page.getByRole('dialog', { name: '영구 삭제 확인' });
    await expect(hardDeleteDialog.getByText('Keyboard Route')).toBeVisible();
    await activateWithKeyboard(page, hardDeleteDialog.getByRole('button', { name: '영구 삭제 실행' }));

    await openPanel(page, '작품 목록 패널');
    await expect(page.getByRole('heading', { name: '활성 작품 (1)' })).toBeVisible();
    await openPanel(page, '작품 DOM 탐색 패널');
    await expect(page.getByRole('button', { name: 'Keyboard Odyssey 상세 및 관리' })).toHaveCount(0);
    await expect(page.getByLabel('보관 작품 0개')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keyboard Route (1개 작품)' })).toBeDisabled();
    await expect(page.getByText('활성 작품이 2개 이상 필요합니다')).toBeVisible();
  });
});
