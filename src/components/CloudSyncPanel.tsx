import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { summarizeArchive, type ArchiveSummary } from '../domain/archiveTransfer';
import {
  describeDevice,
  describeRemote,
  type RemoteArchiveMeta,
} from '../cloud/cloudSyncModel';
import type { CloudArchiveGateway, CloudSession } from '../cloud/cloudArchiveGateway';
import { getCloudGateway } from '../cloud/cloudArchiveGateway';
import type { ArchiveStoreApi } from '../store/archiveStore';

/** Remembers which cloud revision this device last agreed with. */
const SYNCED_REVISION_KEY = 'space-movie-archive:cloud-revision';

function readSyncedRevision(): number | null {
  try {
    const raw = window.localStorage.getItem(SYNCED_REVISION_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSyncedRevision(revision: number): void {
  try {
    window.localStorage.setItem(SYNCED_REVISION_KEY, String(revision));
  } catch {
    // Best effort; a lost marker only means the next sync asks the user.
  }
}

type Busy = 'none' | 'auth' | 'push' | 'pull';

export interface CloudSyncPanelProps {
  store: ArchiveStoreApi;
  /** Injectable for tests; defaults to the configured Supabase gateway. */
  gateway?: CloudArchiveGateway | null;
}

/**
 * Sign in and move the archive to and from the cloud — by hand, for now.
 *
 * This is step 1 on purpose: the user presses the button and sees the result,
 * so a broken round trip is obvious instead of silently eating records.
 * Automatic sync comes later, once this path is proven.
 */
export function CloudSyncPanel({ store, gateway: injected }: CloudSyncPanelProps) {
  const gateway = injected === undefined ? getCloudGateway() : injected;
  const persisted = useStore(store, (state) => state.persisted);
  const [session, setSession] = useState<CloudSession | null>(null);
  const [remote, setRemote] = useState<RemoteArchiveMeta | null>(null);
  const [busy, setBusy] = useState<Busy>('none');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [confirmPull, setConfirmPull] = useState<{ meta: RemoteArchiveMeta } | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const refreshRemote = useCallback(async (active: CloudSession | null) => {
    if (gateway === null || active === null) {
      setRemote(null);
      return;
    }
    try {
      const result = await gateway.fetchMeta();
      if (!mounted.current) return;
      if (result.ok) setRemote(result.value);
      else setError(result.message);
    } catch {
      // A background refresh failing must not interrupt anything.
    }
  }, [gateway]);

  useEffect(() => {
    if (gateway === null) return undefined;
    void gateway.getSession().then((current) => {
      if (!mounted.current) return;
      setSession(current);
      void refreshRemote(current);
    });
    return gateway.onSessionChange((next) => {
      if (!mounted.current) return;
      setSession(next);
      void refreshRemote(next);
    });
  }, [gateway, refreshRemote]);

  // Not configured for this build: stay quiet rather than showing a dead panel.
  if (gateway === null) return null;

  const localSummary: ArchiveSummary = summarizeArchive(persisted);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy('auth');
    try {
      if (mode === 'signUp') {
        const result = await gateway.signUp(email.trim(), password);
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setPassword('');
        setNotice(result.value.needsConfirmation
          ? '가입 확인 메일을 보냈어요. 메일의 링크를 눌러 인증한 뒤 로그인해 주세요.'
          : '가입이 끝났어요.');
        return;
      }

      const result = await gateway.signIn(email.trim(), password);
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPassword('');
    } catch {
      // A gateway is expected to return failures, but never trust it to.
      if (mounted.current) setError('알 수 없는 오류가 발생했어요. 다시 시도해 주세요.');
    } finally {
      // Whatever happens — including a thrown error — the form must come back.
      if (mounted.current) setBusy('none');
    }
  };

  const handlePush = async () => {
    setError(null);
    setNotice(null);
    setBusy('push');
    try {
      const result = await gateway.pushArchive(
        persisted,
        describeDevice(navigator.userAgent),
      );
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      writeSyncedRevision(result.value.revision);
      setRemote(result.value);
      setNotice('클라우드에 저장했어요.');
    } catch {
      if (mounted.current) setError('클라우드에 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (mounted.current) setBusy('none');
    }
  };

  const startPull = async () => {
    setError(null);
    setNotice(null);
    setBusy('pull');
    try {
      const result = await gateway.fetchMeta();
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.value === null) {
        setError('클라우드에 저장된 기록이 아직 없어요.');
        return;
      }
      setRemote(result.value);
      setConfirmPull({ meta: result.value });
    } catch {
      if (mounted.current) setError('클라우드를 확인하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (mounted.current) setBusy('none');
    }
  };

  const confirmPullNow = async () => {
    setConfirmPull(null);
    setBusy('pull');
    try {
      const result = await gateway.fetchArchive();
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.value === null) {
        setError('클라우드에 저장된 기록이 아직 없어요.');
        return;
      }
      const applied = store.getState().commands.importArchive(result.value.document);
      if (applied.ok) {
        writeSyncedRevision(result.value.meta.revision);
        setRemote(result.value.meta);
        store.getState().commands.pushGentleToast(
          '클라우드에서 불러왔어요',
          `작품 ${applied.value.workCount}편이 다시 하늘에 떠올랐습니다.`,
        );
      }
    } catch {
      if (mounted.current) setError('클라우드에서 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (mounted.current) setBusy('none');
    }
  };

  return (
    <section aria-labelledby="cloud-sync-heading" className="cloud-sync">
      <h3 id="cloud-sync-heading">클라우드 백업</h3>

      {session === null ? (
        <>
          <p className="transfer-intro">
            로그인하면 기록을 클라우드에 두고 다른 기기에서도 불러올 수 있어요.
            로그인하지 않아도 지금처럼 이 브라우저에서 그대로 쓸 수 있습니다.
          </p>
          <form className="cloud-auth-form" onSubmit={handleAuth}>
            <div className="form-field">
              <label htmlFor="cloud-email">이메일</label>
              <input
                autoComplete="email"
                id="cloud-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="form-field">
              <label htmlFor="cloud-password">비밀번호</label>
              <input
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                id="cloud-password"
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <div className="transfer-actions">
              <button className="primary-action" disabled={busy === 'auth'} type="submit">
                {busy === 'auth' ? '처리 중…' : mode === 'signIn' ? '로그인' : '가입하기'}
              </button>
              <button
                className="secondary-action"
                onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(null); }}
                type="button"
              >
                {mode === 'signIn' ? '회원가입' : '로그인으로'}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className="transfer-intro">
            <b>{session.email ?? '로그인됨'}</b>
            {remote === null
              ? ' · 클라우드에 저장된 기록이 아직 없어요.'
              : ` · 클라우드: ${describeRemote(remote)}`}
          </p>
          <div className="transfer-actions">
            <button
              className="primary-action"
              disabled={busy !== 'none'}
              onClick={() => void handlePush()}
              type="button"
            >
              {busy === 'push' ? '올리는 중…' : `클라우드에 저장 (작품 ${localSummary.workCount}편)`}
            </button>
            <button
              className="secondary-action"
              disabled={busy !== 'none' || remote === null}
              onClick={() => void startPull()}
              type="button"
            >
              {busy === 'pull' ? '불러오는 중…' : '클라우드에서 불러오기'}
            </button>
            <button
              className="secondary-action"
              disabled={busy !== 'none'}
              onClick={() => void gateway.signOut()}
              type="button"
            >
              로그아웃
            </button>
          </div>
        </>
      )}

      {notice !== null && <p className="transfer-status" role="status">{notice}</p>}
      {error !== null && <p className="field-error" role="alert">{error}</p>}

      {confirmPull !== null && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-labelledby="cloud-pull-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="cloud-pull-title">클라우드 기록으로 바꿀까요?</h2>
            <p>
              지금 이 기기의 기록(작품 {localSummary.workCount}편)을
              <b> 클라우드 기록으로 완전히 대체</b>합니다.
              먼저 파일로 내보내 두시면 안전해요.
            </p>
            <p className="transfer-status">클라우드: {describeRemote(confirmPull.meta)}</p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                onClick={() => setConfirmPull(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="danger-action"
                onClick={() => void confirmPullNow()}
                type="button"
              >
                불러오기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
