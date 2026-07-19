import { describe, expect, it } from 'vitest';

import {
  galaxyPosterDateLabel,
  galaxyPosterFilename,
  galaxyStatsLine,
} from './galaxyCaptureModel';

describe('galaxy poster model', () => {
  it('formats the stat line', () => {
    expect(
      galaxyStatsLine({ starCount: 15, planetCount: 3, collected: 2, total: 42 }),
    ).toBe('별 15개 · 행성 3개 · 도감 2/42');
  });

  it('builds a dated filename and label', () => {
    const date = new Date(Date.UTC(2025, 6, 9, 12));
    expect(galaxyPosterFilename(date)).toMatch(/^my-universe-2025070\d\.png$/);
    expect(galaxyPosterDateLabel(date)).toMatch(/^2025\.07\.0\d$/);
  });

  it('zero-pads month and day', () => {
    const date = new Date(2025, 0, 5);
    expect(galaxyPosterFilename(date)).toBe('my-universe-20250105.png');
    expect(galaxyPosterDateLabel(date)).toBe('2025.01.05');
  });
});
