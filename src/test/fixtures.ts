import {
  FakeClock,
  FakeLocalStorageAdapter,
  FixedCurrentTimeProvider,
  IncrementingUuidProvider,
  SeededPrng,
  type TestProviders,
} from './providers';

export const DEFAULT_TEST_EPOCH_MS = Date.parse('2025-01-01T00:00:00.000Z');
export const DEFAULT_TEST_SEED = 0x5eed1234;

export interface TestProviderOverrides {
  clock?: TestProviders['clock'];
  uuid?: TestProviders['uuid'];
  currentTime?: TestProviders['currentTime'];
  prng?: TestProviders['prng'];
  storage?: TestProviders['storage'];
}

export function createTestProviders(overrides: TestProviderOverrides = {}): TestProviders {
  return {
    clock: overrides.clock ?? new FakeClock(DEFAULT_TEST_EPOCH_MS),
    uuid: overrides.uuid ?? new IncrementingUuidProvider(),
    currentTime: overrides.currentTime ?? new FixedCurrentTimeProvider(DEFAULT_TEST_EPOCH_MS),
    prng: overrides.prng ?? new SeededPrng(DEFAULT_TEST_SEED),
    storage: overrides.storage ?? new FakeLocalStorageAdapter(),
  };
}

export interface WebGlLifecycleSnapshot {
  geometries: number;
  materials: number;
  textures: number;
  animationFrames: number;
  timers: number;
}

export function createEmptyWebGlLifecycleSnapshot(): WebGlLifecycleSnapshot {
  return { geometries: 0, materials: 0, textures: 0, animationFrames: 0, timers: 0 };
}

export function assertWebGlLifecycleReturnedToBaseline(
  baseline: WebGlLifecycleSnapshot,
  current: WebGlLifecycleSnapshot,
): void {
  const changed = (Object.keys(baseline) as Array<keyof WebGlLifecycleSnapshot>).filter(
    (key) => baseline[key] !== current[key],
  );
  if (changed.length > 0) {
    throw new Error(`WebGL lifecycle did not return to baseline: ${changed.join(', ')}`);
  }
}
