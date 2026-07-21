import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  createDefaultStore,
  type SceneArchiveContent,
} from '../domain/defaultState';
import { GENRES, type WatchlistEntry, type WatchlistPrefill } from '../domain/models';
import { normalizeDisplayText, normalizeText } from '../domain/normalization';
import type {
  CameraPose,
  CameraRequest,
  Constellation,
  ConstellationDraft,
  Genre,
  PersistedStateV2,
  PlanetRarity,
  QualityLevel,
  RuntimeEvent,
  RuntimeStore,
  Star,
  Store,
} from '../domain/models';
import {
  availableTickets,
  pullPlanet as performPlanetPull,
} from '../domain/planetGacha';
import { degradeQualityLevel } from '../domain/qualityLevel';
import {
  validateWorkInput,
  type WorkInput,
} from '../domain/workInputValidation';
import { decodePersistedV2 } from '../persistence/persistedStateCodec';

/** Poster paths must look like TMDB CDN paths before they may persist. */
const POSTER_RE = /^\/[\w./-]+\.(jpg|jpeg|png|webp)$/i;
import type {
  LoadResult,
  PersistenceErrorCode,
  PersistenceService,
} from '../persistence/persistenceService';
import {
  buildGenreConstellationGroups,
  createActiveConstellationDraft,
  createInactiveConstellationDraft,
  requestConstellationName,
  selectConstellationDraftStar,
  selectDeterministicConstellationColor,
  validateConstellationCreation,
} from './constellation';
import { createDeterministicStarPosition } from './deterministicPlacement';
import {
  reconcileProgressAfterMutation,
  reconcileRestoredProgress,
} from './progressReconciler';
import {
  getAffectedConstellationNames,
  reduceHardDelete,
  reduceRestoreArchived,
  reduceSoftDelete,
} from './workCollectionReducers';

export type OperationSnapshot = PersistedStateV2;

export type DomainError =
  | {
      code: 'VALIDATION';
      message: string;
      fieldErrors: Record<string, string[]>;
    }
  | {
      code: 'INVARIANT' | 'SERIALIZATION' | PersistenceErrorCode;
      message: string;
      cause?: unknown;
    };

export type CommandResult<T = void> =
  | { ok: true; value: T; completionEvents: RuntimeEvent[] }
  | { ok: false; error: DomainError };

export interface ArchiveCommandProviders {
  nextUuid(): string;
  nowIso(): string;
  /** Uniform [0, 1) source for gacha rolls; injectable for deterministic tests. */
  nextRandom(): number;
}

export interface AddWorkValue {
  starId: string;
}

export interface DeleteWorkValue {
  starId: string;
  affectedConstellationNames: string[];
}

export interface RestoreWorkValue {
  starId: string;
}

export interface PullPlanetValue {
  planetId: string;
  speciesId: string;
  rarity: PlanetRarity;
  isNewSpecies: boolean;
}

export interface CreateConstellationInput {
  name: string;
  /** Defaults to the current runtime draft when omitted. */
  starIds?: readonly string[];
}

export interface CreateConstellationValue {
  constellationId: string;
}

export interface CreateGenreConstellationsValue {
  constellationIds: string[];
}

export interface ArchiveCommands {
  addWork(input: WorkInput): CommandResult<AddWorkValue>;
  getAffectedConstellationNames(starId: string): string[];
  hardDelete(starId: string): CommandResult<DeleteWorkValue>;
  softDelete(starId: string): CommandResult<DeleteWorkValue>;
  restoreArchived(starId: string): CommandResult<RestoreWorkValue>;
  /** Adds a want-to-watch work; it drifts in the sky as a hazy nebula. */
  addToWatchlist(input: {
    title: unknown;
    genre: unknown;
    posterPath?: string;
    tmdbId?: number;
  }): CommandResult<{ entryId: string }>;
  removeFromWatchlist(entryId: string): CommandResult<{ entryId: string }>;
  /** Hands a watchlist entry to the add-work form as a prefill. */
  beginWatchlistPromotion(entryId: string): void;
  clearWatchlistPrefill(): void;
  /** Notes another viewing of a work; each rewatch brightens its star. */
  markRewatched(starId: string): CommandResult<{ rewatchCount: number }>;
  pullPlanet(): CommandResult<PullPlanetValue>;
  toggleSelectedGenre(genre: Genre): void;
  setAchievementPanelOpen(isOpen: boolean): void;
  setPlanetCodexOpen(isOpen: boolean): void;
  setListDrawerOpen(isOpen: boolean): void;
  toggleListDrawer(): void;
  degradeQuality(): QualityLevel;
  requestCameraFocus(request: CameraRequest): CommandResult<CameraRequest>;
  /** Eases the camera back to the given home pose from anywhere. */
  requestCameraHome(pose: CameraPose): void;
  clearCameraRequest(request?: CameraRequest): void;
  capturePreFocusPose(pose: CameraPose): void;
  requestCameraReturn(): void;
  completeCameraReturn(): void;
  startConstellationDraft(initialStarId?: string): CommandResult<ConstellationDraft>;
  selectConstellationStar(starId: string): CommandResult<ConstellationDraft>;
  finishConstellationDraft(): CommandResult<ConstellationDraft>;
  cancelConstellationDraft(): CommandResult<ConstellationDraft>;
  createConstellation(
    input: CreateConstellationInput | string,
  ): CommandResult<CreateConstellationValue>;
  createGenreConstellations(
    operationId: string,
  ): CommandResult<CreateGenreConstellationsValue>;
  scheduleAutosave(): void;
  consumeCompletionEvent(eventId: string): void;
  consumeToastEvent(eventId: string): void;
  /** Pushes a soft, non-blocking note toast (memories, first-light moments). */
  pushGentleToast(title: string, message: string): void;
}

