import type { ArchiveSummary } from '../domain/archiveTransfer';

/**
 * The decisions behind cloud sync, kept as pure functions.
 *
 * The network layer is deliberately elsewhere: everything that could lose a
 * user's records is decided here, where it can be tested exhaustively without
 * touching Supabase.
 */

/** What the cloud currently holds for this account. */
export interface RemoteArchiveMeta {
  revision: number;
  updatedAt: string;
  deviceLabel: string | null;
  summary: ArchiveSummary;
}

export interface LocalArchiveMeta {
  summary: ArchiveSummary;
  /** Revision this device last synced with, or null if it never has. */
  syncedRevision: number | null;
}

export type SyncDecision =
  /** Nothing in the cloud yet — this device's archive becomes the first backup. */
  | { kind: 'upload'; reason: 'cloud-empty' }
  /** This device is empty (fresh install) — take the cloud copy. */
  | { kind: 'download'; reason: 'local-empty' }
  /** Already in step. */
  | { kind: 'in-sync' }
  /** The cloud moved on while this device did not — safe to take the cloud copy. */
  | { kind: 'download'; reason: 'behind' }
  /** Both changed independently. Never resolved automatically. */
  | { kind: 'conflict' };

function isEmpty(summary: ArchiveSummary): boolean {
  return summary.workCount === 0
    && summary.constellationCount === 0
    && summary.archivedCount === 0
    && summary.watchlistCount === 0;
}

/**
 * Decides what should happen when a signed-in device meets the cloud copy.
 *
 * The one rule that matters: **when both sides changed independently, this
 * returns 'conflict' and never picks a winner.** The archive has no way to
 * express a deletion, so merging the two would resurrect works the user
 * deleted on the other device. A human chooses instead.
 */
export function decideSync(
  local: LocalArchiveMeta,
  remote: RemoteArchiveMeta | null,
): SyncDecision {
  if (remote === null) return { kind: 'upload', reason: 'cloud-empty' };
  if (isEmpty(local.summary)) return { kind: 'download', reason: 'local-empty' };

  // This device has never pulled, yet the cloud holds records: two independent
  // histories. Treat as a conflict rather than guessing.
  if (local.syncedRevision === null) return { kind: 'conflict' };

  if (local.syncedRevision === remote.revision) return { kind: 'in-sync' };
  if (local.syncedRevision < remote.revision) return { kind: 'download', reason: 'behind' };

  // Local claims a revision newer than the cloud's — the cloud was reset or
  // restored from an older copy. Not safe to assume; ask.
  return { kind: 'conflict' };
}

/** A one-line, human-readable label for a cloud copy. */
export function describeRemote(remote: RemoteArchiveMeta, locale = 'ko-KR'): string {
  const when = new Date(remote.updatedAt);
  const stamp = Number.isNaN(when.getTime())
    ? '시간 알 수 없음'
    : when.toLocaleString(locale);
  const device = remote.deviceLabel === null || remote.deviceLabel.trim().length === 0
    ? ''
    : ` · ${remote.deviceLabel}`;
  return `작품 ${remote.summary.workCount}편 · ${stamp}${device}`;
}

/**
 * A short, non-identifying label for this device, shown next to a cloud copy so
 * the user can tell "which one was this?". Deliberately coarse — no fingerprint.
 */
export function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'iPhone/iPad';
  if (/android/.test(ua)) return 'Android';
  if (/mac os x|macintosh/.test(ua)) return 'Mac';
  if (/windows/.test(ua)) return 'Windows';
  if (/linux/.test(ua)) return 'Linux';
  return '알 수 없는 기기';
}
