/**
 * A first-ever visitor lands in a sky that is already full — fifteen well-known
 * films, a constellation, two works in the black hole. That reads well, and it
 * is also a lie about their own archive, so the app has to say so and offer to
 * clear it.
 *
 * The mark records that the sky currently on screen was planted rather than
 * earned. It is set the moment the demo is written and removed the moment the
 * visitor answers, so the notice can never reappear over a real archive.
 */

const DEMO_MARK_KEY = 'space-movie-archive:demo-planted';

export function markDemoPlanted(): void {
  try {
    window.localStorage.setItem(DEMO_MARK_KEY, 'true');
  } catch {
    // No storage: the notice simply never shows, which is the safe direction —
    // better to leave the sky alone than to offer to wipe an archive we cannot
    // reason about.
  }
}

export function isShowingPlantedDemo(): boolean {
  try {
    return window.localStorage.getItem(DEMO_MARK_KEY) === 'true';
  } catch {
    return false;
  }
}

export function clearDemoMark(): void {
  try {
    window.localStorage.removeItem(DEMO_MARK_KEY);
  } catch {
    // Best effort.
  }
}
