// The notice is the only thing standing between a visitor and an archive that
// silently begins with fifteen films they never watched — and its confirm
// button destroys data, so what must NOT clear matters as much as what does.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import { createDemoSeedPersistedStore } from '../domain/demoSeedState';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { DemoNotice } from './DemoNotice';

const MARK = 'space-movie-archive:demo-planted';
const DEFERRED = 'space-movie-archive:demo-notice-deferred';

function createSeededStore(): ArchiveStoreApi {
  const store = createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
      nowIso: () => '2030-01-01T00:00:00.000Z',
    }),
    initialState: createDefaultStore(true),
  });
  store.getState().commands.importArchive(createDemoSeedPersistedStore());
  return store;
}

let store: ArchiveStoreApi;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  store = createSeededStore();
});

afterEach(() => {
  cleanup();
  store.dispose();
});

describe('DemoNotice', () => {
  it('stays away when the sky was not planted by us', () => {
    render(<DemoNotice store={store} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the sample as a sample, with the real count', () => {
    window.localStorage.setItem(MARK, 'true');
    const seeded = store.getState().persisted.stars.length;
    expect(seeded).toBeGreaterThan(0);

    render(<DemoNotice store={store} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /예시/ })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${seeded}편`))).toBeInTheDocument();
  });

  it('clears the whole archive on confirm, not just the stars', async () => {
    window.localStorage.setItem(MARK, 'true');
    const before = store.getState().persisted;
    expect(before.constellations.length).toBeGreaterThan(0);
    expect(before.blackholeArchive.length).toBeGreaterThan(0);

    render(<DemoNotice store={store} />);
    await userEvent.click(screen.getByRole('button', { name: /확인/ }));

    const after = store.getState().persisted;
    expect(after.stars).toEqual([]);
    expect(after.constellations).toEqual([]);
    expect(after.blackholeArchive).toEqual([]);
    // Answered, so it must never offer to wipe this archive again.
    expect(window.localStorage.getItem(MARK)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not clear anything when the visitor defers', async () => {
    window.localStorage.setItem(MARK, 'true');
    const seeded = store.getState().persisted.stars.length;

    render(<DemoNotice store={store} />);
    await userEvent.click(screen.getByRole('button', { name: '먼저 둘러볼게요' }));

    expect(store.getState().persisted.stars).toHaveLength(seeded);
    // Still a planted sky, so the question is still owed — just not this tab.
    expect(window.localStorage.getItem(MARK)).toBe('true');
    expect(window.sessionStorage.getItem(DEFERRED)).toBe('true');
  });

  it('never lets a keystroke destroy the archive', async () => {
    window.localStorage.setItem(MARK, 'true');
    const seeded = store.getState().persisted.stars.length;

    render(<DemoNotice store={store} />);
    await userEvent.keyboard('{Escape}');

    // Escape dismisses; it must not be a shortcut for "delete everything".
    expect(store.getState().persisted.stars).toHaveLength(seeded);
    expect(window.localStorage.getItem(MARK)).toBe('true');
  });

  it('stays down for the rest of a session once deferred', () => {
    window.localStorage.setItem(MARK, 'true');
    window.sessionStorage.setItem(DEFERRED, 'true');

    render(<DemoNotice store={store} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
