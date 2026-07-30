import { describe, expect, it } from 'vitest';

import type { ArchiveSummary } from '../domain/archiveTransfer';
import {
  decideSync,
  describeDevice,
  describeRemote,
  type LocalArchiveMeta,
  type RemoteArchiveMeta,
} from './cloudSyncModel';

const EMPTY: ArchiveSummary = {
  workCount: 0,
  constellationCount: 0,
  archivedCount: 0,
  watchlistCount: 0,
  planetCount: 0,
};

function summary(workCount: number): ArchiveSummary {
  return { ...EMPTY, workCount };
}

function local(workCount: number, syncedRevision: number | null): LocalArchiveMeta {
  return { summary: summary(workCount), syncedRevision };
}

function remote(revision: number, workCount = 5): RemoteArchiveMeta {
  return {
    revision,
    updatedAt: '2026-07-30T09:00:00.000Z',
    deviceLabel: 'Android',
    summary: summary(workCount),
  };
}

describe('decideSync', () => {
  it('uploads when the cloud has nothing yet', () => {
    expect(decideSync(local(12, null), null)).toEqual({ kind: 'upload', reason: 'cloud-empty' });
  });

  it('downloads onto a fresh device with an empty archive', () => {
    expect(decideSync(local(0, null), remote(3))).toEqual({
      kind: 'download',
      reason: 'local-empty',
    });
  });

  it('does nothing when both sides are at the same revision', () => {
    expect(decideSync(local(12, 7), remote(7))).toEqual({ kind: 'in-sync' });
  });

  it('downloads when this device is simply behind', () => {
    expect(decideSync(local(12, 5), remote(9))).toEqual({ kind: 'download', reason: 'behind' });
  });

  it('never merges two archives that both hold records but never synced', () => {
    // The archive cannot express a deletion, so merging would resurrect works
    // the user deleted elsewhere. A human has to choose.
    expect(decideSync(local(12, null), remote(4))).toEqual({ kind: 'conflict' });
  });

  it('treats a local revision ahead of the cloud as a conflict, not an upload', () => {
    // The cloud was reset or restored from an older copy; blindly pushing would
    // overwrite whatever is there now.
    expect(decideSync(local(12, 9), remote(4))).toEqual({ kind: 'conflict' });
  });

  it('counts an archive with only a watchlist as non-empty', () => {
    const withWatchlist: LocalArchiveMeta = {
      summary: { ...EMPTY, watchlistCount: 3 },
      syncedRevision: null,
    };
    expect(decideSync(withWatchlist, remote(2))).toEqual({ kind: 'conflict' });
  });
});

describe('describeRemote', () => {
  it('summarizes a cloud copy for the conflict dialog', () => {
    const text = describeRemote(remote(3, 42), 'ko-KR');
    expect(text).toContain('42편');
    expect(text).toContain('Android');
  });

  it('survives an unparseable timestamp', () => {
    const text = describeRemote({ ...remote(1), updatedAt: 'not-a-date' });
    expect(text).toContain('시간 알 수 없음');
  });

  it('omits the device when it is unknown', () => {
    expect(describeRemote({ ...remote(1), deviceLabel: null })).not.toContain('·  ');
  });
});

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone/iPad'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S921N)', 'Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'],
    ['', '알 수 없는 기기'],
  ])('labels %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('prefers the phone label over the desktop OS it embeds', () => {
    // iOS user agents contain "like Mac OS X" — order matters.
    expect(describeDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPhone/iPad');
  });
});
