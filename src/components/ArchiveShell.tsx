import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ShellPanelDefinition {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  wide?: boolean;
}

export interface ArchiveShellProps {
  canvas: ReactNode;
  panels: readonly ShellPanelDefinition[];
}

/**
 * Immersive shell: the 3D sky fills the viewport while every dashboard panel
 * stays mounted (so drafts and Store selections survive open/close cycles)
 * behind a minimal icon dock. Panels scale in next to the dock, close on
 * Escape or an outside click, and are CSS-hidden — never unmounted.
 */
export function ArchiveShell({ canvas, panels }: ArchiveShellProps) {
  const [openPanelId, setOpenPanelId] = useState<string | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const dockButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const closePanel = useCallback((options?: { restoreFocus?: boolean }) => {
    setOpenPanelId((current) => {
      if (current !== null && options?.restoreFocus === true) {
        dockButtonRefs.current.get(current)?.focus();
      }
      return null;
    });
  }, []);

  const togglePanel = (panelId: string) => {
    setOpenPanelId((current) => (current === panelId ? null : panelId));
  };

  // The canvas skip link targets #archive-dom-navigation, which lives inside
  // a closed panel; opening it on hash navigation keeps that path usable.
  useEffect(() => {
    const openHashTarget = () => {
      if (window.location.hash !== '#archive-dom-navigation') return;
      const owner = panels.find((panel) =>
        panel.id === 'navigation',
      );
      if (owner !== undefined) setOpenPanelId(owner.id);
    };
    openHashTarget();
    window.addEventListener('hashchange', openHashTarget);
    return () => window.removeEventListener('hashchange', openHashTarget);
  }, [panels]);

  useEffect(() => {
    if (openPanelId === null) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(
        '.shell-panel, .shell-dock, .work-card, .toast-region, .dialog-backdrop, [role="dialog"]',
      ) !== null) return;
      closePanel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Modal dialogs own Escape while they are open.
      if (document.querySelector('.dialog-backdrop') !== null) return;
      closePanel({ restoreFocus: true });
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePanel, openPanelId]);

  return (
    <section aria-label="반응형 우주 아카이브" className="archive-shell" ref={shellRef}>
      <div className="archive-shell-canvas">{canvas}</div>

      <nav aria-label="아카이브 패널" className="shell-dock">
        {panels.map((panel) => (
          <button
            aria-controls={`shell-panel-${panel.id}`}
            aria-expanded={openPanelId === panel.id}
            className={`dock-button${openPanelId === panel.id ? ' is-active' : ''}`}
            data-label={panel.label}
            key={panel.id}
            onClick={() => togglePanel(panel.id)}
            ref={(element) => {
              if (element === null) dockButtonRefs.current.delete(panel.id);
              else dockButtonRefs.current.set(panel.id, element);
            }}
            title={panel.label}
            type="button"
          >
            <span aria-hidden="true" className="dock-icon">{panel.icon}</span>
            <span className="visually-hidden">{panel.label}</span>
          </button>
        ))}
      </nav>

      {panels.map((panel) => (
        <div
          aria-hidden={openPanelId === panel.id ? undefined : true}
          aria-label={panel.label}
          className={`shell-panel${panel.wide === true ? ' shell-panel-wide' : ''}`}
          data-open={openPanelId === panel.id}
          id={`shell-panel-${panel.id}`}
          key={panel.id}
          role="region"
        >
          <div className="shell-panel-body">{panel.content}</div>
        </div>
      ))}
    </section>
  );
}
