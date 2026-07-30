// The real Supabase is not reachable from CI, so the panel is exercised through
// the gateway interface with a fake — which is also how a provider swap would
// be validated later.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  CloudArchiveGateway,
  CloudSession,
} from '../cloud/cloudArchiveGateway';
import type { RemoteArchiveMeta } from '../cloud/cloudSyncModel';
import { createDefaultStore } from '../domain/defaultState';
import type { PersistedStateV2 } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { CloudSyncPanel } from './CloudSyncPanel';

function createStore(): ArchiveStoreApi {
  return createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
      nowIso: () => '2030-01-01T00:00:00.000Z',
    }),
    initialState: createDefaultStore(true),
  });
}

function meta(workCount: number): RemoteArchiveMeta {
  return {
    revision: 4,
    updatedAt: '2026-07-30T09:00:00.000Z',
    deviceLabel: 'Android',
    summary: {
      workCount,
      constellationCount: 0,
      archivedCount: 0,
      watchlistCount: 0,
      planetCount: 0,
    },
  };
}

interface FakeOptions {
  session?: CloudSession | null;
  remote?: { meta: RemoteArchiveMeta; document: PersistedStateV2 } | null;
}

function createFakeGateway(options: FakeOptions = {}) {
  const session = options.session ?? null;
  const remote = options.remote ?? null;
  const pushArchive = vi.fn(async () => ({ ok: true as const, value: meta(1) }));
  const gateway: CloudArchiveGateway = {
    getSession: async () => session,
    onSessionChange: () => () => {},
    signUp: async () => ({ ok: true, value: { needsConfirmation: true } }),
    signIn: async () => ({ ok: true, value: undefined }),
    signOut: async () => {},
    fetchMeta: async () => ({ ok: true, value: remote?.meta ?? null }),
    fetchArchive: async () => ({ ok: true, value: remote }),
    pushArchive,
  };
  return { gateway, pushArchive };
}

describe('CloudSyncPanel', () => {
  it('renders nothing when Supabase is not configured', () => {
    const store = createStore();
    try {
      const { container } = render(<CloudSyncPanel gateway={null} store={store} />);
      expect(container).toBeEmptyDOMElement();
    } finally {
      store.dispose();
    }
  });

  it('offers sign-in while signed out, and explains the app still works locally', async () => {
    const store = createStore();
    const { gateway } = createFakeGateway();
    try {
      render(<CloudSyncPanel gateway={gateway} store={store} />);
      expect(await screen.findByLabelText('이메일')).toBeInTheDocument();
      expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
      expect(screen.getByText(/로그인하지 않아도/)).toBeInTheDocument();
    } finally {
      store.dispose();
    }
  });

  it('uploads the current archive when signed in', async () => {
    const store = createStore();
    const { gateway, pushArchive } = createFakeGateway({
      session: { userId: 'u1', email: 'me@example.com' },
    });
    try {
      render(<CloudSyncPanel gateway={gateway} store={store} />);
      const upload = await screen.findByRole('button', { name: /클라우드에 저장/ });

      await userEvent.click(upload);

      await waitFor(() => expect(pushArchive).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('클라우드에 저장했어요.')).toBeInTheDocument();
    } finally {
      store.dispose();
    }
  });

  /** Puts a work in the local archive so a replacement is observable. */
  function seedLocalWork(store: ArchiveStoreApi, title: string): void {
    const added = store.getState().commands.addWork({
      title,
      genre: 'SF',
      rating: 5,
      review: '',
      watchedDate: '2025-01-01',
      director: 'Director',
    });
    if (!added.ok) throw new Error('setup failed');
  }

  it('confirms before replacing the local archive with the cloud copy', async () => {
    const store = createStore();
    try {
      seedLocalWork(store, 'Local Only');
      // The cloud holds a different archive — empty, so the swap is unmistakable.
      const cloudDoc = structuredClone(createDefaultStore(true).persisted);
      const { gateway } = createFakeGateway({
        session: { userId: 'u1', email: 'me@example.com' },
        remote: { meta: meta(0), document: cloudDoc },
      });

      render(<CloudSyncPanel gateway={gateway} store={store} />);
      await userEvent.click(
        await screen.findByRole('button', { name: /클라우드에서 불러오기/ }),
      );

      // Nothing is replaced until the user confirms.
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('완전히 대체');
      expect(store.getState().persisted.stars).toHaveLength(1);

      await userEvent.click(screen.getByRole('button', { name: '불러오기' }));

      await waitFor(() => expect(store.getState().persisted.stars).toHaveLength(0));
    } finally {
      store.dispose();
    }
  });

  it('cancelling the download leaves the local archive alone', async () => {
    const store = createStore();
    try {
      seedLocalWork(store, 'Keep Me');
      const cloudDoc = structuredClone(createDefaultStore(true).persisted);
      const { gateway } = createFakeGateway({
        session: { userId: 'u1', email: 'me@example.com' },
        remote: { meta: meta(0), document: cloudDoc },
      });

      render(<CloudSyncPanel gateway={gateway} store={store} />);
      await userEvent.click(await screen.findByRole('button', { name: /클라우드에서 불러오기/ }));
      await userEvent.click(await screen.findByRole('button', { name: '취소' }));

      expect(store.getState().persisted.stars).toHaveLength(1);
      expect(store.getState().persisted.stars[0]?.title).toBe('Keep Me');
    } finally {
      store.dispose();
    }
  });

  it('surfaces a cloud error instead of failing silently', async () => {
    const store = createStore();
    const { gateway } = createFakeGateway({
      session: { userId: 'u1', email: 'me@example.com' },
    });
    gateway.pushArchive = async () => ({ ok: false, message: '네트워크에 연결하지 못했어요.' });
    try {
      render(<CloudSyncPanel gateway={gateway} store={store} />);
      await userEvent.click(await screen.findByRole('button', { name: /클라우드에 저장/ }));

      expect(await screen.findByRole('alert'))
        .toHaveTextContent('네트워크에 연결하지 못했어요.');
    } finally {
      store.dispose();
    }
  });
});
