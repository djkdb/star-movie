// The export takes the camera and hides the whole interface, so the two things
// that must hold are: it puts everything back afterwards even when recording
// fails, and it says so plainly when the browser cannot record at all.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultStore } from '../domain/defaultState';
import { PersistenceService } from '../persistence/persistenceService';
import { FakeClock, FakeLocalStorageAdapter } from '../test/providers';
import { createArchiveStore, type ArchiveStoreApi } from '../store/archiveStore';

const recordReel = vi.hoisted(() => vi.fn());
const canRecordReel = vi.hoisted(() => vi.fn());
const awaitReelFonts = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../scene/reelCapture', () => ({ recordReel, canRecordReel, awaitReelFonts }));

const { ReelStudio } = await import('./ReelStudio');

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

const FRAMING = 'data-reel-framing';

let store: ArchiveStoreApi;

beforeEach(() => {
  vi.clearAllMocks();
  canRecordReel.mockReturnValue(true);
  awaitReelFonts.mockResolvedValue(undefined);
  store = createStore();
});

afterEach(() => {
  cleanup();
  store.dispose();
  document.documentElement.removeAttribute(FRAMING);
});

describe('ReelStudio', () => {
  it('films the flight, then hands the camera and the interface back', async () => {
    recordReel.mockImplementation(async () => {
      // Mid-shoot the tour owns the camera and the chrome is out of frame.
      expect(store.getState().runtime.cinematicTour).not.toBeNull();
      expect(document.documentElement.getAttribute(FRAMING)).toBe('true');
      return { ok: true, filename: 'asteron-reel-20300101.mp4' };
    });

    render(<ReelStudio store={store} />);
    await userEvent.click(screen.getByRole('button', { name: '릴스용 영상 만들기' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('asteron-reel-20300101.mp4');
    });
    expect(store.getState().runtime.cinematicTour).toBeNull();
    expect(document.documentElement.hasAttribute(FRAMING)).toBe(false);
  }, 10_000);

  it('recovers the button and the view when the recorder throws', async () => {
    recordReel.mockRejectedValue(new Error('recorder exploded'));

    render(<ReelStudio store={store} />);
    await userEvent.click(screen.getByRole('button', { name: '릴스용 영상 만들기' }));

    // The label is driven by the recording flag, so a swallowed throw would
    // leave it stuck reading 촬영 중… with no way back.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '릴스용 영상 만들기' })).toBeEnabled();
    });
    expect(screen.getByRole('status')).toHaveTextContent('녹화 중 문제가 생겼어요');
    expect(document.documentElement.hasAttribute(FRAMING)).toBe(false);
    expect(store.getState().runtime.cinematicTour).toBeNull();
  }, 10_000);

  it('explains the failure in plain language instead of leaving a dead button', async () => {
    recordReel.mockResolvedValue({ ok: false, reason: 'empty-recording' });

    render(<ReelStudio store={store} />);
    await userEvent.click(screen.getByRole('button', { name: '릴스용 영상 만들기' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('녹화된 내용이 없어요');
    });
  }, 10_000);

  it('disables itself and says why when the browser cannot record', async () => {
    canRecordReel.mockReturnValue(false);

    render(<ReelStudio store={store} />);

    expect(screen.getByRole('button', { name: '릴스용 영상 만들기' })).toBeDisabled();
    expect(screen.getByText(/화면 녹화를 지원하지 않아요/)).toBeInTheDocument();
    expect(recordReel).not.toHaveBeenCalled();
  });
});
