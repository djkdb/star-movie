import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from 'zustand';

import { bootstrapApplication } from '../bootstrap';
import { HUD } from '../components/HUD';
import { ListView } from '../components/ListView';
import { ToastRegion } from '../components/ToastRegion';
import { createDefaultPersistedStore, createDefaultStore } from '../domain/defaultState';
import type { ArchivedStar, PersistedStateV2, Star } from '../domain/models';
import {
  bootstrapPersistedState,
  getBootstrappedPersistedState,
  getBootstrappedPersistenceService,
} from '../persistence/bootstrapPersistedState';
import { decodePersistedV2, encodePersistedV2 } from '../persistence/persistedStateCodec';
import {
  AUTOSAVE_DEBOUNCE_MS,
  PERSISTENCE_STORAGE_KEY,
  PersistenceService,
} from '../persistence/persistenceService';
import { createSpaceSceneViewModel } from '../scene/SpaceCanvas';
import {
  createArchiveStoreFromLoadResult,
  type ArchiveStoreApi,
} from '../store/archiveStore';
import {
  FakeClock,
  FakeLocalStorageAdapter,
  SequenceUuidProvider,
} from '../test/providers';

const NOW = '2025-07-08T09:10:11.000Z';
const FIRST_STAR_ID = '71000000-0000-4000-8000-000000000001';
const SECOND_STAR_ID = '71000000-0000-4000-8000-000000000002';
const MANUAL_CONSTELLATION_ID = '71000000-0000-4000-8000-000000000003';
const AUTO_CONSTELLATION_ID = '71000000-0000-4000-8000-000000000004';
const ARCHIVED_STAR_ID = '71000000-0000-4000-8000-000000000005';

const firstInput = {
  title: 'Interstellar',
  genre: 'SF',
  rating: 5,
  review: '우주를 건너는 가족 이야기',
  watchedDate: '2025-07-01',
  director: 'Christopher Nolan',
} as const;

const secondInput = {
  title: 'Arrival',
  genre: 'SF',
  rating: 4,
  review: '언어와 시간',
  watchedDate: '2025-07-02',
  director: 'Denis Villeneuve',
} as const;

class InspectableStorage extends FakeLocalStorageAdapter {
  writeAttempts = 0;
  successfulWrites = 0;

  override setItem(key: string, value: string): void {
    this.writeAttempts += 1;
    super.setItem(key, value);
    this.successfulWrites += 1;
  }
}

function createStar(id: string, title: string, createdAt = NOW): Star {
  return {
    id,
    title,
    normalizedTitle: title.toLocaleLowerCase('und'),
    genre: 'SF',
    rating: 4,
    review: `${title} review`,
    watchedDate: '2025-07-01',
    director: 'Director',
    normalizedDirector: 'director',
    position: { x: -45, y: 0, z: -45 },
    createdAt,
  };
}

function storedDocument(storage: FakeLocalStorageAdapter): PersistedStateV2 {
  const raw = storage.getItem(PERSISTENCE_STORAGE_KEY);
  if (raw === null) throw new Error('Expected a persisted document');
  return decodePersistedV2(raw);
}

function createHarness(options: {
  initial?: PersistedStateV2;
  generatedIds?: readonly string[];
} = {}) {
  const clock = new FakeClock();
  const storage = new InspectableStorage({
    initial: options.initial === undefined
      ? undefined
      : { [PERSISTENCE_STORAGE_KEY]: encodePersistedV2(options.initial) },
  });
  const persistence = new PersistenceService({
    storage,
    scheduler: clock,
    nowIso: () => NOW,
  });
  const loaded = persistence.load();
  const ids = new SequenceUuidProvider(options.generatedIds ?? [
    FIRST_STAR_ID,
    SECOND_STAR_ID,
    MANUAL_CONSTELLATION_ID,
    AUTO_CONSTELLATION_ID,
  ]);
  const store = createArchiveStoreFromLoadResult(loaded, persistence, {
    nextUuid: () => ids.next(),
    nowIso: () => NOW,
  });
  return { clock, storage, persistence, store };
}

