import { Injectable } from '@nestjs/common';
import {
  Rubric,
  TextEvaluationPort,
  TextEvaluationResult,
} from '../ports/text-evaluation.port';
import { hashInt } from './fake-hash';

const QUOTE_LENGTH = 80;

/** Deterministic stand-in for an LLM rubric evaluator. Its output is plainly labelled as fake. */
@Injectable()
export class FakeTextEvaluation extends TextEvaluationPort {
  readonly provider = 'fake';
  readonly promptVersion = 'fake-v1';

  evaluate(input: {
    text: string;
    rubric: Rubric;
  }): Promise<TextEvaluationResult> {
    const { text, rubric } = input;
    if (text.trim() === '') {
      return Promise.reject(new Error('FakeTextEvaluation: empty text'));
    }

    const criteria = rubric.criteria.map((criterion) => {
      if (criterion.levels.length === 0) {
        throw new Error(
          `FakeTextEvaluation: criterion ${criterion.id} has no levels`,
        );
      }
      const level =
        criterion.levels[hashInt(text, criterion.id) % criterion.levels.length];
      return {
        criterionId: criterion.id,
        level: level.name,
        score: level.score,
        justification: `[FAKE] Nivel "${level.name}" asignado de forma determinística para "${criterion.name}".`,
        evidenceQuote: this.quote(text, criterion.id),
      };
    });

    return Promise.resolve({
      criteria,
      feedback:
        '[FAKE] Retroalimentación de prueba generada por el adaptador determinístico; no proviene de un modelo real.',
    });
  }

  /** A literal excerpt of the text, so citation checks behave like with a real provider. */
  private quote(text: string, criterionId: string): string {
    if (text.length <= QUOTE_LENGTH) return text.trim();
    const start =
      hashInt(text, criterionId, 'quote') % (text.length - QUOTE_LENGTH);
    const excerpt = text.slice(start, start + QUOTE_LENGTH).trim();
    return excerpt === '' ? text.trim().slice(0, QUOTE_LENGTH) : excerpt;
  }
}
