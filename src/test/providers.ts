export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface UuidProvider {
  next(): string;
}

export interface CurrentTimeProvider {
  now(): Date;
  nowIso(): string;
}

export interface Prng {
  next(): number;
}

export interface StorageAdapter {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface TestProviders {
  clock: Clock;
  uuid: UuidProvider;
  currentTime: CurrentTimeProvider;
  prng: Prng;
  storage: StorageAdapter;
}

interface ScheduledTimer {
  id: number;
  dueAt: number;
  callback: () => void;
}

export class FakeClock implements Clock {
  private elapsedMs: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, ScheduledTimer>();

  constructor(startMs = 0) {
    if (!Number.isFinite(startMs)) throw new RangeError('startMs must be finite');
    this.elapsedMs = startMs;
  }

  now(): number {
    return this.elapsedMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('delayMs must be a finite non-negative number');
    }

    const id = this.nextTimerId++;
    this.timers.set(id, { id, dueAt: this.elapsedMs + delayMs, callback });
    return id;
  }

  clearTimeout(timerId: number): void {
    this.timers.delete(timerId);
  }

  advanceBy(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('deltaMs must be a finite non-negative number');
    }

    const target = this.elapsedMs + deltaMs;
    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!next) break;

      this.elapsedMs = next.dueAt;
      this.timers.delete(next.id);
      next.callback();
    }
    this.elapsedMs = target;
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }
}

export class SequenceUuidProvider implements UuidProvider {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  next(): string {
    const value = this.values[this.index];
    if (value === undefined) throw new Error('UUID sequence exhausted');
    this.index += 1;
    return value;
  }
}

export class IncrementingUuidProvider implements UuidProvider {
  private value: bigint;

  constructor(start = 1n) {
    if (start < 0n || start > 0xffffffffffffn) throw new RangeError('UUID counter is out of range');
    this.value = start;
  }

  next(): string {
    if (this.value > 0xffffffffffffn) throw new Error('UUID counter exhausted');
    const suffix = this.value.toString(16).padStart(12, '0');
    this.value += 1n;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

export class FixedCurrentTimeProvider implements CurrentTimeProvider {
  private readonly epochMs: number;

  constructor(value: Date | string | number) {
    this.epochMs = new Date(value).getTime();
    if (!Number.isFinite(this.epochMs)) throw new RangeError('Current time must be valid');
  }

  now(): Date {
    return new Date(this.epochMs);
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

export class SeededPrng implements Prng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new RangeError('PRNG seed must be an integer');
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }
}

export interface FakeStorageOptions {
  initial?: Readonly<Record<string, string>>;
  failReads?: boolean;
  failWrites?: boolean;
}

export class FakeLocalStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();
  failReads: boolean;
  failWrites: boolean;

  constructor(options: FakeStorageOptions = {}) {
    Object.entries(options.initial ?? {}).forEach(([key, value]) => this.values.set(key, value));
    this.failReads = options.failReads ?? false;
    this.failWrites = options.failWrites ?? false;
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.assertWritable();
    this.values.clear();
  }

  getItem(key: string): string | null {
    this.assertReadable();
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    this.assertReadable();
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.assertWritable();
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.assertWritable();
    this.values.set(String(key), String(value));
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(this.values));
  }

  private assertReadable(): void {
    if (this.failReads) throw new Error('Injected localStorage read failure');
  }

  private assertWritable(): void {
    if (this.failWrites) throw new Error('Injected localStorage write failure');
  }
}
