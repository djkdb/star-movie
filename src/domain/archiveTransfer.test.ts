import { describe, expect, it } from 'vitest';

import {
  buildBackupFileName,
  parseBackupFile,
  serializeArchiveForBackup,
  summarizeArchive,
} from './archiveTransfer';
import { createDefaultStore } from './defaultState';

const BASE = createDefaultStore(true).persisted;

describe('archiveTransfer', () => {
  it('names the backup file by the local date', () => {
    // Month is zero-based in Date; the name must read as a real calendar day.
    expect(buildBackupFileName(new Date(2026, 6, 30))).toBe('asteron-backup-2026-07-30.json');
    expect(buildBackupFileName(new Date(2026, 0, 5))).toBe('asteron-backup-2026-01-05.json');
  });

  it('round-trips an archive through serialize → parse unchanged', () => {
    const text = serializeArchiveForBackup(BASE);
    const result = parseBackupFile(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(BASE);
    expect(result.summary).toEqual(summarizeArchive(BASE));
  });

  it('summarizes every collection the confirmation dialog shows', () => {
    expect(summarizeArchive(BASE)).toEqual({
      workCount: BASE.stars.length,
      constellationCount: BASE.constellations.length,
      archivedCount: BASE.blackholeArchive.length,
      watchlistCount: BASE.watchlist.length,
      planetCount: BASE.planetCollection.planets.length,
    });
  });

  it('rejects an empty file with a plain-language reason', () => {
    const result = parseBackupFile('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('비어');
  });

  it('rejects a file that is not JSON', () => {
    const result = parseBackupFile('this is not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('.json');
  });

  it('rejects JSON that is not an Asteron archive', () => {
    const result = parseBackupFile(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('백업 파일');
  });

  it('rejects a corrupted archive rather than importing partial data', () => {
    const broken = { ...structuredClone(BASE), stars: [{ id: 'only-an-id' }] };
    const result = parseBackupFile(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });
});
