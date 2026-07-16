// Feature: natural-star-drift-and-camera-return
// Camera return command state transitions (Requirements 3.2, 3.3, 3.5, 3.6).

import { describe, expect, it } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import type { CameraPose } from '../domain/models';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore, type ArchiveStoreApi } from './archiveStore';

const POSE: CameraPose = {
  position: { x: 1, y: 2, z: 3 },
  target: { x: 4, y: 5, z: 6 },
};

function createStore(): ArchiveStoreApi {
  return createArchiveStore({
    persistence: new PersistenceService({
      storage: new FakeLocalStorageAdapter(),
      scheduler: new FakeClock(),
      nowIso: () => '2030-01-01T00:00:00.000Z',
    }),
    initialState: createDefaultStore(true),
  });
}

describe('camera return commands', () => {
  it('R3.2 captures the pose by value, decoupled from later mutations of the source', () => {
    const store = createStore();
    try {
      const source: CameraPose = {
        position: { ...POSE.position },
        target: { ...POSE.target },
      };
      store.getState().commands.capturePreFocusPose(source);
      expect(store.getState().runtime.preFocusPose).toEqual(POSE);
      expect(store.getState().runtime.preFocusPose).not.toBe(source);
    } finally {
      store.dispose();
    }
  });

  it('R3.3 requestCameraReturn issues a free request only when a pose was captured', () => {
    const store = createStore();
    try {
      // No captured pose: the call is a no-op.
      store.getState().commands.requestCameraReturn();
      expect(store.getState().runtime.pendingCameraRequest).toBeNull();

      store.getState().commands.capturePreFocusPose(POSE);
      store.getState().commands.requestCameraReturn();
      expect(store.getState().runtime.pendingCameraRequest).toEqual({
        type: 'free',
        pose: POSE,
      });
    } finally {
      store.dispose();
    }
  });

  it('R3.6 completeCameraReturn clears the request, the captured pose, and the selection', () => {
    const store = createStore();
    try {
      store.setState((state) => ({
        runtime: { ...state.runtime, selectedStarId: 'some-star' },
      }));
      store.getState().commands.capturePreFocusPose(POSE);
      store.getState().commands.requestCameraReturn();

      store.getState().commands.completeCameraReturn();
      const { runtime } = store.getState();
      expect(runtime.pendingCameraRequest).toBeNull();
      expect(runtime.preFocusPose).toBeNull();
      expect(runtime.selectedStarId).toBeNull();
    } finally {
      store.dispose();
    }
  });

  it('R3.5 requestCameraFocus rejects a direct free request', () => {
    const store = createStore();
    try {
      const result = store.getState().commands.requestCameraFocus({
        type: 'free',
        pose: POSE,
      });
      expect(result.ok).toBe(false);
      expect(store.getState().runtime.pendingCameraRequest).toBeNull();
    } finally {
      store.dispose();
    }
  });

  it('R3.4 deselecting via soft/hard delete of the focused star drives a free return', () => {
    for (const path of ['softDelete', 'hardDelete'] as const) {
      const store = createStore();
      try {
        const added = store.getState().commands.addWork({
          title: 'Focused Work',
          genre: 'SF',
          rating: 5,
          review: '',
          watchedDate: '2025-01-01',
          director: 'Director',
        });
        if (!added.ok) throw new Error('setup failed');
        const { starId } = added.value;

        // Simulate a selection focus: capture pose and select the star.
        store.setState((state) => ({
          runtime: { ...state.runtime, selectedStarId: starId },
        }));
        store.getState().commands.capturePreFocusPose(POSE);

        // Deleting the selected star nulls selectedStarId (the return trigger).
        const result = store.getState().commands[path](starId);
        expect(result.ok).toBe(true);
        expect(store.getState().runtime.selectedStarId).toBeNull();

        // The central deselection effect then requests the return.
        store.getState().commands.requestCameraReturn();
        expect(store.getState().runtime.pendingCameraRequest).toEqual({
          type: 'free',
          pose: POSE,
        });
      } finally {
        store.dispose();
      }
    }
  });
});
