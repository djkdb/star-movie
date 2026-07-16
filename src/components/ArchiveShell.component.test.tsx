import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ArchiveShell, type ShellPanelDefinition } from './ArchiveShell';

function createPanels(): readonly ShellPanelDefinition[] {
  return [
    {
      id: 'overview',
      label: '아카이브 현황',
      icon: <svg aria-hidden="true" />,
      content: <div>HUD and Filter</div>,
    },
    {
      id: 'list',
      label: '작품 목록 패널',
      icon: <svg aria-hidden="true" />,
      content: <aside>ListView drawer</aside>,
    },
  ];
}

describe('ArchiveShell', () => {
  it('R14.1-R14.4 renders the fullscreen Canvas, the dock, and every panel as mounted regions', () => {
    const { container } = render(
      <ArchiveShell canvas={<div>3D Canvas</div>} panels={createPanels()} />,
    );

    expect(screen.getByRole('region', { name: '반응형 우주 아카이브' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '아카이브 패널' })).toBeInTheDocument();
    expect(screen.getByText('3D Canvas')).toBeInTheDocument();
    expect(container.querySelector('.archive-shell-canvas')).toBeInTheDocument();

    // Closed panels stay mounted (hidden via CSS) so child state survives.
    expect(screen.getByText('HUD and Filter')).toBeInTheDocument();
    expect(screen.getByText('ListView drawer')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('opens exactly one panel per dock button and closes it with Escape', async () => {
    const user = userEvent.setup();
    render(<ArchiveShell canvas={<div>3D Canvas</div>} panels={createPanels()} />);

    const overviewButton = screen.getByRole('button', { name: '아카이브 현황' });
    await user.click(overviewButton);
    expect(overviewButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: '아카이브 현황' })).toBeInTheDocument();

    const listButton = screen.getByRole('button', { name: '작품 목록 패널' });
    await user.click(listButton);
    expect(listButton).toHaveAttribute('aria-expanded', 'true');
    expect(overviewButton).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    expect(listButton).toHaveAttribute('aria-expanded', 'false');
    expect(listButton).toHaveFocus();
  });

  it('R14.8-R14.9 preserves mounted panel state across open, close, and rerender', async () => {
    const user = userEvent.setup();
    const renderShell = () => (
      <ArchiveShell
        canvas={<div>3D Canvas</div>}
        panels={[
          {
            id: 'overview',
            label: '아카이브 현황',
            icon: <svg aria-hidden="true" />,
            content: <input aria-label="필터 초안" defaultValue="" />,
          },
        ]}
      />
    );
    const { rerender } = render(renderShell());

    await user.click(screen.getByRole('button', { name: '아카이브 현황' }));
    const draft = screen.getByLabelText('필터 초안');
    await user.type(draft, 'SF');

    // Close the panel, rerender the shell, and reopen: same node, same value.
    await user.keyboard('{Escape}');
    rerender(renderShell());
    await user.click(screen.getByRole('button', { name: '아카이브 현황' }));

    expect(screen.getByLabelText('필터 초안')).toBe(draft);
    expect(screen.getByLabelText('필터 초안')).toHaveValue('SF');
  });
});
