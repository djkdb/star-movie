import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter, IncrementingUuidProvider } from '../test/providers';
import { createArchiveStore } from '../store/archiveStore';
import { AddWorkForm } from './AddWorkForm';
import { ToastRegion } from './ToastRegion';

const NOW = '2025-04-05T06:07:08.000Z';

const existingWork = {
  title: 'Interstellar',
  genre: 'SF',
  rating: 5,
  review: 'Space',
  watchedDate: '2025-04-01',
  director: 'Christopher Nolan',
} as const;

function createHarness(failWrites = false) {
  const storage = new FakeLocalStorageAdapter({ failWrites });
  const uuid = new IncrementingUuidProvider();
  const persistence = new PersistenceService({
    storage,
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
  return { storage, store };
}

async function fillValidCustomWork() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('제목'), '  Arrival  ');
  await user.selectOptions(screen.getByLabelText('장르'), 'SF');
  await user.click(screen.getByRole('radio', { name: '4점' }));
  await user.type(screen.getByLabelText('감상평'), '언어와 시간에 관한 영화');
  await user.type(screen.getByLabelText('감상일'), '2025-04-02');
  await user.type(screen.getByLabelText('직접 입력 감독'), '  Denis Villeneuve  ');
  return user;
}

describe('AddWorkForm', () => {
  it('R2.1 R2.7 renders every field and supports existing or custom directors', async () => {
    const { store } = createHarness();
    expect(store.getState().commands.addWork(existingWork).ok).toBe(true);
    const user = userEvent.setup();

    render(<AddWorkForm store={store} />);

    expect(screen.getByLabelText('제목')).toBeInTheDocument();
    expect(screen.getByLabelText('장르')).toBeInTheDocument();
    expect(screen.getByLabelText('별점')).toBeInTheDocument();
    expect(screen.getByLabelText('감상평')).toBeInTheDocument();
    expect(screen.getByLabelText('감상일')).toBeInTheDocument();
    expect(screen.getByLabelText('직접 입력 감독')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('감독 입력 방식'), 'existing');

    expect(screen.getByLabelText('기존 감독')).toHaveValue('Christopher Nolan');
    expect(screen.queryByLabelText('직접 입력 감독')).not.toBeInTheDocument();
  });

  it('R2.2-R2.8 R2.13-R2.14 displays every field error and focuses the first invalid field', async () => {
    const { store } = createHarness();
    const user = userEvent.setup();
    render(<AddWorkForm store={store} />);

    await user.type(screen.getByLabelText('제목'), '   ');
    fireEvent.change(screen.getByLabelText('감상평'), { target: { value: 'a'.repeat(101) } });
    await user.type(screen.getByLabelText('직접 입력 감독'), '   ');
    await user.click(screen.getByRole('button', { name: '별로 등록하기' }));

    expect(screen.getByLabelText('제목')).toHaveFocus();
    expect(screen.getByLabelText('제목')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('제목')).toHaveAccessibleDescription(
      '제목은 앞뒤 공백을 제외하고 1자 이상 200자 이하로 입력해 주세요.',
    );
    expect(screen.getByLabelText('장르')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('별점')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('감상평')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('감상일')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('직접 입력 감독')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('제목')).toHaveValue('   ');
    expect(screen.getByLabelText('감상평')).toHaveValue('a'.repeat(101));
    expect(screen.getByLabelText('직접 입력 감독')).toHaveValue('   ');
    expect(store.getState().persisted.stars).toEqual([]);
  });

  it('R2.12 resets raw draft values only after persistence succeeds', async () => {
    const { store } = createHarness();
    render(<AddWorkForm store={store} />);
    const user = await fillValidCustomWork();

    await user.click(screen.getByRole('button', { name: '별로 등록하기' }));

    expect(store.getState().persisted.stars).toHaveLength(1);
    expect(store.getState().persisted.stars[0]).toMatchObject({
      title: 'Arrival',
      normalizedTitle: 'arrival',
      genre: 'SF',
      rating: 4,
      review: '언어와 시간에 관한 영화',
      watchedDate: '2025-04-02',
      director: 'Denis Villeneuve',
      normalizedDirector: 'denis villeneuve',
    });
    expect(screen.getByLabelText('제목')).toHaveValue('');
    expect(screen.getByLabelText('장르')).toHaveValue('');
    expect(screen.getByRole('radio', { name: '4점' })).not.toBeChecked();
    expect(screen.getByLabelText('감상평')).toHaveValue('');
    expect(screen.getByLabelText('감상일')).toHaveValue('');
    expect(screen.getByLabelText('직접 입력 감독')).toHaveValue('');
  });

  it('R2.15 R2.19 R8.15 preserves raw input and Store state and announces each save failure', async () => {
    const { store } = createHarness(true);
    const persistedReference = store.getState().persisted;
    const before = structuredClone(persistedReference);
    render(
      <>
        <AddWorkForm store={store} />
        <ToastRegion store={store} />
      </>,
    );
    const user = await fillValidCustomWork();

    await user.click(screen.getByRole('button', { name: '별로 등록하기' }));

    expect(store.getState().persisted).toBe(persistedReference);
    expect(store.getState().persisted).toEqual(before);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(screen.getByLabelText('제목')).toHaveValue('  Arrival  ');
    expect(screen.getByLabelText('장르')).toHaveValue('SF');
    expect(screen.getByRole('radio', { name: '4점' })).toBeChecked();
    expect(screen.getByLabelText('감상평')).toHaveValue('언어와 시간에 관한 영화');
    expect(screen.getByLabelText('감상일')).toHaveValue('2025-04-02');
    expect(screen.getByLabelText('직접 입력 감독')).toHaveValue('  Denis Villeneuve  ');
    const liveRegion = screen.getByRole('region', { name: '저장 알림' });
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-relevant', 'additions');
    expect(screen.getByText('저장 실패')).toBeInTheDocument();
    expect(screen.getByText('저장 공간에 쓰지 못했습니다.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '별로 등록하기' }));
    expect(screen.getAllByText('저장 실패')).toHaveLength(2);
  });
});
