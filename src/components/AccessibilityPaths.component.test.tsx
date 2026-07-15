import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { SceneErrorBoundary } from '../scene/SceneErrorBoundary';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter, IncrementingUuidProvider } from '../test/providers';
import { AchievementPanel } from './AchievementPanel';
import { ArchiveDomNavigation } from './ArchiveDomNavigation';
import { ConstellationControls } from './ConstellationControls';
import { HUD } from './HUD';

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

function addWork(store: ArchiveStoreApi, title: string): string {
  const result = store.getState().commands.addWork({
    title,
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate: '2025-05-01',
    director: 'Director',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.starId;
}

afterEach(() => vi.restoreAllMocks());

describe('complete accessible interaction paths', () => {
  it('R5.10 R14.1 traps achievement focus, closes with Escape, and restores the invoking control', async () => {
    const store = createHarness();
    const user = userEvent.setup();
    render(<><HUD store={store} /><AchievementPanel store={store} /></>);

    const trigger = screen.getByRole('button', { name: '업적 0/1' });
    await user.click(trigger);
    const close = screen.getByRole('button', { name: '업적 패널 닫기' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '업적' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('R7.9 R10.8 provides a keyboard-only DOM path for ordered constellation selection', async () => {
    const store = createHarness();
    const firstId = addWork(store, 'First');
    const secondId = addWork(store, 'Second');
    const user = userEvent.setup();
    render(<><ConstellationControls store={store} /><ArchiveDomNavigation store={store} /></>);

    await user.click(screen.getByRole('button', { name: '수동으로 만들기' }));
    await user.click(screen.getByRole('button', { name: 'First 별자리 노드로 선택' }));
    expect(screen.getByRole('button', { name: 'First 별자리 노드로 선택됨' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Second 별자리 노드로 선택' }));

    expect(store.getState().runtime.constellationDraft.starIds).toEqual([firstId, secondId]);
    await user.click(screen.getByRole('button', { name: '선택 완료' }));
    expect(screen.getByRole('dialog', { name: '별자리 이름 정하기' })).toBeInTheDocument();
    expect(screen.getByLabelText('이름 (최대 30자)')).toHaveFocus();
  });

  it('R4.2 R6.9 exposes genre text/icon and rating text/icon without relying on color', () => {
    const store = createHarness();
    addWork(store, 'Accessible Star');
    render(<ArchiveDomNavigation store={store} />);

    const genre = screen.getByLabelText('장르 SF');
    const rating = screen.getByLabelText('별점 4점');
    expect(genre).toHaveTextContent('◉');
    expect(genre).toHaveTextContent('SF');
    expect(rating).toHaveTextContent('★★★★☆');
    expect(rating).toHaveTextContent('4/5');
  });

  it('R12.6 R14.1 isolates a Canvas failure and keeps the DOM navigation route available', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function BrokenScene(): never {
      throw new Error('WebGL unavailable');
    }

    render(
      <>
        <SceneErrorBoundary navigationTargetId="archive-dom-navigation">
          <BrokenScene />
        </SceneErrorBoundary>
        <section id="archive-dom-navigation">DOM archive remains available</section>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('3D 우주를 표시할 수 없습니다');
    expect(screen.getByRole('link', { name: 'DOM 작품 탐색으로 이동' }))
      .toHaveAttribute('href', '#archive-dom-navigation');
    expect(screen.getByText('DOM archive remains available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3D 우주 다시 시도' })).toBeInTheDocument();
  });
});
