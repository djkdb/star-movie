import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { ArchivedStar } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { BlackholeArchive } from './BlackholeArchive';

const ARCHIVED_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2025-04-05T06:07:08.000Z';

function archivedWork(): ArchivedStar {
  return {
    id: ARCHIVED_ID,
    title: 'Moon',
    normalizedTitle: 'moon',
    genre: 'SF',
    rating: 4,
    review: '달의 기록',
    watchedDate: '2025-04-01',
    director: 'Duncan Jones',
    normalizedDirector: 'duncan jones',
    position: { x: -45, y: 0, z: -45 },
    createdAt: NOW,
    discardedAt: NOW,
  };
}

function createRestoreHarness(failWrites: boolean) {
  const initialState = createDefaultStore(true);
  initialState.persisted.blackholeArchive = [archivedWork()];
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter({ failWrites }),
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  return createArchiveStore({
    initialState,
    persistence,
    providers: {
      nextUuid: () => '20000000-0000-4000-8000-000000000001',
      nowIso: () => NOW,
    },
  });
}

describe('BlackholeArchive restore interaction', () => {
  it('R12.10-R12.12 emits one restore completion event only after persistence succeeds', async () => {
    const store = createRestoreHarness(false);
    const user = userEvent.setup();
    render(<BlackholeArchive headingId="test-archive-heading" store={store} />);

    await user.click(screen.getByRole('button', { name: 'Moon 복원' }));

    expect(store.getState().persisted.stars.map(({ id }) => id)).toEqual([ARCHIVED_ID]);
    expect(store.getState().persisted.blackholeArchive).toEqual([]);
    expect(store.getState().runtime.completionEvents.filter(
      ({ type }) => type === 'work-restored',
    )).toHaveLength(1);
  });

  it('R12.12 preserves the archive and suppresses restore completion effects on failure', async () => {
    const store = createRestoreHarness(true);
    const user = userEvent.setup();
    render(<BlackholeArchive headingId="failed-archive-heading" store={store} />);

    await user.click(screen.getByRole('button', { name: 'Moon 복원' }));

    expect(store.getState().persisted.stars).toEqual([]);
    expect(store.getState().persisted.blackholeArchive.map(({ id }) => id)).toEqual([ARCHIVED_ID]);
    expect(store.getState().runtime.completionEvents.filter(
      ({ type }) => type === 'work-restored',
    )).toEqual([]);
    expect(store.getState().runtime.toastEvents).toHaveLength(1);
  });
});
