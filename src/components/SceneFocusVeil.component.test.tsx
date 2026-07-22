import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SceneFocusVeil } from './SceneFocusVeil';

/**
 * The veil dims the sky whenever an overlay (a data-open panel, the work card,
 * a modal backdrop) is present. It watches the DOM via a MutationObserver, so
 * these tests toggle real nodes and assert the resulting class.
 */
describe('SceneFocusVeil', () => {
  it('activates only while a dock panel is open', async () => {
    const panel = document.createElement('div');
    panel.className = 'shell-panel';
    panel.setAttribute('data-open', 'false');
    document.body.appendChild(panel);

    const { container } = render(<SceneFocusVeil />);
    const veil = container.querySelector('.scene-focus-veil')!;
    expect(veil.classList.contains('is-active')).toBe(false);

    panel.setAttribute('data-open', 'true');
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(true));

    panel.setAttribute('data-open', 'false');
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(false));

    panel.remove();
  });

  it('activates for the work card and modal backdrops', async () => {
    const { container } = render(<SceneFocusVeil />);
    const veil = container.querySelector('.scene-focus-veil')!;

    const card = document.createElement('aside');
    card.className = 'work-card';
    document.body.appendChild(card);
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(true));

    card.remove();
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(false));

    const dialog = document.createElement('div');
    dialog.className = 'dialog-backdrop';
    document.body.appendChild(dialog);
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(true));

    dialog.remove();
    await waitFor(() => expect(veil.classList.contains('is-active')).toBe(false));
  });
});
