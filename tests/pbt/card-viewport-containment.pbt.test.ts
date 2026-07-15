// Feature: space-movie-archive, Property 22: Card viewport containment
// **Validates: Requirements 14.5, 14.6**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  calculateCardViewportLayout,
  CARD_VIEWPORT_MARGIN_PX,
} from '../../src/components/cardViewportLayout';

const scenarioArbitrary = fc.record({
  viewport: fc.record({
    width: fc.integer({ min: 1, max: 3_840 }),
    height: fc.integer({ min: 1, max: 2_160 }),
  }),
  card: fc.record({
    width: fc.integer({ min: 1, max: 2_000 }),
    height: fc.integer({ min: 1, max: 4_000 }),
  }),
  anchor: fc.record({
    x: fc.integer({ min: -4_000, max: 8_000 }),
    y: fc.integer({ min: -4_000, max: 8_000 }),
  }),
});

describe('Property 22: Card viewport containment', () => {
  it('R14.5 R14.6 keeps an 8px viewport margin when possible and enables internal scrolling for excess height', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ viewport, card, anchor }) => {
        const layout = calculateCardViewportLayout(viewport, card, anchor);
        const availableWidth = Math.max(
          0,
          viewport.width - CARD_VIEWPORT_MARGIN_PX * 2,
        );
        const availableHeight = Math.max(
          0,
          viewport.height - CARD_VIEWPORT_MARGIN_PX * 2,
        );

        expect(layout.maxWidth).toBe(availableWidth);
        expect(layout.maxHeight).toBe(availableHeight);
        expect(layout.renderedWidth).toBe(Math.min(card.width, availableWidth));
        expect(layout.renderedHeight).toBe(Math.min(card.height, availableHeight));

        if (viewport.width >= CARD_VIEWPORT_MARGIN_PX * 2) {
          expect(layout.left).toBeGreaterThanOrEqual(CARD_VIEWPORT_MARGIN_PX);
          expect(layout.left + layout.renderedWidth).toBeLessThanOrEqual(
            viewport.width - CARD_VIEWPORT_MARGIN_PX,
          );
        }
        if (viewport.height >= CARD_VIEWPORT_MARGIN_PX * 2) {
          expect(layout.top).toBeGreaterThanOrEqual(CARD_VIEWPORT_MARGIN_PX);
          expect(layout.top + layout.renderedHeight).toBeLessThanOrEqual(
            viewport.height - CARD_VIEWPORT_MARGIN_PX,
          );
        }

        expect(layout.overflowY).toBe(
          card.height > availableHeight ? 'auto' : 'visible',
        );
      }),
      { numRuns: 200 },
    );
  });
});
