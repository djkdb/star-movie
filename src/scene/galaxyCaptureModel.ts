/** Stats printed on the exported galaxy poster. */
export interface GalaxyPosterStats {
  starCount: number;
  planetCount: number;
  collected: number;
  total: number;
}

export const GALAXY_POSTER_TITLE = '내가 본 영화들로 만든 우주';
export const GALAXY_POSTER_EYEBROW = 'SPACE MOVIE ARCHIVE';

/** One-line stat summary shown along the bottom of the poster. */
export function galaxyStatsLine(stats: GalaxyPosterStats): string {
  return `별 ${stats.starCount}개 · 행성 ${stats.planetCount}개 · 도감 ${stats.collected}/${stats.total}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Deterministic download filename, dated. */
export function galaxyPosterFilename(date: Date): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  return `my-universe-${stamp}.png`;
}

/** Human date label rendered on the poster. */
export function galaxyPosterDateLabel(date: Date): string {
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}
