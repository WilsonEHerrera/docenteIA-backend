export interface RubricLevel {
  name: string;
  score: number;
}

export interface RubricCriterion {
  id: string;
  name: string;
  levels: RubricLevel[];
}

export interface Rubric {
  criteria: RubricCriterion[];
}

export interface CriterionEvaluation {
  criterionId: string;
  level: string;
  score: number;
  justification: string;
  /** Literal excerpt of the student's text that supports the level. */
  evidenceQuote: string;
}

export interface TextEvaluationResult {
  criteria: CriterionEvaluation[];
  feedback: string;
}

/**
 * Suggests a level per criterion. It never produces the final grade:
 * that is computed by `domain/` from the criterion scores.
 */
export abstract class TextEvaluationPort {
  abstract readonly provider: string;
  abstract readonly promptVersion: string;
  abstract evaluate(input: {
    text: string;
    rubric: Rubric;
  }): Promise<TextEvaluationResult>;
}
