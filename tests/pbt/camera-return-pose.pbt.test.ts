// Feature: natural-star-drift-and-camera-return, Property 8: 초점 타깃은 선택 시점 위치로 고정
// Feature: natural-star-drift-and-camera-return, Property 9: Pre_Focus_Pose 캡처-원스
// **Validates: Requirements 2.2, 3.2, 3.5**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../../src/domain/defaultState';
import type { CameraPose, Star, Store } from '../../src/domain/models';
import { PersistenceService } from '../../src/persistence/persistenceService';
import { resolveCameraFocusRequest } from '../../src/scene/cameraMath';
import { createArchiveStore } from '../../src/store/archiveStore';
import { FakeClock, FakeLocalStorageAdapter } from '../../src/test/providers';

function createPersistence(): PersistenceService {
  return new PersistenceService({
    storage: new FakeLocalStorageAdapter(),
    scheduler: new FakeClock(),
    nowIso: () => '2030-01-01T00:00:00.000Z',
  });
}

function starFrom(position: Star['position']): Star {
  return {
    id: 'focus-star',
    title: 'Focus Star',
    normalizedTitle: 'focus star',
    genre: 'SF',
    rating: 4,
    review: '',
    watchedDate: '2025-01-01',
    director: 'Director',
    normalizedDirector: 'director',
    position,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

const positionArbitrary = fc.record({
  x: fc.double({ min: -100, max: 100, noNaN: true }),
  y: fc.double({ min: -100, max: 100, noNaN: true }),
  z: fc.double({ min: -100, max: 100, noNaN: true }),
});
const poseArbitrary: fc.Arbitrary<CameraPose> = fc.record({
  position: positionArbitrary,
  target: positionArbitrary,
});

describe('Property 8: focus target fixed to the selection-instant position', () => {
  it('R2.2 resolves the star focus target to the star position snapshot at request time', () => {
    fc.assert(
      fc.property(positionArbitrary, (position) => {
        const star = starFrom(position);
        const resolution = resolveCameraFocusRequest(
          { type: 'star', starId: star.id },
          [star],
          [],
        );
        expect(resolution).toEqual({
          ok: true,
          request: { type: 'star', starId: star.id, position },
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 9: Pre_Focus_Pose capture-once', () => {
  it('R3.2 R3.5 stores the first pose and never overwrites it on a subsequent capture', () => {
    fc.assert(
      fc.property(poseArbitrary, poseArbitrary, (first, second) => {
        const store = createArchiveStore({
          persistence: createPersistence(),
          initialState: createDefaultStore(true) as Store,
        });
        try {
          store.getState().commands.capturePreFocusPose(first);
          expect(store.getState().runtime.preFocusPose).toEqual(first);
          // A second capture (star A→B) must leave the original pose intact.
          store.getState().commands.capturePreFocusPose(second);
          expect(store.getState().runtime.preFocusPose).toEqual(first);
        } finally {
          store.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
