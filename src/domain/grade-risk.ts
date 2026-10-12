import { Decimal } from 'decimal.js';

/** Colombian 0–5 scale: below 3.0 the student is failing. */
export const PASSING_GRADE = new Decimal('3.0');

/** A student is at risk when the running average is below the passing grade. */
export function isGradeAtRisk(average: Decimal | null): boolean {
  return average !== null && average.lessThan(PASSING_GRADE);
}
