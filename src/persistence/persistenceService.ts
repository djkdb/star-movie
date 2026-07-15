import { createDefaultPersistedStore } from '../domain/defaultState';
import type { PersistedStateV2, StorageDiagnostics } from '../domain/models';
import { decodePersistedV2, encodePersistedV2 } from './persistedStateCodec';

export const PERSISTENCE_STORAGE_KEY = 'space-movie-archive:v2';
export const AUTOSAVE_DEBOUNCE_MS = 1_000;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export type PersistenceErrorCode =
  | 'STORAGE_READ'
  | 'SERIALIZATION'
  | 'STORAGE_WRITE'
  | 'WRITE_BUSY';

export interface PersistenceError {
  code: PersistenceErrorCode;
  message: string;
  cause: unknown;
}

export type LoadResult =
  | {
      ok: true;
      state: PersistedStateV2;
      source: 'storage';
      hasPersistedRegistration: true;
    }
  | {
      ok: true;
      state: PersistedStateV2;
      source: 'default';
      hasPersistedRegistration: false;
    }
  | {
      ok: false;
      state: PersistedStateV2;
      source: 'recovered-default';
      hasPersistedRegistration: false;
      error: PersistenceError;
    };

export type SaveResult =
  | { ok: true }
  | { ok: false; error: PersistenceError };

export interface PersistenceServiceOptions {
  storage: StorageAdapter;
  scheduler?: TimerScheduler;
  nowIso?: () => string;
  createDefaultState?: () => PersistedStateV2;
  onAutosaveDiagnostics?: (diagnostics: StorageDiagnostics) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistenceError(
  code: PersistenceErrorCode,
  message: string,
  cause: unknown,
): PersistenceError {
  return { code, message, cause };
}

function browserScheduler(): TimerScheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
  };
}

/**
 * Owns the single persistence key. User writes are synchronous so callers can
 * commit memory only after success; autosaves are debounced and never throw.
 */
export class PersistenceService {
  private readonly storage: StorageAdapter;
  private readonly scheduler: TimerScheduler;
  private readonly nowIso: () => string;
  private readonly createDefaultState: () => PersistedStateV2;
  private readonly autosaveDiagnosticsListeners = new Set<
    (diagnostics: StorageDiagnostics) => void
  >();
  private autosaveTimerId: number | null = null;
  private pendingAutosave: PersistedStateV2 | null = null;
  private queuedAutosave: PersistedStateV2 | null = null;
  private writeInProgress = false;
  private diagnostics: StorageDiagnostics = {
    lastAutosaveError: null,
    lastAutosaveErrorAt: null,
  };

  constructor(options: PersistenceServiceOptions) {
    this.storage = options.storage;
    this.scheduler = options.scheduler ?? browserScheduler();
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.createDefaultState = options.createDefaultState ?? createDefaultPersistedStore;
    if (options.onAutosaveDiagnostics !== undefined) {
      this.autosaveDiagnosticsListeners.add(options.onAutosaveDiagnostics);
    }
  }

  /** Registers a silent diagnostics observer for Store runtime state. */
  subscribeAutosaveDiagnostics(
    listener: (diagnostics: StorageDiagnostics) => void,
  ): () => void {
    this.autosaveDiagnosticsListeners.add(listener);
    return () => this.autosaveDiagnosticsListeners.delete(listener);
  }

