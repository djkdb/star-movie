import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter, IncrementingUuidProvider } from '../test/providers';
import { ConstellationControls } from './ConstellationControls';

const NOW = '2025-06-01T00:00:00.000Z';

function createHarness(): ArchiveStoreApi {
  const uuid = new IncrementingUuidProvider();
  return createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
      nowIso: () => NOW,
    }),
    providers: {
      nextUuid: () => uuid.next(),
      nowIso: () => NOW,
    },
  });
}

function addWork(store: ArchiveStoreApi, title: string, genre: 'SF' | '드라마' = 'SF'): string {
  const result = store.getState().commands.addWork({
    title,
    genre,
    rating: 4,
    review: '',
    watchedDate: '2025-05-01',
    director: 'Director',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.starId;
}

describe('ConstellationControls', () => {
  it('R9.1 R9.5-R9.8 R9.12 connects selection completion, validation, naming and cancellation to Store commands', async () => {
    const store = createHarness();
    const firstId = addWork(store, 'First');
    const secondId = addWork(store, 'Second');
    const user = userEvent.setup();
    render(<ConstellationControls store={store} />);

    await user.click(screen.getByRole('button', { name: '수동으로 만들기' }));
    expect(store.getState().runtime.constellationDraft.active).toBe(true);

    store.getState().commands.selectConstellationStar(firstId);
    await user.click(screen.getByRole('button', { name: '선택 완료' }));
    expect(screen.getByRole('alert')).toHaveTextContent('2개 이상');
    expect(store.getState().runtime.constellationDraft.starIds).toEqual([firstId]);

    store.getState().commands.selectConstellationStar(secondId);
    await user.click(screen.getByRole('button', { name: '선택 완료' }));
    expect(screen.getByRole('dialog', { name: '별자리 이름 정하기' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '별자리 생성' }));
    expect(screen.getByRole('alert')).toHaveTextContent('이름을 입력');
    expect(store.getState().runtime.constellationDraft.starIds).toEqual([firstId, secondId]);

    await user.type(screen.getByLabelText('이름 (최대 30자)'), '  나의 별자리  ');
    await user.click(screen.getByRole('button', { name: '별자리 생성' }));
    expect(store.getState().persisted.constellations.at(-1)).toMatchObject({
      name: '나의 별자리',
      starIds: [firstId, secondId],
    });
    expect(store.getState().runtime.constellationDraft.active).toBe(false);

    await user.click(screen.getByRole('button', { name: '수동으로 만들기' }));
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(store.getState().runtime.constellationDraft.active).toBe(false);
  });

  it('R9.10-R9.13 connects automatic creation and reports eligible and empty outcomes', async () => {
    const eligibleStore = createHarness();
    const firstId = addWork(eligibleStore, 'First');
    const secondId = addWork(eligibleStore, 'Second');
    const user = userEvent.setup();
    const { unmount } = render(<ConstellationControls store={eligibleStore} />);

    await user.click(screen.getByRole('button', { name: '장르로 자동 별자리 만들기' }));
    expect(screen.getByRole('status')).toHaveTextContent('1개의 장르 별자리');
    expect(eligibleStore.getState().persisted.constellations).toHaveLength(1);
    expect(eligibleStore.getState().persisted.constellations[0]!.starIds).toEqual([
      firstId,
      secondId,
    ]);
    unmount();

    const emptyStore = createHarness();
    render(<ConstellationControls store={emptyStore} />);
    await user.click(screen.getByRole('button', { name: '장르로 자동 별자리 만들기' }));
    expect(screen.getByRole('status')).toHaveTextContent('자동 생성할 장르가 없습니다');
    expect(emptyStore.getState().persisted.constellations).toEqual([]);
  });
});