export interface ArchiveStoreState extends Store {
  commands: ArchiveCommands;
}

export type ArchiveStoreApi = StoreApi<ArchiveStoreState> & {
  dispose(): void;
};

interface AtomicMutation<T> {
  candidate: PersistedStateV2;
  value: T;
  completionEvents: RuntimeEvent[];
  applyRuntime?: (runtime: RuntimeStore) => RuntimeStore;
}

interface AtomicCommandOptions<T> {
  operation: string;
  derive(snapshot: Readonly<OperationSnapshot>): AtomicMutation<T>;
}

interface ArchiveStoreOptions {
  persistence: PersistenceService;
  initialState?: Store;
  providers?: Partial<ArchiveCommandProviders>;
}

const defaultProviders: ArchiveCommandProviders = {
  nextUuid: () => globalThis.crypto.randomUUID(),
  nowIso: () => new Date().toISOString(),
  nextRandom: () => Math.random(),
};

const COMPLETED_OPERATION_ID_LIMIT = 100;

function cloneRuntime(runtime: RuntimeStore): RuntimeStore {
  return {
    ...runtime,
    selectedGenres: new Set(runtime.selectedGenres),
    constellationDraft: {
      ...runtime.constellationDraft,
      starIds: [...runtime.constellationDraft.starIds],
    },
    completionEvents: [...runtime.completionEvents],
    toastEvents: [...runtime.toastEvents],
    storageDiagnostics: { ...runtime.storageDiagnostics },
    commandDiagnostics: { ...runtime.commandDiagnostics },
  };
}

function cloneStore(store: Store): Store {
  return {
    persisted: structuredClone(store.persisted),
    runtime: cloneRuntime(store.runtime),
  };
}

