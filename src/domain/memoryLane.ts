import type { Star } from './models';

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * The local calendar date exactly one month before today, clamping the day to
 * the shorter month's end (3/31 -> 2/28), formatted as YYYY-MM-DD.
 */
export function monthAgoLocalDate(today: Date): string {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const lastDayOfPreviousMonth = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfPreviousMonth);
  const anchor = new Date(year, month - 1, clampedDay);
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}`;
}

/** Today's local calendar date as YYYY-MM-DD (never UTC-shifted). */
export function todayLocalDate(today: Date): string {
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
}

/** Works watched exactly one month ago today, for a gentle memory note. */
export function selectMonthAgoMemories(
  stars: readonly Star[],
  today: Date,
): Star[] {
  const anchor = monthAgoLocalDate(today);
  return stars.filter((star) => star.watchedDate === anchor);
}
