import { Decimal as BaseDecimal } from 'decimal.js';

const Decimal = BaseDecimal.clone({
  precision: 20,
  rounding: BaseDecimal.ROUND_HALF_UP,
});

/** Arithmetic mean rounded half-up to 2 decimals; null for an empty list. */
export function mean(values: BaseDecimal.Value[]): BaseDecimal | null {
  if (values.length === 0) return null;
  const total = values.reduce<BaseDecimal>(
    (sum, value) => sum.plus(new Decimal(value)),
    new Decimal(0),
  );
  return total.dividedBy(values.length).toDecimalPlaces(2);
}

/**
 * Nearest-rank percentile (p in 1..100) of a list of numbers; null when empty.
 * p95 of [10, 20, ..., 200] (20 values) is 190.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(Math.max(p, 1), 100) / 100) * sorted.length);
  return sorted[rank - 1];
}

/** `part` out of `total` as a percentage with 1 decimal; null when `total` is 0. */
export function percentage(part: number, total: number): BaseDecimal | null {
  if (total <= 0) return null;
  return new Decimal(part).times(100).dividedBy(total).toDecimalPlaces(1);
}
