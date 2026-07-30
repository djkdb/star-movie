import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { summarizeArchive } from '../domain/archiveTransfer';
import type { PersistedStateV2 } from '../domain/models';
import { safeDecodePersistedV2 } from '../persistence/persistedStateCodec';
import type { RemoteArchiveMeta } from './cloudSyncModel';

/**
 * Everything the app needs from the cloud, behind one interface.
 *
 * The app depends on this shape, not on Supabase, so the sync flows can be
 * tested against a fake without a network — and so swapping providers later
 * never reaches past this file.
 */
export interface CloudArchiveGateway {
  getSession(): Promise<CloudSession | null>;
  onSessionChange(listener: (session: CloudSession | null) => void): () => void;
  signUp(email: string, password: string): Promise<CloudResult<{ needsConfirmation: boolean }>>;
  signIn(email: string, password: string): Promise<CloudResult<void>>;
  signOut(): Promise<void>;
  /** null when this account has no archive stored yet. */
  fetchArchive(): Promise<CloudResult<{ meta: RemoteArchiveMeta; document: PersistedStateV2 } | null>>;
  fetchMeta(): Promise<CloudResult<RemoteArchiveMeta | null>>;
  pushArchive(document: PersistedStateV2, deviceLabel: string): Promise<CloudResult<RemoteArchiveMeta>>;
}

export interface CloudSession {
  userId: string;
  email: string | null;
}

export type CloudResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/** A hung request must never trap the UI in a "working…" state forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Every call to Supabase goes through here.
 *
 * The client *throws* on network failure rather than returning an error, and a
 * request can also simply never settle. Either one would leave the caller stuck
 * showing a spinner, so both are turned into an ordinary failed CloudResult.
 */
async function guard<T>(run: () => Promise<CloudResult<T>>): Promise<CloudResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<CloudResult<T>>((resolve) => {
        timer = setTimeout(
          () => resolve({
            ok: false,
            message: '응답이 없어요. 네트워크 상태를 확인하고 다시 시도해 주세요.',
          }),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (cause) {
    return {
      ok: false,
      message: friendlyMessage(cause instanceof Error ? cause : null),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Supabase errors are technical; users get something they can act on. */
function friendlyMessage(error: { message?: string } | null): string {
  const raw = error?.message ?? '';
  if (/invalid login credentials/i.test(raw)) return '이메일 또는 비밀번호가 올바르지 않아요.';
  if (/email not confirmed/i.test(raw)) return '이메일 인증이 아직 끝나지 않았어요. 받은 메일함을 확인해 주세요.';
  if (/user already registered/i.test(raw)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (/password should be at least/i.test(raw)) return '비밀번호는 6자 이상으로 만들어 주세요.';
  if (/rate limit|too many/i.test(raw)) return '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.';
  if (/fetch|network|failed to fetch/i.test(raw)) return '네트워크에 연결하지 못했어요.';
  return raw.length > 0 ? raw : '알 수 없는 오류가 발생했어요.';
}

interface ArchiveRow {
  document: unknown;
  schema_version: number;
  revision: number;
  device_label: string | null;
  updated_at: string;
}

function toMeta(row: ArchiveRow, document: PersistedStateV2): RemoteArchiveMeta {
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    deviceLabel: row.device_label,
    summary: summarizeArchive(document),
  };
}

export function createSupabaseGateway(client: SupabaseClient): CloudArchiveGateway {
  const requireUser = async (): Promise<string | null> => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  };

  const readRow = async (): Promise<CloudResult<ArchiveRow | null>> => {
    const userId = await requireUser();
    if (userId === null) return { ok: false, message: '로그인이 필요해요.' };
    const { data, error } = await client
      .from('archives')
      .select('document, schema_version, revision, device_label, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error !== null) return { ok: false, message: friendlyMessage(error) };
    return { ok: true, value: (data as ArchiveRow | null) ?? null };
  };

  return {
    async getSession() {
      try {
        const { data } = await client.auth.getSession();
        const user = data.session?.user;
        return user === undefined ? null : { userId: user.id, email: user.email ?? null };
      } catch {
        return null;
      }
    },

    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        listener(user === undefined ? null : { userId: user.id, email: user.email ?? null });
      });
      return () => data.subscription.unsubscribe();
    },

    signUp: (email, password) => guard(async () => {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error !== null) return { ok: false, message: friendlyMessage(error) };
      // With email confirmation on, Supabase returns a user but no session.
      return { ok: true, value: { needsConfirmation: data.session === null } };
    }),

    signIn: (email, password) => guard(async () => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error !== null) return { ok: false, message: friendlyMessage(error) };
      return { ok: true, value: undefined };
    }),

    async signOut() {
      try {
        await client.auth.signOut();
      } catch {
        // Signing out is best effort; the local session is cleared regardless.
      }
    },

    fetchMeta: () => guard(async () => {
      const row = await readRow();
      if (!row.ok) return row;
      if (row.value === null) return { ok: true, value: null };
      const decoded = safeDecodePersistedV2(row.value.document);
      if (!decoded.success) {
        return { ok: false, message: '클라우드에 저장된 기록을 읽을 수 없어요.' };
      }
      return { ok: true, value: toMeta(row.value, decoded.data) };
    }),

    fetchArchive: () => guard(async () => {
      const row = await readRow();
      if (!row.ok) return row;
      if (row.value === null) return { ok: true, value: null };
      // Validate on the way in: a document edited outside the app must never
      // reach the store unchecked.
      const decoded = safeDecodePersistedV2(row.value.document);
      if (!decoded.success) {
        return { ok: false, message: '클라우드에 저장된 기록이 손상됐어요.' };
      }
      return {
        ok: true,
        value: { meta: toMeta(row.value, decoded.data), document: decoded.data },
      };
    }),

    pushArchive: (document, deviceLabel) => guard(async () => {
      const userId = await requireUser();
      if (userId === null) return { ok: false, message: '로그인이 필요해요.' };
      const { data, error } = await client
        .from('archives')
        .upsert(
          {
            user_id: userId,
            document,
            schema_version: document.schemaVersion,
            device_label: deviceLabel,
          },
          { onConflict: 'user_id' },
        )
        .select('document, schema_version, revision, device_label, updated_at')
        .single();
      if (error !== null) return { ok: false, message: friendlyMessage(error) };
      return { ok: true, value: toMeta(data as ArchiveRow, document) };
    }),
  };
}

let cached: CloudArchiveGateway | null | undefined;

/**
 * The gateway for this build, or null when Supabase is not configured — in
 * which case the app simply stays local-only and the account UI is hidden.
 */
export function getCloudGateway(): CloudArchiveGateway | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || url.length === 0
    || typeof key !== 'string' || key.length === 0) {
    cached = null;
    return cached;
  }
  cached = createSupabaseGateway(
    createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    }),
  );
  return cached;
}
