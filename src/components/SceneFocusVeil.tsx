import { useEffect, useState } from 'react';

const OVERLAY_SELECTOR = '.shell-panel[data-open="true"], .work-card, .dialog-backdrop';

/**
 * Focus pull: dims the 3D sky behind a soft vignette whenever an overlay is
 * open, so content is never pasted over a busy screensaver. Driven by a
 * MutationObserver rather than CSS :has() — some engines fail to recalc a
 * :has() subject when the match toggles in a distant subtree. State (not a
 * direct classList write) drives the class so a parent re-render can't wipe it.
 */
export function SceneFocusVeil() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      setActive(document.querySelector(OVERLAY_SELECTOR) !== null);
    };
    evaluate();
    const observer = new MutationObserver(evaluate);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-open'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return <div aria-hidden="true" className={`scene-focus-veil${active ? ' is-active' : ''}`} />;
}
