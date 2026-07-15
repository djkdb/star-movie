import { useRef } from 'react';

import { useModalFocusTrap } from './useModalFocusTrap';

export interface ConfirmDialogProps {
  title: string;
  description: string;
  affectedConstellationNames: readonly string[];
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
}

export function ConfirmDialog({
  title,
  description,
  affectedConstellationNames,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusTrap = useModalFocusTrap<HTMLDivElement>(true, onCancel, cancelRef);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby="delete-dialog-description"
        aria-labelledby="delete-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        onKeyDown={focusTrap.onKeyDown}
        ref={focusTrap.containerRef}
        tabIndex={-1}
        role="dialog"
      >
        <h2 id="delete-dialog-title">{title}</h2>
        <p id="delete-dialog-description">{description}</p>
        <section aria-labelledby="affected-constellations-heading">
          <h3 id="affected-constellations-heading">영향받는 별자리</h3>
          {affectedConstellationNames.length === 0 ? (
            <p className="muted-copy">영향받는 별자리가 없습니다.</p>
          ) : (
            <ul className="affected-constellation-list">
              {affectedConstellationNames.map((name, index) => (
                <li key={`${name}-${index}`}>{name}</li>
              ))}
            </ul>
          )}
        </section>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} ref={cancelRef} type="button">
            취소
          </button>
          <button className="danger-action" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
