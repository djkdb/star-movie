import { useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  buildBackupFileName,
  parseBackupFile,
  serializeArchiveForBackup,
  summarizeArchive,
  type ArchiveSummary,
} from '../domain/archiveTransfer';
import type { PersistedStateV2 } from '../domain/models';
import type { ArchiveStoreApi } from '../store/archiveStore';
import { useModalFocusTrap } from './useModalFocusTrap';

interface PendingImport {
  state: PersistedStateV2;
  summary: ArchiveSummary;
  fileName: string;
}

function SummaryList({ summary }: { summary: ArchiveSummary }) {
  return (
    <dl className="transfer-summary">
      <div><dt>작품</dt><dd>{summary.workCount}</dd></div>
      <div><dt>별자리</dt><dd>{summary.constellationCount}</dd></div>
      <div><dt>블랙홀 보관</dt><dd>{summary.archivedCount}</dd></div>
      <div><dt>보고 싶은 작품</dt><dd>{summary.watchlistCount}</dd></div>
      <div><dt>행성</dt><dd>{summary.planetCount}</dd></div>
    </dl>
  );
}

/**
 * Export the universe to a file, and restore one from a file.
 *
 * The archive lives only in this browser, so this is the user's safety net
 * against cleared site data or a new device. Importing replaces everything,
 * so it always goes through a confirmation that shows both sides first.
 */
export function DataTransferPanel({ store }: { store: ArchiveStoreApi }) {
  const persisted = useStore(store, (state) => state.persisted);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusTrap = useModalFocusTrap<HTMLDivElement>(
    pending !== null,
    () => setPending(null),
    cancelRef,
  );

  const currentSummary = summarizeArchive(persisted);

  const handleExport = () => {
    setError(null);
    try {
      const blob = new Blob([serializeArchiveForBackup(persisted)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildBackupFileName(new Date());
      anchor.click();
      URL.revokeObjectURL(url);
      setExportedAt(new Date().toLocaleTimeString('ko-KR'));
    } catch {
      setError('파일을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  const handleFileChosen = async (file: File) => {
    setError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('파일을 읽지 못했어요.');
      return;
    }
    const result = parseBackupFile(text);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPending({ state: result.state, summary: result.summary, fileName: file.name });
  };

  const confirmImport = () => {
    if (pending === null) return;
    const result = store.getState().commands.importArchive(pending.state);
    setPending(null);
    if (result.ok) {
      store.getState().commands.pushGentleToast(
        '기록을 되살렸어요',
        `작품 ${result.value.workCount}편이 다시 하늘에 떠올랐습니다.`,
      );
    }
    // A failed import already surfaces its own toast through the store.
  };

  return (
    <section aria-labelledby="data-transfer-heading" className="data-transfer">
      <h3 id="data-transfer-heading">기록 백업</h3>
      <p className="transfer-intro">
        기록은 이 브라우저에만 저장돼요. 파일로 내려받아 두면 기기를 바꾸거나
        브라우저 데이터를 지워도 되살릴 수 있습니다.
      </p>

      <SummaryList summary={currentSummary} />

      <div className="transfer-actions">
        <button className="primary-action" onClick={handleExport} type="button">
          파일로 내보내기
        </button>
        <button
          className="secondary-action"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          파일에서 가져오기
        </button>
      </div>

      <input
        accept="application/json,.json"
        aria-label="백업 파일 선택"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change event.
          event.target.value = '';
          if (file !== undefined) void handleFileChosen(file);
        }}
        ref={fileInputRef}
        type="file"
      />

      {exportedAt !== null && (
        <p className="transfer-status" role="status">{exportedAt}에 내보냈어요.</p>
      )}
      {error !== null && (
        <p className="field-error" role="alert">{error}</p>
      )}

      {pending !== null && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-describedby="import-dialog-description"
            aria-labelledby="import-dialog-title"
            aria-modal="true"
            className="confirm-dialog"
            onKeyDown={focusTrap.onKeyDown}
            ref={focusTrap.containerRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="import-dialog-title">기록을 바꿀까요?</h2>
            <p id="import-dialog-description">
              불러온 파일의 기록으로 <b>지금 우주를 완전히 대체</b>합니다.
              지금 기록은 사라지니, 필요하면 먼저 내보내 두세요.
            </p>

            <div className="transfer-compare">
              <section aria-label="지금 기록">
                <h3>지금 이 기기</h3>
                <SummaryList summary={currentSummary} />
              </section>
              <section aria-label="불러온 파일">
                <h3>불러온 파일</h3>
                <SummaryList summary={pending.summary} />
              </section>
            </div>

            <div className="dialog-actions">
              <button
                className="secondary-action"
                onClick={() => setPending(null)}
                ref={cancelRef}
                type="button"
              >
                취소
              </button>
              <button className="danger-action" onClick={confirmImport} type="button">
                기록 대체하기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
