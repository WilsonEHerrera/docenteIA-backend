import { Decimal as BaseDecimal } from 'decimal.js';

/** Isolated copy so rounding config never leaks into (or from) other Decimal users. */
const Decimal = BaseDecimal.clone({
  precision: 20,
  rounding: BaseDecimal.ROUND_HALF_UP,
});
type Decimal = BaseDecimal;

export const MIN_GRADE = new Decimal(0);
export const MAX_GRADE = new Decimal(5);
export const WEIGHT_TOTAL = new Decimal(100);
const SCALE = 2;

export interface WeightedItem {
  value: BaseDecimal.Value;
  weightPct: BaseDecimal.Value;
}

export interface PartialAverage {
  average: Decimal;
  /** Sum of the weights that actually contributed (0–100). */
  coveredWeightPct: Decimal;
}

export type DomainRuleCode =
  'INVALID_GRADE' | 'INVALID_WEIGHT' | 'WEIGHTS_NOT_100' | 'INVALID_QUESTION';

/** Business-rule violation. Framework-agnostic; the service layer maps it to HTTP. */
export class DomainRuleError extends Error {
  constructor(
    readonly code: DomainRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainRuleError';
  }
}

const toDecimal = (input: BaseDecimal.Value, code: DomainRuleCode): Decimal => {
  try {
    const decimal = new Decimal(input);
    if (decimal.isFinite()) return decimal;
  } catch {
    // falls through to the rule error below
  }
  throw new DomainRuleError(code, `Valor numérico inválido: ${String(input)}`);
};

/** Parses a grade and enforces the 0.00–5.00 scale. */
export function parseGrade(input: BaseDecimal.Value): Decimal {
  const value = toDecimal(input, 'INVALID_GRADE');
  if (value.lessThan(MIN_GRADE) || value.greaterThan(MAX_GRADE)) {
    throw new DomainRuleError(
      'INVALID_GRADE',
      `La nota debe estar entre ${MIN_GRADE.toString()} y ${MAX_GRADE.toString()}.`,
    );
  }
  return value;
}

/** Parses an activity weight: greater than 0 and at most 100. */
export function parseWeight(input: BaseDecimal.Value): Decimal {
  const weight = toDecimal(input, 'INVALID_WEIGHT');
  if (weight.lessThanOrEqualTo(0) || weight.greaterThan(WEIGHT_TOTAL)) {
    throw new DomainRuleError(
      'INVALID_WEIGHT',
      'El porcentaje debe ser mayor que 0 y no superar 100.',
    );
  }
  return weight;
}

export function sumWeights(weights: BaseDecimal.Value[]): Decimal {
  return weights.reduce<Decimal>(
    (total, weight) => total.plus(parseWeight(weight)),
    new Decimal(0),
  );
}

/**
 * Final weighted average of a full period: weights must add up to exactly 100.
 * [4.0 @ 30, 3.5 @ 30, 4.5 @ 40] → 4.05
 */
export function weightedAverage(items: WeightedItem[]): Decimal {
  const total = sumWeights(items.map((item) => item.weightPct));
  if (!total.equals(WEIGHT_TOTAL)) {
    throw new DomainRuleError(
      'WEIGHTS_NOT_100',
      `Los porcentajes deben sumar 100 (suman ${total.toString()}).`,
    );
  }
  const weighted = items.reduce<Decimal>(
    (sum, item) =>
      sum.plus(parseGrade(item.value).times(parseWeight(item.weightPct))),
    new Decimal(0),
  );
  return weighted.dividedBy(WEIGHT_TOTAL).toDecimalPlaces(SCALE);
}

/**
 * Running average over the activities graded so far: weights are re-based on
 * the graded subset. Returns null when nothing has been graded yet.
 */
export function partialWeightedAverage(
  items: WeightedItem[],
): PartialAverage | null {
  if (items.length === 0) return null;
  const covered = sumWeights(items.map((item) => item.weightPct));
  const weighted = items.reduce<Decimal>(
    (sum, item) =>
      sum.plus(parseGrade(item.value).times(parseWeight(item.weightPct))),
    new Decimal(0),
  );
  return {
    average: weighted.dividedBy(covered).toDecimalPlaces(SCALE),
    coveredWeightPct: covered,
  };
}