function SceneArchiveProjection({ store }: { store: ArchiveStoreApi }) {
  const persisted = useStore(store, (state) => state.persisted);
  const hasPersistedRegistration = useStore(
    store,
    (state) => state.runtime.hasPersistedRegistration,
  );
  const viewModel = useMemo(
    () => createSpaceSceneViewModel(persisted, hasPersistedRegistration),
    [hasPersistedRegistration, persisted],
  );

  return (
    <output data-testid="scene-archive-content">
      {viewModel.archiveContent.stars.map(({ title }) => title).join('|') || 'empty'}
    </output>
  );
}

function activeWorkSection(): HTMLElement {
  const section = screen.getByRole('heading', { name: /활성 작품 \(\d+\)/ }).closest('section');
  if (section === null) throw new Error('Active work section was not rendered');
  return section;
}

function assertStoreMatchesStorage(store: ArchiveStoreApi, storage: FakeLocalStorageAdapter): void {
  expect(storedDocument(storage)).toEqual(store.getState().persisted);
}

afterEach(() => {
  document.querySelectorAll('[data-bootstrap-test-root]').forEach((node) => node.remove());
});

describe('Zustand and persistence atomic integration', () => {
  it('R1.9-R1.10 R8.10 loads before the first React render and applies the first-run Scene gate', async () => {
    const persisted = createDefaultPersistedStore();
    persisted.stars.push(createStar(FIRST_STAR_ID, 'Persisted Work'));
    const storage = new InspectableStorage({
      initial: { [PERSISTENCE_STORAGE_KEY]: encodePersistedV2(persisted) },
    });
    const persistence = new PersistenceService({ storage, scheduler: new FakeClock() });
    const order: string[] = [];
    let releaseBootstrap!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const rootElement = document.createElement('div');
    rootElement.dataset.bootstrapTestRoot = 'true';
    document.body.append(rootElement);

    function FirstRender() {
      order.push('render');
      const loaded = getBootstrappedPersistedState();
      return <span>{loaded?.state.stars[0]?.title ?? 'missing'}</span>;
    }

    const bootstrapping = bootstrapApplication({
      rootElement,
      application: <FirstRender />,
      bootstrapPersistedState: async () => {
        order.push('bootstrap-start');
        await gate;
        order.push('storage-read');
        return bootstrapPersistedState(persistence);
      },
    });

    await Promise.resolve();
    expect(rootElement).toBeEmptyDOMElement();
    expect(order).toEqual(['bootstrap-start']);

    releaseBootstrap();
    await bootstrapping;
    await waitFor(() => expect(rootElement).toHaveTextContent('Persisted Work'));
    expect(order.indexOf('storage-read')).toBeLessThan(order.indexOf('render'));
    expect(getBootstrappedPersistenceService()).toBe(persistence);

    const loaded = getBootstrappedPersistedState();
    if (loaded === null) throw new Error('Bootstrap result was not retained');
    const restoredStore = createArchiveStoreFromLoadResult(loaded, persistence);
    expect(createSpaceSceneViewModel(
      restoredStore.getState().persisted,
      restoredStore.getState().runtime.hasPersistedRegistration,
    ).archiveContent.stars.map(({ id }) => id)).toEqual([FIRST_STAR_ID]);

    const firstRunPersistence = new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
    });
    const firstRunStore = createArchiveStoreFromLoadResult(
      firstRunPersistence.load(),
      firstRunPersistence,
    );
    firstRunStore.setState((state) => ({
      persisted: { ...state.persisted, stars: [createStar(FIRST_STAR_ID, 'Memory Fixture')] },
    }));
    const firstRunScene = createSpaceSceneViewModel(
      firstRunStore.getState().persisted,
      firstRunStore.getState().runtime.hasPersistedRegistration,
    );
    expect(firstRunScene.archiveContent).toEqual({
      stars: [],
      constellations: [],
      archivedWorks: [],
    });
    expect(firstRunScene.galaxies).toHaveLength(8);

    restoredStore.dispose();
    firstRunStore.dispose();
  });

  it('R2.15 R4.14 R5.5 R9.14-R9.18 R12.2-R12.14 keeps Store, localStorage, HUD, List, and Scene projection synchronized through real commands', () => {
    const { storage, store } = createHarness();
    render(
      <>
        <HUD store={store} />
        <ListView store={store} />
        <SceneArchiveProjection store={store} />
      </>,
    );

    expect(screen.getByText('0', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('empty');

    let firstId = '';
    act(() => {
      const result = store.getState().commands.addWork(firstInput);
      if (!result.ok) throw new Error(result.error.message);
      firstId = result.value.starId;
    });
    expect(firstId).toBe(FIRST_STAR_ID);
    expect(screen.getByText('1', { selector: 'dd' })).toBeInTheDocument();
    expect(within(activeWorkSection()).getByText('Interstellar')).toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('Interstellar');
    assertStoreMatchesStorage(store, storage);

    let secondId = '';
    act(() => {
      const result = store.getState().commands.addWork(secondInput);
      if (!result.ok) throw new Error(result.error.message);
      secondId = result.value.starId;
    });
    expect(secondId).toBe(SECOND_STAR_ID);
    expect(screen.getByText('2', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('Interstellar|Arrival');
    assertStoreMatchesStorage(store, storage);

    act(() => {
      const commands = store.getState().commands;
      commands.startConstellationDraft(secondId);
      commands.selectConstellationStar(firstId);
      commands.finishConstellationDraft();
      const result = commands.createConstellation('  시간의 항해자  ');
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(store.getState().persisted.constellations[0]).toMatchObject({
      id: MANUAL_CONSTELLATION_ID,
      name: '시간의 항해자',
      starIds: [SECOND_STAR_ID, FIRST_STAR_ID],
    });
    expect(screen.getByRole('button', { name: '시간의 항해자 (2)' })).toBeInTheDocument();
    assertStoreMatchesStorage(store, storage);

    act(() => {
      const result = store.getState().commands.softDelete(firstId);
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(screen.getByText('1', { selector: 'dd' })).toBeInTheDocument();
    expect(within(activeWorkSection()).queryByText('Interstellar')).not.toBeInTheDocument();
    expect(screen.getByText('Interstellar', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('Arrival');
    expect(screen.queryByRole('button', { name: '시간의 항해자 (2)' })).not.toBeInTheDocument();
    expect(store.getState().persisted.blackholeArchive.map(({ id }) => id)).toEqual([firstId]);
    assertStoreMatchesStorage(store, storage);

    act(() => {
      const result = store.getState().commands.restoreArchived(firstId);
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(screen.getByText('2', { selector: 'dd' })).toBeInTheDocument();
    expect(within(activeWorkSection()).getByText('Interstellar')).toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('Arrival|Interstellar');
    expect(store.getState().persisted.constellations[0]?.starIds).toEqual([SECOND_STAR_ID]);
    assertStoreMatchesStorage(store, storage);

    act(() => {
      const first = store.getState().commands.createGenreConstellations('genre-operation-1');
      const duplicate = store.getState().commands.createGenreConstellations('genre-operation-1');
      if (!first.ok || !duplicate.ok) throw new Error('Automatic constellation failed');
      expect(duplicate.completionEvents).toEqual([]);
      expect(duplicate.value.constellationIds).toEqual(first.value.constellationIds);
    });
    expect(store.getState().persisted.constellations[1]).toMatchObject({
      id: AUTO_CONSTELLATION_ID,
      name: 'SF 별자리',
      starIds: [FIRST_STAR_ID, SECOND_STAR_ID],
    });
    expect(screen.getByRole('button', { name: 'SF 별자리 (2)' })).toBeInTheDocument();
    assertStoreMatchesStorage(store, storage);

    act(() => {
      const result = store.getState().commands.hardDelete(secondId);
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(screen.getByText('1', { selector: 'dd' })).toBeInTheDocument();
    expect(within(activeWorkSection()).queryByText('Arrival')).not.toBeInTheDocument();
    expect(screen.getByTestId('scene-archive-content')).toHaveTextContent('Interstellar');
    expect(store.getState().persisted.stars.map(({ id }) => id)).toEqual([FIRST_STAR_ID]);
    expect(store.getState().persisted.blackholeArchive).toEqual([]);
    expect(store.getState().persisted.constellations.map(({ starIds }) => starIds)).toEqual([
      [],
      [FIRST_STAR_ID],
    ]);
    expect(storage.successfulWrites).toBe(7);
    assertStoreMatchesStorage(store, storage);

    store.dispose();
  });

  it('R8.1 R8.14-R8.18 emits one toast per failed user command and keeps autosave failures silent in Store diagnostics', () => {
    const initial = createDefaultStore(true).persisted;
    const first = createStar(FIRST_STAR_ID, 'First');
    const second = createStar(SECOND_STAR_ID, 'Second', '2025-07-08T09:10:12.000Z');
    const archived: ArchivedStar = {
      ...createStar(ARCHIVED_STAR_ID, 'Archived'),
      discardedAt: NOW,
    };
    initial.stars = [first, second];
    initial.blackholeArchive = [archived];
    initial.constellations = [{
      id: MANUAL_CONSTELLATION_ID,
      name: 'Existing',
      starIds: [FIRST_STAR_ID, SECOND_STAR_ID],
      color: '#60A5FA',
      createdAt: NOW,
    }];
    const { clock, storage, store } = createHarness({
      initial,
      generatedIds: [
        '72000000-0000-4000-8000-000000000001',
        '72000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000003',
      ],
    });
    const snapshot = structuredClone(store.getState().persisted);
    render(<ToastRegion store={store} />);
    storage.failWrites = true;

    act(() => {
      const commands = store.getState().commands;
      const results = [
        commands.addWork(firstInput),
        commands.hardDelete(FIRST_STAR_ID),
        commands.softDelete(FIRST_STAR_ID),
        commands.restoreArchived(ARCHIVED_STAR_ID),
        commands.createConstellation({
          name: 'Failed manual',
          starIds: [FIRST_STAR_ID, SECOND_STAR_ID],
        }),
        commands.createGenreConstellations('failed-auto-operation'),
      ];
      expect(results.every((result) => !result.ok && result.error.code === 'STORAGE_WRITE')).toBe(true);
    });

    expect(store.getState().persisted).toEqual(snapshot);
    expect(store.getState().runtime.completionEvents).toEqual([]);
    expect(store.getState().runtime.toastEvents).toHaveLength(6);
    expect(screen.getAllByText('저장 실패')).toHaveLength(6);
    expect(storage.writeAttempts).toBe(6);

    storage.failWrites = false;
    act(() => {
      store.setState((state) => ({
        persisted: {
          ...state.persisted,
          stars: state.persisted.stars.map((star) => (
            star.id === FIRST_STAR_ID ? { ...star, review: 'autosave latest review' } : star
          )),
        },
      }));
      store.getState().commands.scheduleAutosave();
      clock.advanceBy(AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(storage.successfulWrites).toBe(0);

    act(() => clock.advanceBy(1));
    expect(storage.successfulWrites).toBe(1);
    expect(storedDocument(storage).stars[0]?.review).toBe('autosave latest review');

    act(() => {
      for (const event of store.getState().runtime.toastEvents) {
        store.getState().commands.consumeToastEvent(event.id);
      }
    });
    storage.failWrites = true;
    const beforeAutosaveFailure = structuredClone(store.getState().persisted);
    act(() => {
      store.getState().commands.scheduleAutosave();
      clock.advanceBy(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(store.getState().persisted).toEqual(beforeAutosaveFailure);
    expect(store.getState().runtime.toastEvents).toEqual([]);
    expect(screen.queryByText('저장 실패')).not.toBeInTheDocument();
    expect(store.getState().runtime.storageDiagnostics).toEqual({
      lastAutosaveError: 'STORAGE_WRITE: Injected localStorage write failure',
      lastAutosaveErrorAt: NOW,
    });

    store.dispose();
  });
});
