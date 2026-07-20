import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { ArchivedStar, Star } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { createArchiveStore } from '../store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { AchievementPanel } from './AchievementPanel';
import { GenreFilter } from './GenreFilter';
import { HUD } from './HUD';
import { ListView } from './ListView';
import { ToastRegion } from './ToastRegion';

function createStar(index: number, overrides: Partial<Star> = {}): Star {
  const title = overrides.title ?? `Work ${index}`;
  const director = overrides.director ?? 'Director';
  return {
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    title,
    normalizedTitle: title.trim().toLocaleLowerCase('und'),
    genre: overrides.genre ?? 'SF',
    rating: overrides.rating ?? 3,
    review: overrides.review ?? '',
    watchedDate: '2025-01-01',
    director,
    normalizedDirector: director.trim().toLocaleLowerCase('und'),
    position: { x: index, y: 0, z: 0 },
    createdAt: overrides.createdAt ?? `2025-01-0${index}T00:00:00.000Z`,
    ...overrides,
  };
}

function createHarness() {
  const initialState = createDefaultStore(true);
  const sf = createStar(1, { title: 'SF Low', genre: 'SF', rating: 2 });
  const drama = createStar(2, { title: 'Drama High', genre: '드라마', rating: 5 });
  const archived: ArchivedStar = {
    ...createStar(9, { title: 'Archived Work', review: '기억할 장면', director: 'Archive Director' }),
    discardedAt: '2025-02-01T00:00:00.000Z',
  };
  initialState.persisted.stars = [sf, drama];
  initialState.persisted.constellations = [{
    id: '00000000-0000-4000-8000-000000000100',
    name: '둘의 별자리',
    starIds: [sf.id, drama.id],
    color: '#ffffff',
    createdAt: '2025-01-03T00:00:00.000Z',
  }];
  initialState.persisted.blackholeArchive = [archived];
  const persistence = new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
  });
  return {
    sf,
    drama,
    store: createArchiveStore({ persistence, initialState }),
  };
}