  load(): LoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(PERSISTENCE_STORAGE_KEY);
    } catch (cause) {
      return this.recover(
        persistenceError('STORAGE_READ', '저장 데이터를 읽지 못했습니다.', cause),
      );
    }

    if (raw === null) {
      return {
        ok: true,
        state: this.createDefaultState(),
        source: 'default',
        hasPersistedRegistration: false,
      };
    }

    try {
      return {
        ok: true,
        state: decodePersistedV2(raw),
        source: 'storage',
        hasPersistedRegistration: true,
      };
    } catch (cause) {
      return this.recover(
        persistenceError('SERIALIZATION', '저장 데이터가 손상되어 기본 상태로 복구했습니다.', cause),
      );
    }
  }

  /** Returns a per-attempt result; it never mutates the supplied candidate. */
  saveUserAction(candidate: PersistedStateV2): SaveResult {
    // A user command is newer than any delayed autosave snapshot.
    this.cancelPendingAutosave();
    if (this.writeInProgress) {
      return {
        ok: false,
        error: persistenceError(
          'WRITE_BUSY',
          '다른 저장 작업이 진행 중입니다.',
          new Error('Persistence write mutex is busy'),
        ),
      };
    }
    return this.write(candidate);
  }

  scheduleAutosave(state: PersistedStateV2): void {
    this.pendingAutosave = state;
    if (this.autosaveTimerId !== null) this.scheduler.clearTimeout(this.autosaveTimerId);
    this.autosaveTimerId = this.scheduler.setTimeout(() => {
      this.autosaveTimerId = null;
      const candidate = this.pendingAutosave;
      this.pendingAutosave = null;
      if (candidate !== null) this.runAutosave(candidate);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  getDiagnostics(): StorageDiagnostics {
    return { ...this.diagnostics };
  }

  cancelAutosave(): void {
    this.cancelPendingAutosave();
  }

  private recover(error: PersistenceError): LoadResult {
    return {
      ok: false,
      state: this.createDefaultState(),
      source: 'recovered-default',
      hasPersistedRegistration: false,
      error,
    };
  }

  private cancelPendingAutosave(): void {
    if (this.autosaveTimerId !== null) {
      this.scheduler.clearTimeout(this.autosaveTimerId);
      this.autosaveTimerId = null;
    }
    this.pendingAutosave = null;
    this.queuedAutosave = null;
  }

  private runAutosave(candidate: PersistedStateV2): void {
    if (this.writeInProgress) {
      this.queuedAutosave = candidate;
      return;
    }

    const result = this.write(candidate);
    if (!result.ok) this.recordAutosaveFailure(result.error);
  }

  private write(candidate: PersistedStateV2): SaveResult {
    if (this.writeInProgress) {
      return {
        ok: false,
        error: persistenceError(
          'WRITE_BUSY',
          '다른 저장 작업이 진행 중입니다.',
          new Error('Persistence write mutex is busy'),
        ),
      };
    }

    this.writeInProgress = true;
    try {
      let encoded: string;
      try {
        encoded = encodePersistedV2(candidate);
      } catch (cause) {
        return {
          ok: false,
          error: persistenceError('SERIALIZATION', '저장 상태를 직렬화하지 못했습니다.', cause),
        };
      }

      try {
        this.storage.setItem(PERSISTENCE_STORAGE_KEY, encoded);
        return { ok: true };
      } catch (cause) {
        return {
          ok: false,
          error: persistenceError('STORAGE_WRITE', '저장 공간에 쓰지 못했습니다.', cause),
        };
      }
    } finally {
      this.writeInProgress = false;
      const queued = this.queuedAutosave;
      this.queuedAutosave = null;
      if (queued !== null) this.runAutosave(queued);
    }
  }

  private recordAutosaveFailure(error: PersistenceError): void {
    this.diagnostics = {
      lastAutosaveError: `${error.code}: ${errorMessage(error.cause)}`,
      lastAutosaveErrorAt: this.nowIso(),
    };
    for (const listener of this.autosaveDiagnosticsListeners) {
      try {
        listener({ ...this.diagnostics });
      } catch {
        // Diagnostics observers must not turn a silent autosave failure into an exception.
      }
    }
  }
}

export function createBrowserPersistenceService(
  onAutosaveDiagnostics?: (diagnostics: StorageDiagnostics) => void,
): PersistenceService {
  return new PersistenceService({ storage: window.localStorage, onAutosaveDiagnostics });
}
