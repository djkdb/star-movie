import { createDemoSeedPersistedStore } from '../domain/demoSeedState';
import {
  createBrowserPersistenceService,
  type LoadResult,
  type PersistenceService,
} from './persistenceService';

let bootstrappedState: LoadResult | null = null;
let bootstrappedService: PersistenceService | null = null;

/** Loads and validates persistence before bootstrapApplication mounts React. */
export async function bootstrapPersistedState(
  service: PersistenceService = createBrowserPersistenceService(),
): Promise<LoadResult> {
  const result = service.load();
  bootstrappedService = service;
  bootstrappedState = result;
  return result;
}

/**
 * Plants the built-in demo archive on a genuine first run only: when storage
 * holds no document at all, the demo state is validated and saved so the
 * visitor's first sky is already populated. Existing archives — including
 * corrupted ones recovered to the default — are never overwritten.
 */
export function seedDemoArchiveIfFirstRun(service: PersistenceService): boolean {
  const existing = service.load();
  if (existing.source !== 'default') return false;
  return service.saveUserAction(createDemoSeedPersistedStore()).ok;
}

/** Allows the Store construction boundary to consume the already-loaded result. */
export function getBootstrappedPersistedState(): LoadResult | null {
  return bootstrappedState;
}

/** Returns the same service instance that performed bootstrap loading. */
export function getBootstrappedPersistenceService(): PersistenceService | null {
  return bootstrappedService;
}
