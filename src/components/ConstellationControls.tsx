import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';

import type { ArchiveStoreApi } from '../store/archiveStore';
import { useModalFocusTrap } from './useModalFocusTrap';

let autoOperationSequence = 0;

function nextAutoOperationId(): string {
  autoOperationSequence += 1;
  return `auto-constellation:${Date.now()}:${autoOperationSequence}`;
}

export interface ConstellationControlsProps {
  store: ArchiveStoreApi;
}

export function ConstellationControls({ store }: ConstellationControlsProps) {
  const draft = useStore(store, (state) => state.runtime.constellationDraft);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const previousPhase = useRef(draft.phase);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const manualTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelDraft = () => store.getState().commands.cancelConstellationDraft();
  const namingFocusTrap = useModalFocusTrap<HTMLFormElement>(
    draft.active && draft.phase === 'naming',
    cancelDraft,
    nameInputRef,
    manualTriggerRef,
  );

  useEffect(() => {
    if (!draft.active || (draft.phase === 'naming' && previousPhase.current !== 'naming')) {
      setName('');
    }
    previousPhase.current = draft.phase;
  }, [draft.active, draft.phase]);

  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = store.getState().commands.createConstellation(name);
    if (result.ok) {
      setStatus('별자리를 만들었습니다.');
      setName('');
    } else {
      setStatus(result.error.message);
    }
  };

  const createAutomaticConstellations = () => {
    const result = store.getState().commands.createGenreConstellations(
      nextAutoOperationId(),
    );
    if (!result.ok) {
      setStatus(result.error.message);
      return;
    }
    setStatus(result.value.constellationIds.length === 0
      ? '자동 생성할 장르가 없습니다.'
      : `${result.value.constellationIds.length}개의 장르 별자리를 만들었습니다.`);
  };

  return (
    <section className="constellation-controls glass-panel" aria-labelledby="constellation-controls-heading">
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">CONSTELLATIONS</p>
          <h2 id="constellation-controls-heading">별자리 만들기</h2>
        </div>
        {!draft.active && (
          <button
            className="primary-action"
            onClick={() => {
              setStatus(null);
              store.getState().commands.startConstellationDraft();
            }}
            ref={manualTriggerRef}
            type="button"
          >
            수동으로 만들기
          </button>
        )}
      </div>

      {draft.active && (
        <div className="constellation-draft-status" role="status">
          <strong>연결 모드</strong>
          <span>{draft.starIds.length}/200개 작품 선택</span>
          <p>3D 공간 또는 작품 DOM 탐색에서 작품을 원하는 순서대로 선택하세요.</p>
          {draft.error !== null && draft.phase === 'selecting' && (
            <p className="field-error" role="alert">{draft.error}</p>
          )}
          <div className="constellation-control-actions">
            <button
              className="primary-action"
              onClick={() => store.getState().commands.finishConstellationDraft()}
              type="button"
            >
              선택 완료
            </button>
            <button
              className="secondary-action"
              onClick={cancelDraft}
              type="button"
            >
              취소
            </button>
          </div>
        </div>
      )}

      <button
        className="secondary-action automatic-constellation-action"
        onClick={createAutomaticConstellations}
        type="button"
      >
        장르로 자동 별자리 만들기
      </button>
      {status !== null && <p className="constellation-operation-status" role="status">{status}</p>}

      {draft.active && draft.phase === 'naming' && (
        <div className="dialog-backdrop">
          <form
            aria-labelledby="constellation-name-heading"
            aria-modal="true"
            className="confirm-dialog constellation-name-dialog"
            onKeyDown={namingFocusTrap.onKeyDown}
            onSubmit={submitName}
            ref={namingFocusTrap.containerRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="constellation-name-heading">별자리 이름 정하기</h2>
            <p>선택한 {draft.starIds.length}개의 작품을 이 순서대로 연결합니다.</p>
            <label htmlFor="constellation-name">이름 (최대 30자)</label>
            <input
              id="constellation-name"
              onChange={(event) => setName(event.target.value)}
              ref={nameInputRef}
              value={name}
            />
            {draft.error !== null && <p className="field-error" role="alert">{draft.error}</p>}
            <div className="dialog-actions">
              <button
                className="secondary-action"
                onClick={cancelDraft}
                type="button"
              >
                취소
              </button>
              <button className="primary-action" type="submit">별자리 생성</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
