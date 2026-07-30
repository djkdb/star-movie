import {
  encodePersistedV2,
  safeDecodePersistedV2,
} from '../persistence/persistedStateCodec';
import type { PersistedStateV2 } from './models';

/**
 * Taking the whole universe out as a file, and putting one back.
 *
 * The archive lives only in this browser's localStorage, so clearing site data
 * or switching devices would lose every record. A plain JSON file is the
 * safety net: it needs no account, no network, and no trust in any service
 * staying free — and it is the fallback if cloud sync ever goes wrong.
 */

export const BACKUP_FILE_PREFIX = 'asteron-backup';

/** `asteron-backup-2026-07-30.json`, dated in the viewer's own timezone. */
export function buildBackupFileName(now: Date): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${BACKUP_FILE_PREFIX}-${year}-${month}-${day}.json`;
}

export interface ArchiveSummary {
  workCount: number;
  constellationCount: number;
  archivedCount: number;
  watchlistCount: number;
  planetCount: number;
}

export function summarizeArchive(state: PersistedStateV2): ArchiveSummary {
  return {
    workCount: state.stars.length,
    constellationCount: state.constellations.length,
    archivedCount: state.blackholeArchive.length,
    watchlistCount: state.watchlist.length,
    planetCount: state.planetCollection.planets.length,
  };
}

/** The exact bytes written to the backup file — the canonical codec output. */
export function serializeArchiveForBackup(state: PersistedStateV2): string {
  return encodePersistedV2(state);
}

export type BackupParseResult =
  | { ok: true; state: PersistedStateV2; summary: ArchiveSummary }
  | { ok: false; message: string };

/**
 * Validates a file the user picked before any of it can touch the store.
 * Every failure returns a plain-language reason rather than a raw parser error.
 */
export function parseBackupFile(text: string): BackupParseResult {
  if (text.trim().length === 0) {
    return { ok: false, message: '파일이 비어 있어요.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: '파일을 읽을 수 없어요. Asteron에서 내보낸 .json 파일이 맞는지 확인해 주세요.',
    };
  }

  const decoded = safeDecodePersistedV2(parsed);
  if (!decoded.success) {
    return {
      ok: false,
      message: 'Asteron 백업 파일이 아니거나 내용이 손상됐어요.',
    };
  }

  return {
    ok: true,
    state: decoded.data,
    summary: summarizeArchive(decoded.data),
  };
}
