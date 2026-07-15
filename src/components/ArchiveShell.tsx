import type { ReactNode } from 'react';

export interface ArchiveShellProps {
  canvas: ReactNode;
  dashboardOverlays: ReactNode;
  listView: ReactNode;
}

/**
 * Keeps the three responsive regions mounted exactly once. The 768px layout
 * transition is intentionally CSS-only so local drafts and Store selections
 * survive viewport changes without a responsive render branch.
 */
export function ArchiveShell({
  canvas,
  dashboardOverlays,
  listView,
}: ArchiveShellProps) {
  return (
    <section aria-label="반응형 우주 아카이브" className="archive-shell">
      <div className="archive-shell-overlays">{dashboardOverlays}</div>
      <div className="archive-shell-canvas">{canvas}</div>
      <div className="archive-shell-list">{listView}</div>
    </section>
  );
}
