import { z } from 'zod';
import { textEvaluationOutput } from '../ai/schemas/ai-output.schemas';
import { quoteExistsInText } from '../domain/evidence';

export interface RubricLevelData {
  name: string;
  /** "0.00"–"5.00" */
  score: string;
}

export interface RubricCriterionData {
  id: string;
  name: string;
  weightPct: string;
  levels: RubricLevelData[];
}

export const storedLevels = z.array(
  z.object({ name: z.string(), score: z.string() }),
);

export const storedCriteria = z.array(
  z.object({
    criterionId: z.string(),
    criterionName: z.string(),
    weightPct: z.string(),
    level: z.string(),
    score: z.string(),
    justification: z.string(),
    evidenceQuote: z.string(),
  }),
);

/**
 * Provider output + business checks that depend on this rubric and this text.
 * Failing any of them makes the attempt invalid, so it is retried and, if it
 * persists, falls back to manual grading:
 *  - every criterion appears exactly once and none is invented;
 *  - the level exists in that criterion;
 *  - the evidence quote is a literal excerpt of the student's text.
 */
export function buildEvaluationSchema(
  criteria: RubricCriterionData[],
  text: string,
) {
  const byId = new Map(criteria.map((c) => [c.id, c]));

  return textEvaluationOutput.superRefine((output, ctx) => {
    const seen = new Set<string>();
    for (const item of output.criteria) {
      const criterion = byId.get(item.criterionId);
      if (!criterion) {
        ctx.addIssue({ code: 'custom', message: 'Criterio desconocido' });
        continue;
      }
      if (seen.has(item.criterionId)) {
        ctx.addIssue({ code: 'custom', message: 'Criterio repetido' });
      }
      seen.add(item.criterionId);

      if (!criterion.levels.some((level) => level.name === item.level)) {
        ctx.addIssue({ code: 'custom', message: 'Nivel inexistente' });
      }
      if (!quoteExistsInText(item.evidenceQuote, text)) {
        ctx.addIssue({
          code: 'custom',
          message: 'La cita no aparece en el texto',
        });
      }
    }
    if (seen.size !== byId.size) {
      ctx.addIssue({ code: 'custom', message: 'Faltan criterios' });
    }
  });
}
