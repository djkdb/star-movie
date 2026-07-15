import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { useFrame } from '@react-three/fiber';

export class VisibleElapsedClock {
  private elapsedMilliseconds = 0;
  private lastTimestampMilliseconds: number;
  private visible: boolean;

  constructor(initialTimestampMilliseconds: number, initiallyVisible: boolean) {
    this.lastTimestampMilliseconds = initialTimestampMilliseconds;
    this.visible = initiallyVisible;
  }

  sample(timestampMilliseconds: number): number {
    const delta = Math.max(0, timestampMilliseconds - this.lastTimestampMilliseconds);
    if (this.visible) this.elapsedMilliseconds += delta;
    this.lastTimestampMilliseconds = timestampMilliseconds;
    return this.elapsedMilliseconds / 1_000;
  }

  setVisibility(visible: boolean, timestampMilliseconds: number): number {
    const elapsedSeconds = this.sample(timestampMilliseconds);
    this.visible = visible;
    this.lastTimestampMilliseconds = timestampMilliseconds;
    return elapsedSeconds;
  }

  get elapsedSeconds(): number {
    return this.elapsedMilliseconds / 1_000;
  }
}

const VisibilityTimeContext = createContext<MutableRefObject<number> | null>(null);

export interface VisibilityClockProps {
  children: ReactNode;
  now?: () => number;
  paused?: boolean;
}

/** Advances only across visible intervals, preserving phase while the page is hidden. */
export function VisibilityClock({
  children,
  now = () => performance.now(),
  paused = false,
}: VisibilityClockProps) {
  const elapsedSeconds = useRef(0);
  const clock = useRef<VisibleElapsedClock | null>(null);

  if (clock.current === null) {
    clock.current = new VisibleElapsedClock(
      now(),
      typeof document === 'undefined' || document.visibilityState === 'visible',
    );
  }

  useEffect(() => {
    const handleVisibilityChange = () => {
      elapsedSeconds.current = clock.current!.setVisibility(
        document.visibilityState === 'visible',
        now(),
      );
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [now]);

  useFrame(() => {
    if (!paused) elapsedSeconds.current = clock.current!.sample(now());
  }, -100);

  return (
    <VisibilityTimeContext.Provider value={elapsedSeconds}>
      {children}
    </VisibilityTimeContext.Provider>
  );
}

export function useVisibleElapsedSeconds(): MutableRefObject<number> {
  const elapsedSeconds = useContext(VisibilityTimeContext);
  if (elapsedSeconds === null) {
    throw new Error('useVisibleElapsedSeconds must be used inside VisibilityClock');
  }
  return elapsedSeconds;
}
