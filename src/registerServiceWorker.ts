/**
 * The PWA service worker is configured for autoUpdate: when a new build is
 * deployed it installs, skips waiting, and claims the page. Without a reload the
 * *currently open* tab keeps rendering from the previously cached bundle until
 * the app is fully closed and reopened — which is how a since-removed feature
 * can appear to "still be there" after an update.
 *
 * This reloads the page exactly once the moment a new worker takes control, so
 * the fresh build is shown immediately. It is guarded two ways: it only reloads
 * when a controller was already in charge (never on the very first install, which
 * would reload every first visit), and only once per session.
 */
export function reloadOnServiceWorkerUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const hadControllerAtStartup = navigator.serviceWorker.controller !== null;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtStartup || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
