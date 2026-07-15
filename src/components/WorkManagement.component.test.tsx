import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter, IncrementingUuidProvider } from '../test/providers';
import { ArchiveDomNavigation } from './ArchiveDomNavigation';
import { BlackholeArchive } from './BlackholeArchive';
import { WorkCard } from './WorkCard';

const NOW = '2025-04-05T06:07:08.000Z';

function createHarness() {
  const uuid = new IncrementingUuidProvider();
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
    nowIso: () => NOW,
  });
  const store = createArchiveStore({
    persistence,
    providers: {
      nextUuid: () => uuid.next(),
      nowIso: () => NOW,
    },
  });
  return store;
}

function addWork(
  store: ArchiveStoreApi,
  title: string,
  overrides: Partial<{
    review: string;
    director: string;
    rating: 1 | 2 | 3 | 4 | 5;
  }> = {},
): string {
  const result = store.getState().commands.addWork({
    title,
    genre: 'SF',
    rating: overrides.rating ?? 5,
    review: overrides.review ?? `${title} 감상평`,
    watchedDate: '2025-04-01',
    director: overrides.director ?? 'Christopher Nolan',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.starId;
}

function selectWork(store: ArchiveStoreApi, starId: string): void {
  store.setState((state) => ({
    runtime: { ...state.runtime, selectedStarId: starId },
  }));
}

function addConstellation(
  store: ArchiveStoreApi,
  name: string,
  starIds: readonly string[],
): void {
  const result = store.getState().commands.createConstellation({
    name,
    starIds,
  });
  if (!result.ok) throw new Error(result.error.message);
}

describe('WorkCard', () => {
  it('R4.2-R4.4 R4.12 shows complete styled information and starts a constellation with the selected work', async () => {
    const store = createHarness();
    const starId = addWork(store, 'Interstellar', {
      review: '우주와 가족에 관한 영화',
      director: 'Christopher Nolan',
      rating: 5,
    });
    selectWork(store, starId);
    const user = userEvent.setup();

    render(<WorkCard store={store} />);

    const card = screen.getByRole('complementary', { name: 'Interstellar' });
    expect(card).toHaveClass('work-card');
    expect(card).toHaveStyle({ '--work-glow-color': '#fff8e0' });
    expect(screen.getByText('SF')).toBeInTheDocument();
    expect(screen.getByLabelText('별점 5점')).toHaveTextContent('★★★★★');
    expect(screen.getByText('우주와 가족에 관한 영화')).toBeInTheDocument();
    expect(screen.getByText('2025-04-01')).toBeInTheDocument();
    expect(screen.getByText('Christopher Nolan')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '별자리에 묶기' }));
    expect(store.getState().runtime.constellationDraft).toMatchObject({
      active: true,
      phase: 'selecting',
      starIds: [starId],
    });
  });

  it('R4.3 R4.13 closes without data changes by close button, outside pointer, or Escape', () => {
    const store = createHarness();
    const starId = addWork(store, 'Arrival');
    const persistedBefore = structuredClone(store.getState().persisted);
    selectWork(store, starId);

    render(<WorkCard store={store} />);
    fireEvent.click(screen.getByRole('button', { name: '작품 카드 닫기' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(store.getState().persisted).toEqual(persistedBefore);

    act(() => selectWork(store, starId));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(store.getState().persisted).toEqual(persistedBefore);

    act(() => selectWork(store, starId));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(store.getState().persisted).toEqual(persistedBefore);
  });

  it('R4.5 R4.7 R4.13 traps dialog focus, cancels with Escape, and restores trigger focus', async () => {
    const store = createHarness();
    const starId = addWork(store, 'Contact');
    selectWork(store, starId);
    const persistedBefore = structuredClone(store.getState().persisted);
    const user = userEvent.setup();

    render(<WorkCard store={store} />);
    const deleteTrigger = screen.getByRole('button', { name: '작품 영구 삭제' });
    await user.click(deleteTrigger);

    const dialog = screen.getByRole('dialog', { name: '영구 삭제 확인' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = screen.getByRole('button', { name: '취소' });
    const confirm = screen.getByRole('button', { name: '영구 삭제 실행' });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '영구 삭제 확인' })).not.toBeInTheDocument();
    expect(deleteTrigger).toHaveFocus();
    expect(store.getState().persisted).toEqual(persistedBefore);
  });

  it('R4.5-R4.11 R12.13 lists every hard-delete impact, cancels safely, then permanently removes the work', async () => {
    const store = createHarness();
    const targetId = addWork(store, 'Target');
    const firstId = addWork(store, 'First');
    const secondId = addWork(store, 'Second');
    addConstellation(store, '첫 번째 별자리', [targetId, firstId]);
    addConstellation(store, '두 번째 별자리', [secondId, targetId]);
    selectWork(store, targetId);
    const user = userEvent.setup();

    render(<WorkCard store={store} />);
    await user.click(screen.getByRole('button', { name: '작품 영구 삭제' }));

    expect(screen.getByRole('dialog', { name: '영구 삭제 확인' })).toBeInTheDocument();
    expect(screen.getByText('첫 번째 별자리')).toBeInTheDocument();
    expect(screen.getByText('두 번째 별자리')).toBeInTheDocument();
    const beforeCancel = structuredClone(store.getState().persisted);

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.getState().persisted).toEqual(beforeCancel);

    await user.click(screen.getByRole('button', { name: '작품 영구 삭제' }));
    await user.click(screen.getByRole('button', { name: '영구 삭제 실행' }));

    const state = store.getState();
    expect(state.persisted.stars.some(({ id }) => id === targetId)).toBe(false);
    expect(state.persisted.blackholeArchive.some(({ id }) => id === targetId)).toBe(false);
    expect(state.persisted.constellations.every(({ starIds }) => !starIds.includes(targetId))).toBe(true);
    expect(state.runtime.selectedStarId).toBeNull();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('R12.9 lists every soft-delete impact and cancellation preserves all collections', async () => {
    const store = createHarness();
    const targetId = addWork(store, 'Moon');
    const companionId = addWork(store, 'Mars');
    addConstellation(store, '행성 여행', [targetId, companionId]);
    selectWork(store, targetId);
    const user = userEvent.setup();

    render(<WorkCard store={store} />);
    await user.click(screen.getByRole('button', { name: '블랙홀로 이동' }));
    expect(screen.getByRole('dialog', { name: '블랙홀 이동 확인' })).toBeInTheDocument();
    expect(screen.getByText('행성 여행')).toBeInTheDocument();
    const beforeCancel = structuredClone(store.getState().persisted);

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(store.getState().persisted).toEqual(beforeCancel);

    await user.click(screen.getByRole('button', { name: '블랙홀로 이동' }));
    await user.click(screen.getByRole('button', { name: '블랙홀 이동 실행' }));
    expect(store.getState().persisted.stars.some(({ id }) => id === targetId)).toBe(false);
    expect(store.getState().persisted.blackholeArchive.some(({ id }) => id === targetId)).toBe(true);
  });
});

describe('BlackholeArchive and DOM navigation', () => {
  it('R12.6-R12.8 shows an empty state, complete archive details, and restores through a DOM button', async () => {
    const emptyStore = createHarness();
    const { unmount } = render(<BlackholeArchive store={emptyStore} />);
    expect(screen.getByText('보관된 작품이 없습니다')).toBeInTheDocument();
    unmount();

    const store = createHarness();
    const starId = addWork(store, 'Dune', {
      review: '거대한 사막의 시작',
      director: 'Denis Villeneuve',
    });
    expect(store.getState().commands.softDelete(starId).ok).toBe(true);
    const user = userEvent.setup();
    render(<BlackholeArchive store={store} />);

    expect(screen.getByRole('heading', { name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByText('거대한 사막의 시작')).toBeInTheDocument();
    expect(screen.getByText('Denis Villeneuve')).toBeInTheDocument();
    expect(screen.getByText(NOW)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dune 복원' }));
    expect(store.getState().persisted.stars.some(({ id }) => id === starId)).toBe(true);
    expect(store.getState().persisted.blackholeArchive).toEqual([]);
    expect(screen.getByText('보관된 작품이 없습니다')).toBeInTheDocument();
  });

  it('R10.8 R12.13 provides DOM selection/deletion and disables invalid constellation focus with the required reason', async () => {
    const store = createHarness();
    const firstId = addWork(store, 'Solaris');
    const secondId = addWork(store, 'Gravity');
    addConstellation(store, '우주 고전', [firstId, secondId]);
    expect(store.getState().commands.softDelete(secondId).ok).toBe(true);
    const user = userEvent.setup();

    render(
      <>
        <ArchiveDomNavigation store={store} />
        <WorkCard store={store} />
      </>,
    );

    const constellationButton = screen.getByRole('button', {
      name: '우주 고전 (1개 작품)',
    });
    expect(constellationButton).toBeDisabled();
    expect(constellationButton).toHaveAccessibleDescription('활성 작품이 2개 이상 필요합니다');

    await user.click(screen.getByRole('button', { name: 'Solaris 상세 및 관리' }));
    expect(screen.getByRole('complementary', { name: 'Solaris' })).toBeInTheDocument();
    expect(store.getState().runtime.pendingCameraRequest).toEqual({
      type: 'star',
      starId: firstId,
    });
  });
});
