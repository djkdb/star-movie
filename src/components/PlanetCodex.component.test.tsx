import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { PlanetCodexPanel } from './PlanetCodexPanel';

function createStoreWithTickets(lifetimeStarsAdded: number): ArchiveStoreApi {
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
    nowIso: () => '2025-04-05T06:07:08.000Z',
  });
  const initialState = createDefaultStore(true);
  initialState.persisted.planetCollection = {
    lifetimeStarsAdded,
    pullsPerformed: 0,
    planets: [],
  };
  let uuidCounter = 0;
  return createArchiveStore({
    persistence,
    initialState,
    providers: {
      nextUuid: () => `10000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, '0')}`,
      nowIso: () => '2025-04-05T06:07:08.000Z',
      // Rolls of 0 => common tier, first common species (베르데), orbit seed 0.
      nextRandom: () => 0,
    },
  });
}

describe('PlanetCodexPanel', () => {
  it('shows the ticket count and an empty dex before any pull', () => {
    const store = createStoreWithTickets(10);
    render(<PlanetCodexPanel store={store} />);

    expect(screen.getByText(/가챠 티켓/).textContent).toContain('2');
    expect(screen.getByText('수집 0/42')).toBeTruthy();
    expect(screen.getAllByText('미발견')).toHaveLength(42);
  });

  it('pulls a planet, revealing it and updating the dex', async () => {
    const user = userEvent.setup();
    const store = createStoreWithTickets(10);
    render(<PlanetCodexPanel store={store} />);

    await user.click(screen.getByRole('button', { name: '행성 뽑기' }));

    // One ticket spent, one distinct species collected.
    expect(screen.getByText(/가챠 티켓/).textContent).toContain('1');
    expect(screen.getByText('수집 1/42')).toBeTruthy();
    // The reveal card announces the pulled species as new.
    expect(screen.getByText('NEW')).toBeTruthy();
    expect(store.getState().persisted.planetCollection.planets).toHaveLength(1);
  });

  it('disables the pull button when no ticket is available', () => {
    const store = createStoreWithTickets(4); // fewer than five stars => no ticket
    render(<PlanetCodexPanel store={store} />);

    const button = screen.getByRole('button', { name: '티켓이 없습니다' });
    expect(button).toHaveProperty('disabled', true);
  });
});