export function captureOperationSnapshot(state: ArchiveStoreState): OperationSnapshot {
  return structuredClone(state.persisted);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function validationFailure<T>(
  message: string,
  fieldErrors: Record<string, string[]>,
): CommandResult<T> {
  return { ok: false, error: { code: 'VALIDATION', message, fieldErrors } };
}

class AtomicCommandExecutor {
  private eventSequence = 0;

  constructor(
    private readonly store: StoreApi<ArchiveStoreState>,
    private readonly persistence: PersistenceService,
    private readonly nowIso: () => string,
  ) {}

  execute<T>(options: AtomicCommandOptions<T>): CommandResult<T> {
    const snapshot = captureOperationSnapshot(this.store.getState());
    let mutation: AtomicMutation<T>;

    try {
      mutation = options.derive(snapshot);
    } catch (cause) {
      return this.fail(
        options.operation,
        {
          code: 'INVARIANT',
          message: `작업 후보를 생성하지 못했습니다: ${errorMessage(cause)}`,
          cause,
        },
        'command-failed',
      );
    }

    let candidate: PersistedStateV2;
    try {
      candidate = decodePersistedV2(mutation.candidate);
    } catch (cause) {
      return this.fail(
        options.operation,
        {
          code: 'SERIALIZATION',
          message: '작업 후보가 저장 스키마 검증을 통과하지 못했습니다.',
          cause,
        },
        'command-failed',
      );
    }

    const saved = this.persistence.saveUserAction(candidate);
    if (!saved.ok) {
      return this.fail(
        options.operation,
        {
          code: saved.error.code,
          message: saved.error.message,
          cause: saved.error.cause,
        },
        'user-save-failed',
      );
    }

    this.store.setState((state) => {
      const unlockNotifications = mutation.completionEvents.filter(
        ({ type }) =>
          type === 'milestone-unlocked' || type === 'achievement-unlocked',
      );
      const committedRuntime: RuntimeStore = {
        ...state.runtime,
        hasPersistedRegistration: true,
        completionEvents: [
          ...state.runtime.completionEvents,
          ...mutation.completionEvents,
        ],
        // Keep notifications independent from completion effects: dismissing a
        // toast must not consume an event needed by the Scene particle manager.
        toastEvents: [...state.runtime.toastEvents, ...unlockNotifications],
      };
      return {
        persisted: candidate,
        runtime:
          mutation.applyRuntime?.(committedRuntime) ?? committedRuntime,
      };
    });

    return {
      ok: true,
      value: mutation.value,
      completionEvents: mutation.completionEvents,
    };
  }

  private fail<T>(
    operation: string,
    error: DomainError,
    eventType: 'command-failed' | 'user-save-failed',
  ): CommandResult<T> {
    const occurredAt = this.safeNowIso();
    const event: RuntimeEvent = {
      id: `${eventType}:${++this.eventSequence}`,
      type: eventType,
      occurredAt,
      payload: {
        operation,
        code: error.code,
        message: error.message,
      },
    };

    this.store.setState((state) => ({
      runtime: {
        ...state.runtime,
        toastEvents: [...state.runtime.toastEvents, event],
        commandDiagnostics: {
          operation,
          code: error.code,
          message: error.message,
          occurredAt,
        },
      },
    }));

    return { ok: false, error };
  }

  private safeNowIso(): string {
    try {
      const value = this.nowIso();
      return Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
}

function createWorkAddedEvent(
  star: Star,
  sequence: number,
  genreCount: number,
  genreCounts: Readonly<Record<string, number>>,
): RuntimeEvent {
  return {
    id: `work-added:${star.id}:${sequence}`,
    type: 'work-added',
    occurredAt: star.createdAt,
    payload: {
      starId: star.id,
      position: star.position,
      rating: star.rating,
      genre: star.genre,
      // Drives the grandeur (burst count) of the genre-colored fireworks.
      genreCount,
      // Whole-archive genre distribution: every registration celebrates the
      // entire collection with one genre-colored shell group per genre.
      genreCounts,
      particleEffects:
        star.rating === 5 ? ['fireworks', 'meteor-shower'] : ['fireworks'],
    },
  };
}

function createWorkCollectionEvent(
  type: 'work-hard-deleted' | 'work-soft-deleted' | 'work-restored',
  star: Star,
  occurredAt: string,
  sequence: number,
  affectedConstellationNames: string[] = [],
): RuntimeEvent {
  const particleEffects =
    type === 'work-hard-deleted'
      ? ['asteroid-impact']
      : type === 'work-soft-deleted'
        ? ['blackhole-spiral']
        : [];
  return {
    id: `${type}:${star.id}:${sequence}`,
    type,
    occurredAt,
    payload: {
      starId: star.id,
      position: star.position,
      affectedConstellationNames,
      particleEffects,
    },
  };
}

function createConstellationEvent(
  constellation: Constellation,
  sequence: number,
): RuntimeEvent {
  return {
    id: `constellation-created:${constellation.id}:${sequence}`,
    type: 'constellation-created',
    occurredAt: constellation.createdAt,
    payload: { constellationId: constellation.id },
  };
}

function successfulDraftResult(
  draft: ConstellationDraft,
): CommandResult<ConstellationDraft> {
  return { ok: true, value: draft, completionEvents: [] };
}

export function createArchiveStore(options: ArchiveStoreOptions): ArchiveStoreApi {
  const initial = cloneStore(options.initialState ?? createDefaultStore());
  const providers: ArchiveCommandProviders = {
    ...defaultProviders,
    ...options.providers,
  };
  let completionSequence = 0;
  const completedAutoOperations = new Map<string, readonly string[]>();

  const replaceDraft = (draft: ConstellationDraft): void => {
    store.setState((state) => ({
      runtime: { ...state.runtime, constellationDraft: draft },
    }));
  };

  const rememberAutoOperation = (
    operationId: string,
    constellationIds: readonly string[],
  ): void => {
    if (completedAutoOperations.size >= COMPLETED_OPERATION_ID_LIMIT) {
      const oldest = completedAutoOperations.keys().next().value as string | undefined;
      if (oldest !== undefined) completedAutoOperations.delete(oldest);
    }
    completedAutoOperations.set(operationId, [...constellationIds]);
  };

  const commands: ArchiveCommands = {
    addWork: (input) => {
      const validation = validateWorkInput(input);
      if (!validation.success) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION',
            message: '작품 입력값을 확인해 주세요.',
            fieldErrors: validation.fieldErrors,
          },
        };
      }

      return executor.execute({
        operation: 'addWork',
        derive: (snapshot) => {
          const galaxy = snapshot.galaxies.find(
            (candidate) =>
              candidate.kind.type === 'genre' &&
              candidate.kind.genre === validation.data.genre,
          );
          if (galaxy === undefined) {
            throw new Error(`Genre galaxy not found: ${validation.data.genre}`);
          }

          const id = providers.nextUuid();
          const createdAt = providers.nowIso();
          const star: Star = {
            id,
            ...validation.data,
            position: createDeterministicStarPosition(id, validation.data.genre),
            createdAt,
          };
          const candidate = structuredClone(snapshot);
          candidate.stars.push(star);
          // Every added work earns gacha progress (one ticket per five stars).
          candidate.planetCollection.lifetimeStarsAdded += 1;
          const progress = reconcileProgressAfterMutation(snapshot, candidate, {
            nowIso: createdAt,
            nextRewardId: providers.nextUuid,
          });
          const genreCounts: Record<string, number> = {};
          for (const candidateStar of progress.candidate.stars) {
            genreCounts[candidateStar.genre] =
              (genreCounts[candidateStar.genre] ?? 0) + 1;
          }
          const completionEvent = createWorkAddedEvent(
            star,
            ++completionSequence,
            genreCounts[star.genre] ?? 1,
            genreCounts,
          );
          return {
            candidate: progress.candidate,
            value: { starId: id },
            completionEvents: [
              completionEvent,
              ...progress.completionEvents,
            ],
          };
        },
      });
    },
    getAffectedConstellationNames: (starId) =>
      getAffectedConstellationNames(store.getState().persisted, starId),
    hardDelete: (starId) =>
      executor.execute({
        operation: 'hardDelete',
        derive: (snapshot) => {
          const mutation = reduceHardDelete(snapshot, starId);
          const occurredAt = providers.nowIso();
          const progress = reconcileProgressAfterMutation(
            snapshot,
            mutation.candidate,
            { nowIso: occurredAt, nextRewardId: providers.nextUuid },
          );
          const completionEvent = createWorkCollectionEvent(
            'work-hard-deleted',
            mutation.work,
            occurredAt,
            ++completionSequence,
            mutation.affectedConstellationNames,
          );
          return {
            candidate: progress.candidate,
            value: {
              starId,
              affectedConstellationNames: mutation.affectedConstellationNames,
            },
            completionEvents: [
              completionEvent,
              ...progress.completionEvents,
            ],
            applyRuntime: (runtime) => ({
              ...runtime,
              selectedStarId:
                runtime.selectedStarId === starId ? null : runtime.selectedStarId,
            }),
          };
        },
      }),
    softDelete: (starId) =>
      executor.execute({
        operation: 'softDelete',
        derive: (snapshot) => {
          const discardedAt = providers.nowIso();
          const mutation = reduceSoftDelete(snapshot, starId, discardedAt);
          const progress = reconcileProgressAfterMutation(
            snapshot,
            mutation.candidate,
            { nowIso: discardedAt, nextRewardId: providers.nextUuid },
          );
          const completionEvent = createWorkCollectionEvent(
            'work-soft-deleted',
            mutation.work,
            discardedAt,
            ++completionSequence,
            mutation.affectedConstellationNames,
          );
          return {
            candidate: progress.candidate,
            value: {
              starId,
              affectedConstellationNames: mutation.affectedConstellationNames,
            },
            completionEvents: [
              completionEvent,
              ...progress.completionEvents,
            ],
            applyRuntime: (runtime) => ({
              ...runtime,
              selectedStarId:
                runtime.selectedStarId === starId ? null : runtime.selectedStarId,
            }),
          };
        },
      }),
    restoreArchived: (starId) =>
      executor.execute({
        operation: 'restoreArchived',
        derive: (snapshot) => {
          const mutation = reduceRestoreArchived(snapshot, starId);
          const occurredAt = providers.nowIso();
          const progress = reconcileProgressAfterMutation(
            snapshot,
            mutation.candidate,
            { nowIso: occurredAt, nextRewardId: providers.nextUuid },
          );
          const completionEvent = createWorkCollectionEvent(
            'work-restored',
            mutation.work,
            occurredAt,
            ++completionSequence,
          );
          return {
            candidate: progress.candidate,
            value: { starId },
            completionEvents: [
              completionEvent,
              ...progress.completionEvents,
            ],
          };
        },
      }),
    addToWatchlist: (input) => {
      const title = normalizeDisplayText(typeof input.title === 'string' ? input.title : '');
      if (title.length === 0 || title.length > 200) {
        return validationFailure('제목은 1자 이상 200자 이하로 입력해 주세요.', {});
      }
      const genre = input.genre;
      if (typeof genre !== 'string' || !(GENRES as readonly string[]).includes(genre)) {
        return validationFailure('장르를 선택해 주세요.', {});
      }
      const normalizedTitle = normalizeText(title);
      const current = store.getState().persisted.watchlist;
      if (current.length >= 100) {
        return validationFailure('보고 싶은 작품은 100개까지 담을 수 있어요.', {});
      }
      if (current.some((entry) => entry.normalizedTitle === normalizedTitle)) {
        return validationFailure('이미 담아 둔 작품이에요.', {});
      }
      const posterPath =
        typeof input.posterPath === 'string' && POSTER_RE.test(input.posterPath)
          ? input.posterPath
          : undefined;
      return executor.execute({
        operation: 'addToWatchlist',
        derive: (snapshot) => {
          const id = providers.nextUuid();
          const entry: WatchlistEntry = {
            id,
            title,
            normalizedTitle,
            genre: genre as Genre,
            addedAt: providers.nowIso(),
            position: createDeterministicStarPosition(id, genre as Genre),
            ...(posterPath === undefined ? {} : { posterPath }),
            ...(typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0
              ? { tmdbId: input.tmdbId }
              : {}),
          };
          const candidate = structuredClone(snapshot);
          candidate.watchlist.push(entry);
          return { candidate, value: { entryId: id }, completionEvents: [] };
        },
      });
    },
    removeFromWatchlist: (entryId) => {
      const exists = store.getState().persisted.watchlist.some(({ id }) => id === entryId);
      if (!exists) return validationFailure('담아 둔 작품을 찾을 수 없습니다.', {});
      return executor.execute({
        operation: 'removeFromWatchlist',
        derive: (snapshot) => {
          const candidate = structuredClone(snapshot);
          const remaining = candidate.watchlist.filter(({ id }) => id !== entryId);
          candidate.watchlist.length = 0;
          candidate.watchlist.push(...remaining);
          return { candidate, value: { entryId }, completionEvents: [] };
        },
      });
    },
    beginWatchlistPromotion: (entryId) => {
      const entry = store.getState().persisted.watchlist.find(({ id }) => id === entryId);
      if (entry === undefined) return;
      const prefill: WatchlistPrefill = {
        entryId: entry.id,
        title: entry.title,
        genre: entry.genre,
        ...(entry.posterPath === undefined ? {} : { posterPath: entry.posterPath }),
        ...(entry.tmdbId === undefined ? {} : { tmdbId: entry.tmdbId }),
      };
      store.setState((state) => ({
        runtime: { ...state.runtime, watchlistPrefill: prefill },
      }));
    },
    pushGentleToast: (title, message) => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          toastEvents: [
            ...state.runtime.toastEvents,
            {
              id: providers.nextUuid(),
              type: 'gentle-note',
              occurredAt: providers.nowIso(),
              payload: { title, message },
            },
          ],
        },
      }));
    },
    clearWatchlistPrefill: () => {
      store.setState((state) => ({
        runtime: { ...state.runtime, watchlistPrefill: null },
      }));
    },
    markRewatched: (starId) => {
      const exists = store.getState().persisted.stars.some(({ id }) => id === starId);
      if (!exists) return validationFailure('작품을 찾을 수 없습니다.', {});
      return executor.execute({
        operation: 'markRewatched',
        derive: (snapshot) => {
          const candidate = structuredClone(snapshot);
          const star = candidate.stars.find(({ id }) => id === starId);
          if (star === undefined) throw new Error('Star vanished during rewatch');
          star.rewatchCount = Math.min(999, (star.rewatchCount ?? 0) + 1);
          return {
            candidate,
            value: { rewatchCount: star.rewatchCount },
            completionEvents: [],
          };
        },
      });
    },
    pullPlanet: () => {
      const collection = store.getState().persisted.planetCollection;
      if (availableTickets(collection) < 1) {
        return validationFailure('가챠 티켓이 없습니다.', {
          tickets: ['별 5개를 등록할 때마다 가챠 티켓 1장이 지급됩니다.'],
        });
      }
      return executor.execute({
        operation: 'pullPlanet',
        derive: (snapshot) => {
          const acquiredAt = providers.nowIso();
          const result = performPlanetPull({
            collection: snapshot.planetCollection,
            rarityRoll: providers.nextRandom(),
            speciesRoll: providers.nextRandom(),
            orbitRoll: providers.nextRandom(),
            planetId: providers.nextUuid(),
            acquiredAt,
          });
          const candidate = structuredClone(snapshot);
          // `candidate` is a shallow-readonly snapshot clone; mutate the nested
          // collection fields rather than reassigning the property.
          candidate.planetCollection.pullsPerformed += 1;
          candidate.planetCollection.planets.push(structuredClone(result.planet));
          const completionEvent: RuntimeEvent = {
            id: `planet-pulled:${result.planet.id}:${++completionSequence}`,
            type: 'planet-pulled',
            occurredAt: acquiredAt,
            payload: {
              planetId: result.planet.id,
              speciesId: result.speciesId,
              rarity: result.rarity,
              isNewSpecies: result.isNewSpecies,
            },
          };
          return {
            candidate,
            value: {
              planetId: result.planet.id,
              speciesId: result.speciesId,
              rarity: result.rarity,
              isNewSpecies: result.isNewSpecies,
            },
            completionEvents: [completionEvent],
          };
        },
      });
    },
    toggleSelectedGenre: (genre) => {
      store.setState((state) => {
        const selectedGenres = new Set(state.runtime.selectedGenres);
        if (selectedGenres.has(genre)) selectedGenres.delete(genre);
        else selectedGenres.add(genre);
        return { runtime: { ...state.runtime, selectedGenres } };
      });
    },
    setAchievementPanelOpen: (isOpen) => {
      store.setState((state) => ({
        runtime: { ...state.runtime, isAchievementPanelOpen: isOpen },
      }));
    },
    setPlanetCodexOpen: (isOpen) => {
      store.setState((state) => ({
        runtime: { ...state.runtime, isPlanetCodexOpen: isOpen },
      }));
    },
    setListDrawerOpen: (isOpen) => {
      store.setState((state) => ({
        runtime: { ...state.runtime, isListDrawerOpen: isOpen },
      }));
    },
    toggleListDrawer: () => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          isListDrawerOpen: !state.runtime.isListDrawerOpen,
        },
      }));
    },
    degradeQuality: () => {
      const current = store.getState().runtime.qualityLevel;
      const next = degradeQualityLevel(current);
      if (next !== current) {
        store.setState((state) => ({
          runtime: { ...state.runtime, qualityLevel: next },
        }));
      }
      return next;
    },
    requestCameraFocus: (request) => {
      const state = store.getState();
      if (request.type === 'star') {
        if (!state.persisted.stars.some(({ id }) => id === request.starId)) {
          return validationFailure('선택한 작품을 찾을 수 없습니다.', {
            starId: ['활성 작품만 카메라 대상으로 선택할 수 있습니다.'],
          });
        }
      } else if (request.type === 'constellation') {
        const constellation = state.persisted.constellations.find(
          ({ id }) => id === request.constellationId,
        );
        if (constellation === undefined) {
          return validationFailure('별자리를 찾을 수 없습니다.', {
            constellationId: ['존재하는 별자리만 카메라 대상으로 선택할 수 있습니다.'],
          });
        }
        const activeIds = new Set(state.persisted.stars.map(({ id }) => id));
        const activeReferenceCount = new Set(
          constellation.starIds.filter((starId) => activeIds.has(starId)),
        ).size;
        if (activeReferenceCount < 2) {
          return validationFailure('활성 작품이 2개 이상 필요합니다', {
            constellationId: ['활성 작품이 2개 이상 필요합니다'],
          });
        }
      } else {
        // Free-viewpoint returns are issued only via requestCameraReturn.
        return validationFailure('자유 시점 복귀는 직접 요청할 수 없습니다.', {
          camera: ['자유 시점 복귀는 선택 해제로만 발생합니다.'],
        });
      }

      store.setState((current) => ({
        runtime: { ...current.runtime, pendingCameraRequest: request },
      }));
      return { ok: true, value: request, completionEvents: [] };
    },
    requestCameraHome: (pose) => {
      store.setState((current) => ({
        runtime: {
          ...current.runtime,
          pendingCameraRequest: { type: 'free', pose },
        },
      }));
    },
    clearCameraRequest: (request) => {
      const pending = store.getState().runtime.pendingCameraRequest;
      if (request !== undefined) {
        if (pending === null || pending.type !== request.type) return;
        if (
          request.type === 'star'
            ? pending.type !== 'star' || pending.starId !== request.starId
            : request.type === 'constellation'
              && (pending.type !== 'constellation'
                || pending.constellationId !== request.constellationId)
        ) return;
      }
      store.setState((state) => ({
        runtime: { ...state.runtime, pendingCameraRequest: null },
      }));
    },
    capturePreFocusPose: (pose) => {
      // Capture-once: a star A→B switch must not overwrite the original pose.
      if (store.getState().runtime.preFocusPose !== null) return;
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          preFocusPose: {
            position: { ...pose.position },
            target: { ...pose.target },
          },
        },
      }));
    },
    requestCameraReturn: () => {
      const preFocusPose = store.getState().runtime.preFocusPose;
      if (preFocusPose === null) return;
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          pendingCameraRequest: { type: 'free', pose: preFocusPose },
        },
      }));
    },
    completeCameraReturn: () => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          pendingCameraRequest: null,
          preFocusPose: null,
          selectedStarId: null,
        },
      }));
    },
    startConstellationDraft: (initialStarId) => {
      if (
        initialStarId !== undefined &&
        !store.getState().persisted.stars.some(({ id }) => id === initialStarId)
      ) {
        return validationFailure('선택할 활성 작품을 찾을 수 없습니다.', {
          starIds: ['활성 작품만 별자리에 추가할 수 있습니다.'],
        });
      }
      const draft = createActiveConstellationDraft(initialStarId);
      replaceDraft(draft);
      return successfulDraftResult(draft);
    },
    selectConstellationStar: (starId) => {
      const state = store.getState();
      const current = state.runtime.constellationDraft;
      if (!current.active) {
        return validationFailure('별자리 연결 모드를 먼저 시작해 주세요.', {
          starIds: ['별자리 연결 모드가 활성 상태가 아닙니다.'],
        });
      }
      if (!state.persisted.stars.some(({ id }) => id === starId)) {
        return validationFailure('선택할 활성 작품을 찾을 수 없습니다.', {
          starIds: ['활성 작품만 별자리에 추가할 수 있습니다.'],
        });
      }
      const draft = selectConstellationDraftStar(current, starId);
      if (draft.error !== null && !current.starIds.includes(starId)) {
        replaceDraft(draft);
        return validationFailure(draft.error, { starIds: [draft.error] });
      }
      if (!current.starIds.includes(starId)) replaceDraft(draft);
      return successfulDraftResult(draft);
    },
    finishConstellationDraft: () => {
      const current = store.getState().runtime.constellationDraft;
      if (!current.active) {
        return validationFailure('별자리 연결 모드를 먼저 시작해 주세요.', {
          starIds: ['별자리 연결 모드가 활성 상태가 아닙니다.'],
        });
      }
      const draft = requestConstellationName(current);
      replaceDraft(draft);
      return draft.error === null
        ? successfulDraftResult(draft)
        : validationFailure(draft.error, { starIds: [draft.error] });
    },
    cancelConstellationDraft: () => {
      const draft = createInactiveConstellationDraft();
      replaceDraft(draft);
      return successfulDraftResult(draft);
    },
    createConstellation: (input) => {
      const rawName = typeof input === 'string' ? input : input.name;
      const currentDraft = store.getState().runtime.constellationDraft;
      const starIds = [
        ...(typeof input === 'string' || input.starIds === undefined
          ? currentDraft.starIds
          : input.starIds),
      ];
      const validation = validateConstellationCreation(rawName, starIds);
      const activeIds = new Set(store.getState().persisted.stars.map(({ id }) => id));
      if (starIds.some((id) => !activeIds.has(id))) {
        validation.success = false;
        validation.errors.starIds = '활성 작품만 별자리에 추가할 수 있습니다.';
      }
      if (!validation.success || validation.name === undefined) {
        const draft: ConstellationDraft = {
          active: true,
          phase: validation.errors.starIds === undefined ? 'naming' : 'selecting',
          starIds,
          error: validation.errors.name ?? validation.errors.starIds ?? null,
        };
        replaceDraft(draft);
        const fieldErrors: Record<string, string[]> = {};
        if (validation.errors.name !== undefined) {
          fieldErrors.name = [validation.errors.name];
        }
        if (validation.errors.starIds !== undefined) {
          fieldErrors.starIds = [validation.errors.starIds];
        }
        return validationFailure('별자리 입력값을 확인해 주세요.', fieldErrors);
      }

      const normalizedName = validation.name;
      return executor.execute({
        operation: 'createConstellation',
        derive: (snapshot) => {
          const snapshotActiveIds = new Set(snapshot.stars.map(({ id }) => id));
          if (starIds.some((id) => !snapshotActiveIds.has(id))) {
            throw new Error('Constellation contains a non-active work');
          }
          const constellation: Constellation = {
            id: providers.nextUuid(),
            name: normalizedName,
            starIds: [...starIds],
            color: selectDeterministicConstellationColor(
              snapshot.constellations.map(({ color }) => color),
            ),
            createdAt: providers.nowIso(),
          };
          const candidate = structuredClone(snapshot);
          candidate.constellations.push(constellation);
          return {
            candidate,
            value: { constellationId: constellation.id },
            completionEvents: [
              createConstellationEvent(constellation, ++completionSequence),
            ],
            applyRuntime: (runtime) => ({
              ...runtime,
              constellationDraft: createInactiveConstellationDraft(),
            }),
          };
        },
      });
    },
    createGenreConstellations: (operationId) => {
      if (operationId.trim().length === 0) {
        return validationFailure('자동 생성 작업 ID가 필요합니다.', {
          operationId: ['operationId는 비어 있을 수 없습니다.'],
        });
      }
      const completedIds = completedAutoOperations.get(operationId);
      if (completedIds !== undefined) {
        return {
          ok: true,
          value: { constellationIds: [...completedIds] },
          completionEvents: [],
        };
      }

      const initialGroups = buildGenreConstellationGroups(
        store.getState().persisted.stars,
      );
      if (initialGroups.length === 0) {
        rememberAutoOperation(operationId, []);
        return {
          ok: true,
          value: { constellationIds: [] },
          completionEvents: [],
        };
      }

      const result = executor.execute<CreateGenreConstellationsValue>({
        operation: 'createGenreConstellations',
        derive: (snapshot) => {
          const groups = buildGenreConstellationGroups(snapshot.stars);
          if (groups.length === 0) {
            throw new Error('Eligible genre groups changed during auto generation');
          }
          const candidate = structuredClone(snapshot);
          const created: Constellation[] = [];
          for (const group of groups) {
            const constellation: Constellation = {
              id: providers.nextUuid(),
              name: `${group.genre} 별자리`,
              starIds: [...group.starIds],
              color: selectDeterministicConstellationColor(
                candidate.constellations.map(({ color }) => color),
              ),
              createdAt: providers.nowIso(),
            };
            candidate.constellations.push(constellation);
            created.push(constellation);
          }
          const occurredAt = created[0]!.createdAt;
          const completionEvent: RuntimeEvent = {
            id: `genre-constellations-created:${operationId}:${++completionSequence}`,
            type: 'genre-constellations-created',
            occurredAt,
            payload: {
              operationId,
              constellationIds: created.map(({ id }) => id),
            },
          };
          return {
            candidate,
            value: { constellationIds: created.map(({ id }) => id) },
            completionEvents: [completionEvent],
          };
        },
      });
      if (result.ok) {
        rememberAutoOperation(operationId, result.value.constellationIds);
      }
      return result;
    },
    scheduleAutosave: () => {
      options.persistence.scheduleAutosave(
        structuredClone(store.getState().persisted),
      );
    },
    consumeCompletionEvent: (eventId) => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          completionEvents: state.runtime.completionEvents.filter(
            ({ id }) => id !== eventId,
          ),
        },
      }));
    },
    consumeToastEvent: (eventId) => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          toastEvents: state.runtime.toastEvents.filter(
            ({ id }) => id !== eventId,
          ),
        },
      }));
    },
  };

  const store = createStore<ArchiveStoreState>()(() => ({
    ...initial,
    commands,
  }));
  const executor = new AtomicCommandExecutor(
    store,
    options.persistence,
    providers.nowIso,
  );

  const unsubscribeDiagnostics = options.persistence.subscribeAutosaveDiagnostics(
    (diagnostics) => {
      store.setState((state) => ({
        runtime: {
          ...state.runtime,
          storageDiagnostics: diagnostics,
        },
      }));
    },
  );

  return Object.assign(store, { dispose: unsubscribeDiagnostics });
}

