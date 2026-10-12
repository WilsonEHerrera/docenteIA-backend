export type AttendanceStatusValue =
  'PRESENT' | 'ABSENT' | 'UNRECOGNIZED' | 'EXCUSED';

/** Statuses a teacher may set by hand. UNRECOGNIZED is only produced by the AI flow. */
export const MANUAL_STATUSES: readonly AttendanceStatusValue[] = [
  'PRESENT',
  'ABSENT',
  'EXCUSED',
];

/**
 * Outcome of a face match. Fail-safe (rule 4): a face that is not recognized
 * with enough confidence is UNRECOGNIZED, never ABSENT. Only the teacher can
 * turn it into an absence.
 */
export function classifyFaceMatch(
  confidence: number,
  threshold: number,
): 'PRESENT' | 'UNRECOGNIZED' {
  return confidence >= threshold ? 'PRESENT' : 'UNRECOGNIZED';
}

/** Only ABSENT is a "falla"; EXCUSED and PRESENT do not count. */
export function countsAsAbsence(status: AttendanceStatusValue): boolean {
  return status === 'ABSENT';
}

export function countAbsences(statuses: AttendanceStatusValue[]): number {
  return statuses.filter(countsAsAbsence).length;
}

/**
 * Fail-safe (rule 4): an unrecognized face is never turned into an absence
 * automatically, so a session with any UNRECOGNIZED record cannot be confirmed.
 */
export function hasUnresolvedRecords(
  statuses: AttendanceStatusValue[],
): boolean {
  return statuses.some((status) => status === 'UNRECOGNIZED');
}