describe('HUD, AchievementPanel, GenreFilter and ListView', () => {
  it('R5.1-R5.10 R17.13 reflects selector changes and reopens achievements without notifications', async () => {
    const { store } = createHarness();
    const user = userEvent.setup();
    render(<><HUD store={store} /><AchievementPanel store={store} /></>);

    expect(screen.getByText('2', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByText('SF')).toBeInTheDocument();
    expect(screen.getByText('드라마')).toBeInTheDocument();

    act(() => {
      store.setState((state) => ({
        persisted: { ...state.persisted, stars: [] },
      }));
    });
    expect(screen.getByText('0', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('없음')).toBeInTheDocument();

    const completionEventsBeforeNavigation = store.getState().runtime.completionEvents;
    const toastEventsBeforeNavigation = store.getState().runtime.toastEvents;
    await user.click(screen.getByRole('button', { name: '업적 0/6' }));
    expect(screen.getByRole('dialog', { name: '업적' })).toBeInTheDocument();
    const nolanItem = screen.getByText('놀란 마스터').closest('li')!;
    expect(within(nolanItem).getByText('0/10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '업적 패널 닫기' }));
    expect(screen.queryByRole('dialog', { name: '업적' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '업적 0/6' }));
    expect(screen.getByRole('dialog', { name: '업적' })).toBeInTheDocument();
    expect(store.getState().runtime.completionEvents).toBe(completionEventsBeforeNavigation);
    expect(store.getState().runtime.toastEvents).toBe(toastEventsBeforeNavigation);
  });

  it('R5.3 R16.12 renders the exactly-100 unlocked HUD boundary without new rewards or events', () => {
    const { store } = createHarness();
    const rewardId = '00000000-0000-4000-8000-000000000999';
    const stars = Array.from({ length: 100 }, (_, index) => createStar(index + 1, {
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    }));
    store.setState((state) => ({
      persisted: {
        ...state.persisted,
        stars,
        galaxies: [
          ...state.persisted.galaxies,
          {
            id: rewardId,
            kind: { type: 'reward', rewardType: 'milestone-100' },
            center: { x: 0, y: 45, z: 0 },
            placementRadius: 18,
            themeId: 'milestone-100-reward',
            primaryColor: '#8b5cf6',
            unlocked: true,
          },
        ],
        milestoneUnlocks: {
          fifty: {
            target: 50,
            unlocked: true,
            unlockedAt: '2025-01-01T00:00:00.000Z',
            rewardId: '00000000-0000-4000-8000-000000000998',
          },
          hundred: {
            target: 100,
            unlocked: true,
            unlockedAt: '2025-01-02T00:00:00.000Z',
            rewardId,
          },
        },
      },
    }));
    const eventsBeforeRender = store.getState().runtime.completionEvents;

    render(<HUD store={store} />);

    expect(screen.getByText('100', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('50편 해금')).toBeInTheDocument();
    expect(screen.getByText('100편 해금')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '50편 마일스톤' })).toHaveAttribute('value', '50');
    expect(screen.getByRole('progressbar', { name: '100편 마일스톤' })).toHaveAttribute('value', '100');
    expect(screen.getByText('50/50')).toBeInTheDocument();
    expect(screen.getByText('100/100')).toBeInTheDocument();
    expect(store.getState().persisted.galaxies.filter(({ kind }) => kind.type === 'reward')).toHaveLength(1);
    expect(store.getState().runtime.completionEvents).toBe(eventsBeforeRender);
  });

  it('R5.7-R5.10 R17.3-R17.4 updates progress and renders a dismissible first-unlock toast without consuming Scene events', async () => {
    const { store } = createHarness();
    const user = userEvent.setup();
    const unlockEvent = {
      id: 'achievement-unlocked:nolan-master:2025-06-01T00:00:00.000Z',
      type: 'achievement-unlocked',
      occurredAt: '2025-06-01T00:00:00.000Z',
      payload: {
        achievementId: 'nolan-master',
        name: '놀란 마스터',
        description: '크리스토퍼 놀란 감독의 고유 작품 10편을 기록하세요.',
      },
    } as const;
    act(() => {
      store.setState((state) => ({
        persisted: {
          ...state.persisted,
          stars: Array.from({ length: 10 }, (_, index) => createStar(index + 20, {
            title: `Nolan Work ${index + 1}`,
            director: 'Christopher Nolan',
            normalizedDirector: 'christopher nolan',
            createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
          })),
          achievements: state.persisted.achievements.map((achievement) =>
            achievement.id === 'nolan-master'
              ? {
                  ...achievement,
                  progress: 10,
                  unlocked: true,
                  unlockedAt: unlockEvent.occurredAt,
                }
              : achievement,
          ),
        },
        runtime: {
          ...state.runtime,
          completionEvents: [unlockEvent],
          toastEvents: [unlockEvent],
        },
      }));
    });

    render(<><HUD store={store} /><AchievementPanel store={store} /><ToastRegion store={store} /></>);

    expect(screen.getByRole('button', { name: '업적 1/6' })).toBeInTheDocument();
    expect(screen.getByText('업적 해금: 놀란 마스터')).toBeInTheDocument();
    expect(screen.getByText(unlockEvent.payload.description)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '업적 1/6' }));
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByText('해금')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByText('업적 해금: 놀란 마스터')).not.toBeInTheDocument();
    expect(store.getState().runtime.toastEvents).toEqual([]);
    expect(store.getState().runtime.completionEvents).toEqual([unlockEvent]);
  });

  it('R6.1 R6.8-R6.10 keeps a multi-select Set and exposes selected styles', async () => {
    const { store } = createHarness();
    const user = userEvent.setup();
    render(<GenreFilter store={store} />);

    const sfButton = screen.getByRole('button', { name: 'SF' });
    const dramaButton = screen.getByRole('button', { name: '드라마' });
    await user.click(sfButton);
    await user.click(dramaButton);

    expect(store.getState().runtime.selectedGenres).toEqual(new Set(['SF', '드라마']));
    expect(sfButton).toHaveAttribute('aria-pressed', 'true');
    expect(sfButton).toHaveClass('is-selected');
    expect(dramaButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(sfButton);
    expect(store.getState().runtime.selectedGenres).toEqual(new Set(['드라마']));
    expect(sfButton).toHaveAttribute('aria-pressed', 'false');
    expect(dramaButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('R7.1-R7.10 R10.6-R10.8 R12.7-R12.8 renders sections, filters immediately, and dispatches camera requests', async () => {
    const { drama, store } = createHarness();
    const user = userEvent.setup();
    render(<><GenreFilter store={store} /><ListView store={store} /></>);

    const drawer = document.getElementById('archive-list-drawer');
    const drawerToggle = screen.getByRole('button', { name: '목록 열기' });
    expect(drawer).toHaveAttribute('data-drawer-state', 'closed');
    await user.click(drawerToggle);
    expect(drawer).toHaveAttribute('data-drawer-state', 'open');

    const activeSection = screen.getByRole('heading', { name: '활성 작품 (2)' }).closest('section');
    expect(activeSection).not.toBeNull();
    const activeButtons = within(activeSection!).getAllByRole('button');
    expect(activeButtons[0]).toHaveTextContent('Drama High');
    expect(screen.getByText('Archived Work')).toBeInTheDocument();
    expect(screen.getByText('기억할 장면')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '드라마' }));
    expect(screen.getByRole('heading', { name: '활성 작품 (1)' })).toBeInTheDocument();
    expect(screen.queryByText('SF Low')).not.toBeInTheDocument();

    await user.click(within(screen.getByRole('heading', { name: '활성 작품 (1)' }).closest('section')!)
      .getByRole('button'));
    expect(store.getState().runtime.pendingCameraRequest).toEqual({
      type: 'star',
      starId: drama.id,
    });

    await user.click(screen.getByRole('button', { name: '둘의 별자리 (2)' }));
    expect(store.getState().runtime.pendingCameraRequest).toEqual({
      type: 'constellation',
      constellationId: '00000000-0000-4000-8000-000000000100',
    });

    await user.type(screen.getByLabelText('검색'), 'missing');
    expect(screen.getByText('조건에 맞는 작품이 없습니다')).toBeInTheDocument();

    act(() => {
      store.setState((state) => ({
        persisted: { ...state.persisted, blackholeArchive: [] },
      }));
    });
    expect(screen.getByText('보관된 작품이 없습니다')).toBeInTheDocument();
  });

  it('R7.9 supports drawer, search empty state, sorting, and work focus by keyboard', async () => {
    const { drama, store } = createHarness();
    const user = userEvent.setup();
    render(<ListView store={store} />);

    await user.tab();
    const drawerToggle = screen.getByRole('button', { name: '목록 열기' });
    expect(drawerToggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(drawerToggle).toHaveAccessibleName('목록 닫기');
    expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');

    await user.tab();
    const search = screen.getByRole('searchbox', { name: '검색' });
    expect(search).toHaveFocus();
    await user.type(search, 'missing');
    expect(screen.getByRole('status')).toHaveTextContent('조건에 맞는 작품이 없습니다');

    await user.clear(search);
    await user.tab();
    const sort = screen.getByRole('combobox', { name: '정렬' });
    expect(sort).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(sort).toHaveValue('latest');

    const activeSection = screen.getByRole('heading', { name: '활성 작품 (2)' }).closest('section');
    expect(activeSection).not.toBeNull();
    const firstWork = within(activeSection!).getAllByRole('button')[0];
    await user.tab();
    expect(firstWork).toHaveFocus();
    expect(firstWork).toHaveTextContent('Drama High');
    await user.keyboard('{Enter}');
    expect(store.getState().runtime.pendingCameraRequest).toEqual({
      type: 'star',
      starId: drama.id,
    });
  });
});
