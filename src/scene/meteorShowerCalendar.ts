/**
 * Nights of the year's three great meteor showers (local calendar): the
 * Quadrantids, Perseids and Geminids. On these nights the background sky
 * sends shooting stars far more often.
 */
const SHOWER_NIGHTS: readonly { month: number; days: readonly number[] }[] = [
  { month: 1, days: [3, 4] },
  { month: 8, days: [11, 12, 13] },
  { month: 12, days: [13, 14] },
];

export function isMeteorShowerNight(today: Date): boolean {
  const month = today.getMonth() + 1;
  const day = today.getDate();
  return SHOWER_NIGHTS.some(
    (shower) => shower.month === month && shower.days.includes(day),
  );
}

/** Interval scale on shower nights: meteors arrive about four times as often. */
export function meteorIntervalScale(today: Date): number {
  return isMeteorShowerNight(today) ? 0.25 : 1;
}
