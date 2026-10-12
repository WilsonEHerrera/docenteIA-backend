export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'OPEN';

export interface GeneratedQuestion {
  type: QuestionType;
  prompt: string;
  options: string[];
  /** Index into `options`; null for OPEN questions. */
  correctIndex: number | null;
  explanation: string;
}

export abstract class QuizGenerationPort {
  abstract readonly provider: string;
  abstract readonly promptVersion: string;
  abstract generate(input: {
    topic?: string;
    sourceText?: string;
    count: number;
  }): Promise<GeneratedQuestion[]>;
}
