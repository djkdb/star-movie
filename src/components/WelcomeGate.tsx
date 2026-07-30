import { useEffect, useRef, useState } from 'react';

import { getCloudGateway, type CloudArchiveGateway } from '../cloud/cloudArchiveGateway';
import type { ArchiveStoreApi } from '../store/archiveStore';

const CHOICE_KEY = 'space-movie-archive:welcome-choice';

function alreadyChose(): boolean {
  try {
    return window.localStorage.getItem(CHOICE_KEY) !== null;
  } catch {
    return true; // No storage: never nag.
  }
}

function rememberChoice(choice: 'account' | 'guest'): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Best effort; the worst case is being asked once more.
  }
}

export interface WelcomeGateProps {
  store: ArchiveStoreApi;
  gateway?: CloudArchiveGateway | null;
}

/**
 * The first thing a new visitor decides: keep this universe on an account, or
 * just start using it.
 *
 * Shown once, and only when there is actually a cloud to sign in to. "그냥
 * 시작하기" is given equal weight on purpose — the app has always worked without
 * an account and should not start pretending otherwise.
 */
export function WelcomeGate({ store, gateway: injected }: WelcomeGateProps) {
  const gateway = injected === undefined ? getCloudGateway() : injected;
  const [visible, setVisible] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (gateway === null || alreadyChose()) return undefined;
    let cancelled = false;
    // Someone already signed in on this device has answered this question.
    void gateway.getSession().then((session) => {
      if (!cancelled && session === null) setVisible(true);
    });
    return () => { cancelled = true; };
  }, [gateway]);

  useEffect(() => {
    if (visible) primaryRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const choose = (choice: 'account' | 'guest') => {
    rememberChoice(choice);
    setVisible(false);
    if (choice === 'account') {
      // The sign-in form lives in the overview panel; open it for them.
      store.getState().commands.requestPanelOpen('overview');
    }
  };

  return (
    <div className="welcome-gate" role="presentation">
      <div
        aria-labelledby="welcome-gate-title"
        aria-modal="true"
        className="welcome-gate-card"
        role="dialog"
      >
        <p className="eyebrow">ASTERON</p>
        <h2 id="welcome-gate-title">내가 본 이야기들이 별이 되는 곳</h2>
        <p className="welcome-gate-copy">
          기록을 어떻게 보관할지 정해 주세요. 나중에 언제든 바꿀 수 있어요.
        </p>

        <div className="welcome-gate-actions">
          <button
            className="primary-action"
            onClick={() => choose('account')}
            ref={primaryRef}
            type="button"
          >
            로그인 / 회원가입
          </button>
          <button
            className="secondary-action"
            onClick={() => choose('guest')}
            type="button"
          >
            그냥 시작하기
          </button>
        </div>

        <dl className="welcome-gate-compare">
          <div>
            <dt>로그인하면</dt>
            <dd>다른 기기에서도 같은 우주를 볼 수 있어요.</dd>
          </div>
          <div>
            <dt>그냥 시작하면</dt>
            <dd>이 브라우저에만 저장돼요. 파일로 내보내 두면 옮길 수 있어요.</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
