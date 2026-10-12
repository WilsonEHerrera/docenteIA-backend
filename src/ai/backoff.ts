/** Exponential backoff: 250 ms, 500 ms, 1 s, … capped at `maxMs`. `attempt` is 1-based. */
export function backoffDelayMs(
  attempt: number,
  baseMs = 250,
  maxMs = 5_000,
): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Start of the current day in Colombia (UTC-5, no DST), as a UTC instant. */
export function startOfBogotaDay(now: Date): Date {
  const offsetMs = 5 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() - offsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + offsetMs);
}
