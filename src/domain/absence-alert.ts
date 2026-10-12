export const DEFAULT_ALERT_THRESHOLD_PCT = 80;

/** Share of the allowed absences already used, as a whole percentage (may exceed 100). */
export function absenceUsagePct(absences: number, maxAbsences: number): number {
  if (maxAbsences <= 0) return absences > 0 ? 100 : 0;
  return Math.floor((absences * 100) / maxAbsences);
}

/**
 * True once the student has used `thresholdPct` % of the allowed absences.
 * Integer math only: 8 of 10 at 80 % → true, 7 of 10 → false.
 */
export function shouldAlert(
  absences: number,
  maxAbsences: number,
  thresholdPct: number = DEFAULT_ALERT_THRESHOLD_PCT,
): boolean {
  if (absences <= 0) return false;
  if (maxAbsences <= 0) return true;
  return absences * 100 >= maxAbsences * thresholdPct;
}
