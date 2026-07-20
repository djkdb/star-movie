import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter, IncrementingUuidProvider } from '../test/providers';
import { createArchiveStore } from '../store/archiveStore';
import { AddWorkForm } from './AddWorkForm';

const NOW = '2025-04-05T06:07:08.000Z';

function createStore() {
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter({ failWrites: false }),
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  const uuid = new IncrementingUuidProvider();
  return createArchiveStore({
    persistence,
    providers: { nextUuid: () => uuid.next(), nowIso: () => NOW },
  });
}

const SEARCH_RESPONSE = {
  results: [
    {
      id: 496243,
      title: '기생충',
      release_date: '2019-05-30',
      poster_path: '/pos.jpg',
      genre_ids: [35, 53],
    },
  ],
};
const CREDITS_RESPONSE = { crew: [{ job: 'Director', name: '봉준호' }] };

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/credits') ? CREDITS_RESPONSE : SEARCH_RESPONSE;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
}

describe('AddWorkForm TMDB autocomplete', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'test-key');
    vi.stubGlobal('fetch', stubFetch());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('suggests movies while typing and fills title, genre, director, and poster on pick', async () => {
    const user = userEvent.setup();
    render(<AddWorkForm store={createStore()} />);

    await user.type(screen.getByLabelText('제목'), '기생충');

    // Debounced suggestion appears as a listbox option.
    const option = await screen.findByRole('option', { name: /기생충/ }, { timeout: 2_000 });
    expect(option).toBeInTheDocument();

    await user.click(option);

    // Title and mapped genre fill immediately.
    expect(screen.getByLabelText('제목')).toHaveValue('기생충');
    expect(screen.getByLabelText('장르')).toHaveValue('코미디');

    // Director backfills asynchronously from the credits lookup.
    await waitFor(() =>
      expect(screen.getByLabelText('직접 입력 감독')).toHaveValue('봉준호'),
    );

    // The picked poster renders as a preview thumbnail.
    const poster = document.querySelector('.autocomplete-poster-thumb');
    expect(poster?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w200/pos.jpg');
  });

  it('drops the picked poster when the title is edited afterward', async () => {
    const user = userEvent.setup();
    render(<AddWorkForm store={createStore()} />);

    await user.type(screen.getByLabelText('제목'), '기생충');
    await user.click(await screen.findByRole('option', { name: /기생충/ }, { timeout: 2_000 }));
    expect(document.querySelector('.autocomplete-poster-thumb')).not.toBeNull();

    await user.type(screen.getByLabelText('제목'), '2');
    expect(document.querySelector('.autocomplete-poster-thumb')).toBeNull();
  });
});
