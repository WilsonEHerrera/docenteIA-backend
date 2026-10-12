import { Decimal as BaseDecimal } from 'decimal.js';
import { DomainRuleError } from './weighted-average';

export type QuestionKind = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'OPEN';

export const TRUE_FALSE_OPTIONS: readonly string[] = ['Verdadero', 'Falso'];

export interface QuestionShape {
  type: QuestionKind;
  options: string[];
  correctIndex: number | null;
}

const invalid = (message: string): DomainRuleError =>
  new DomainRuleError('INVALID_QUESTION', message);

/**
 * A question is well-formed or it is not published. Closed questions need an
 * answer key the rule can grade against; OPEN questions have none.
 */
export function assertValidQuestion(question: QuestionShape): void {
  const { type, options, correctIndex } = question;

  if (type === 'OPEN') {
    if (options.length > 0 || correctIndex !== null) {
      throw invalid(
        'Una pregunta abierta no lleva opciones ni respuesta correcta.',
      );
    }
    return;
  }

  if (type === 'TRUE_FALSE') {
    const sameOptions =
      options.length === TRUE_FALSE_OPTIONS.length &&
      options.every((option, i) => option === TRUE_FALSE_OPTIONS[i]);
    if (!sameOptions) {
      throw invalid(
        'Verdadero/Falso solo admite las opciones "Verdadero" y "Falso".',
      );
    }
  } else {
    if (options.length < 2 || options.length > 6) {
      throw invalid(
        'Una pregunta de opción múltiple lleva entre 2 y 6 opciones.',
      );
    }
    const trimmed = options.map((option) => option.trim().toLowerCase());
    if (trimmed.some((option) => option === '')) {
      throw invalid('Las opciones no pueden estar vacías.');
    }
    if (new Set(trimmed).size !== trimmed.length) {
      throw invalid('Las opciones no pueden repetirse.');
    }
  }

  if (
    correctIndex === null ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex >= options.length
  ) {
    throw invalid('Falta una respuesta correcta válida.');
  }
}

/**
 * A quiz can be published only when the teacher has decided on every question
 * and at least one remains. Returns the reason it cannot, or null.
 */
export function publishBlocker(
  statuses: ('PENDING_APPROVAL' | 'APPROVED' | 'EDITED' | 'REJECTED')[],
): 'PENDING_QUESTIONS' | 'NO_APPROVED_QUESTIONS' | null {
  if (statuses.some((status) => status === 'PENDING_APPROVAL')) {
    return 'PENDING_QUESTIONS';
  }
  const usable = statuses.filter(
    (status) => status === 'APPROVED' || status === 'EDITED',
  );
  return usable.length === 0 ? 'NO_APPROVED_QUESTIONS' : null;
}

const Decimal = BaseDecimal.clone({
  precision: 20,
  rounding: BaseDecimal.ROUND_HALF_UP,
});

export interface ClosedQuestion {
  id: string;
  type: QuestionKind;
  correctIndex: number | null;
}

export interface ClosedGrade {
  correct: number;
  /** Closed questions that were graded (OPEN ones are left for the teacher). */
  graded: number;
  /** 0.00–5.00 over the closed questions; null when there is none. */
  score: BaseDecimal | null;
}

/**
 * Grades the closed questions by rule: an answer is right only when it equals
 * the key. Unanswered counts as wrong. Open questions are never graded here.
 */
export function gradeClosedAnswers(
  questions: ClosedQuestion[],
  answers: Map<string, number | null>,
): ClosedGrade {
  const closed = questions.filter(
    (q) => q.type !== 'OPEN' && q.correctIndex !== null,
  );
  if (closed.length === 0) return { correct: 0, graded: 0, score: null };

  const correct = closed.filter(
    (q) => answers.get(q.id) === q.correctIndex,
  ).length;
  const score = new Decimal(correct)
    .times(5)
    .dividedBy(closed.length)
    .toDecimalPlaces(2);
  return { correct, graded: closed.length, score };
}
