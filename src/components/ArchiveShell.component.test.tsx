import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ArchiveShell } from './ArchiveShell';

describe('ArchiveShell', () => {
  it('R14.1-R14.4 renders the Canvas, overlays, and drawer as simultaneous CSS layout regions', () => {
    const { container } = render(
      <ArchiveShell
        canvas={<div>3D Canvas</div>}
        dashboardOverlays={<div>HUD and Filter</div>}
        listView={<aside>ListView drawer</aside>}
      />,
    );

    expect(screen.getByRole('region', { name: '반응형 우주 아카이브' })).toBeInTheDocument();
    expect(screen.getByText('3D Canvas')).toBeInTheDocument();
    expect(screen.getByText('HUD and Filter')).toBeInTheDocument();
    expect(screen.getByText('ListView drawer')).toBeInTheDocument();
    expect(container.querySelector('.archive-shell-canvas')).toBeInTheDocument();
    expect(container.querySelector('.archive-shell-overlays')).toBeInTheDocument();
    expect(container.querySelector('.archive-shell-list')).toBeInTheDocument();
  });

  it('R14.8-R14.9 preserves mounted child state when the shell rerenders', async () => {
    const user = userEvent.setup();
    const renderShell = () => (
      <ArchiveShell
        canvas={<div>3D Canvas</div>}
        dashboardOverlays={<input aria-label="필터 초안" defaultValue="" />}
        listView={<aside>ListView drawer</aside>}
      />
    );
    const { rerender } = render(renderShell());
    const draft = screen.getByLabelText('필터 초안');

    await user.type(draft, 'SF');
    rerender(renderShell());

    expect(screen.getByLabelText('필터 초안')).toBe(draft);
    expect(screen.getByLabelText('필터 초안')).toHaveValue('SF');
  });
});
