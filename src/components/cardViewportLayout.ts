export const CARD_VIEWPORT_MARGIN_PX = 8;
export const CARD_ANCHOR_OFFSET_PX = 12;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CardSize {
  width: number;
  height: number;
}

export interface CardAnchor {
  x: number;
  y: number;
}

export interface CardViewportLayout {
  left: number;
  top: number;
  renderedWidth: number;
  renderedHeight: number;
  maxWidth: number;
  maxHeight: number;
  overflowY: 'auto' | 'visible';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Places the card next to its screen anchor while constraining its rendered box
 * to the visible viewport. Viewports narrower than both margins cannot satisfy
 * both edges, so their constrained extent is zero until usable space exists.
 */
export function calculateCardViewportLayout(
  viewport: ViewportSize,
  card: CardSize,
  anchor: CardAnchor,
): CardViewportLayout {
  const maxWidth = Math.max(0, viewport.width - CARD_VIEWPORT_MARGIN_PX * 2);
  const maxHeight = Math.max(0, viewport.height - CARD_VIEWPORT_MARGIN_PX * 2);
  const renderedWidth = Math.min(card.width, maxWidth);
  const renderedHeight = Math.min(card.height, maxHeight);

  const canMaintainHorizontalMargin = viewport.width >= CARD_VIEWPORT_MARGIN_PX * 2;
  const canMaintainVerticalMargin = viewport.height >= CARD_VIEWPORT_MARGIN_PX * 2;
  const minimumLeft = canMaintainHorizontalMargin ? CARD_VIEWPORT_MARGIN_PX : 0;
  const minimumTop = canMaintainVerticalMargin ? CARD_VIEWPORT_MARGIN_PX : 0;
  const maximumLeft = canMaintainHorizontalMargin
    ? viewport.width - CARD_VIEWPORT_MARGIN_PX - renderedWidth
    : Math.max(0, viewport.width - renderedWidth);
  const maximumTop = canMaintainVerticalMargin
    ? viewport.height - CARD_VIEWPORT_MARGIN_PX - renderedHeight
    : Math.max(0, viewport.height - renderedHeight);

  return {
    left: clamp(anchor.x + CARD_ANCHOR_OFFSET_PX, minimumLeft, maximumLeft),
    top: clamp(anchor.y + CARD_ANCHOR_OFFSET_PX, minimumTop, maximumTop),
    renderedWidth,
    renderedHeight,
    maxWidth,
    maxHeight,
    overflowY: card.height > maxHeight ? 'auto' : 'visible',
  };
}
