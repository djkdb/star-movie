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

/** Allows the Store construction boundary to consume the already-loaded result. */
export function getBootstrappedPersistedState(): LoadResult | null {
  return bootstrappedState;
}

/** Returns the same service instance that performed bootstrap loading. */
export function getBootstrappedPersistenceService(): PersistenceService | null {
  return bootstrappedService;
}
