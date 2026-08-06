import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { awaitReelFonts, canRecordReel, recordReel, type ReelFailure } from '../scene/reelCapture';
import { REEL_DURATION_MS, type ReelStats } from '../scene/reelCaptureModel';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { selectHudViewModel } from '../store/selectors';

export interface ReelStudioProps {
  store: ArchiveStoreApi;
}

/**
 * Marks the document while a clip is being filmed. The stylesheet uses it to
 * crop the canvas to 9:16 and hide every panel, so what the recorder reads off
 * the canvas is already the vertical frame — no upscaling a cropped landscape
 * buffer, and no chrome baked into the file.
 */
const FRAMING_ATTRIBUTE = 'data-reel-framing';

/** One beat for the resize to settle and a few real frames to render. */
const FRAMING_SETTLE_MS = 900;

const FAILURE_MESSAGE: Record<ReelFailure, string> = {
  unsupported: '이 브라우저는 화면 녹화를 지원하지 않아요. 크롬이나 엣지에서 다시 시도해 주세요.',
  'no-canvas': '3D 장면이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.',
  'no-context': '영상을 합성할 수 없었어요. 다른 브라우저에서 다시 시도해 주세요.',
  'empty-recording': '녹화된 내용이 없어요. 화면을 켜 둔 채로 다시 시도해 주세요.',
  'recorder-error': '녹화 중 문제가 생겼어요. 다시 시도해 주세요.',
};

export function ReelStudio({ store }: ReelStudioProps) {
  const persisted = useStore(store, (state) => state.persisted);
  const runtime = useStore(store, (state) => state.runtime);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [supported] = useState(() => canRecordReel());
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    document.documentElement.removeAttribute(FRAMING_ATTRIBUTE);
  }, []);

  const start = useCallback(async () => {
    setRecording(true);
    setProgress(0);
    setStatus(null);

    const hud = selectHudViewModel({ persisted, runtime });
    const stats: ReelStats = {
      starCount: hud.activeWorkCount,
      genreCount: new Set(persisted.stars.map(({ genre }) => genre)).size,
      topGenre: hud.topGenres[0] ?? null,
      averageRating: hud.averageRating,
      constellationCount: persisted.constellations.length,
      planetCount: persisted.planetCollection.planets.length,
    };

    document.documentElement.setAttribute(FRAMING_ATTRIBUTE, 'true');
    // Let the renderer resize into the vertical frame, and get the caption
    // faces resident, before the clock starts — everything awaited after the
    // origin is flight time the recorder is not running for yet.
    await Promise.all([
      new Promise((resolve) => window.setTimeout(resolve, FRAMING_SETTLE_MS)),
      awaitReelFonts(),
    ]);

    const startedAtMs = performance.now();
    store.getState().commands.startCinematicTour(startedAtMs);

    // A rejection here must not escape: the button's label is driven by
    // `recording`, so an uncaught throw would leave it reading 촬영 중… forever.
    let result: Awaited<ReturnType<typeof recordReel>>;
    try {
      result = await recordReel({
        stats,
        startedAtMs,
        onProgress: (value) => {
          if (mounted.current) setProgress(value);
        },
      });
    } catch {
      result = { ok: false, reason: 'recorder-error' };
    } finally {
      store.getState().commands.stopCinematicTour();
      document.documentElement.removeAttribute(FRAMING_ATTRIBUTE);
    }

    if (!mounted.current) return;
    setRecording(false);
    setProgress(0);
    setStatus(
      result.ok
        ? `${result.filename} 저장 완료. 인스타그램 릴스에 그대로 올릴 수 있어요.`
        : FAILURE_MESSAGE[result.reason],
    );
  }, [persisted, runtime, store]);

  return (
    <section aria-labelledby="reel-studio-heading" className="reel-studio">
      <h3 id="reel-studio-heading">릴스용 영상</h3>
      <p className="reel-studio-intro">
        내 밤하늘 위로 카메라가 {Math.round(REEL_DURATION_MS / 1000)}초 동안 날아가는 세로 영상(9:16)을
        만듭니다. 기록한 작품 수와 최다 장르가 자막으로 들어가요.
      </p>

      <button
        className="primary-action reel-studio-button"
        disabled={!supported || recording}
        onClick={start}
        type="button"
      >
        {recording ? `촬영 중… ${Math.round(progress * 100)}%` : '릴스용 영상 만들기'}
      </button>

      {recording && (
        <p className="reel-studio-hint">
          촬영이 끝날 때까지 이 탭을 그대로 두세요. 다른 탭으로 옮기면 화면이 멈춥니다.
        </p>
      )}

      {!supported && (
        <p className="reel-studio-hint">
          이 브라우저는 화면 녹화를 지원하지 않아요. 크롬·엣지에서 열면 사용할 수 있습니다.
        </p>
      )}

      {status !== null && (
        <p className="reel-studio-status" role="status">{status}</p>
      )}
    </section>
  );
}