export function createArchiveStoreFromLoadResult(
  loadResult: LoadResult,
  persistence: PersistenceService,
  providers?: Partial<ArchiveCommandProviders>,
): ArchiveStoreApi {
  return createArchiveStore({
    persistence,
    providers,
    initialState: {
      persisted: reconcileRestoredProgress(loadResult.state),
      runtime: createDefaultStore(loadResult.hasPersistedRegistration).runtime,
    },
  });
}

export const archiveSelectors = {
  persisted: (state: ArchiveStoreState) => state.persisted,
  runtime: (state: ArchiveStoreState) => state.runtime,
  stars: (state: ArchiveStoreState) => state.persisted.stars,
  constellations: (state: ArchiveStoreState) => state.persisted.constellations,
  blackholeArchive: (state: ArchiveStoreState) =>
    state.persisted.blackholeArchive,
  affectedConstellationNames: (state: ArchiveStoreState, starId: string) =>
    getAffectedConstellationNames(state.persisted, starId),
  completionEvents: (state: ArchiveStoreState) => state.runtime.completionEvents,
  toastEvents: (state: ArchiveStoreState) => state.runtime.toastEvents,
  storageDiagnostics: (state: ArchiveStoreState) => state.runtime.storageDiagnostics,
  sceneArchiveContent: (state: ArchiveStoreState): SceneArchiveContent =>
    state.runtime.hasPersistedRegistration
      ? {
          stars: state.persisted.stars,
          constellations: state.persisted.constellations,
        }
      : { stars: [], constellations: [] },
} as const;
