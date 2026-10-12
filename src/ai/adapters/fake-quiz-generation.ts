import { Injectable } from '@nestjs/common';
import {
  GeneratedQuestion,
  QuizGenerationPort,
} from '../ports/quiz-generation.port';
import { hashInt } from './fake-hash';

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

/** Deterministic stand-in for a quiz generator. Questions are plainly labelled as fake. */
@Injectable()
export class FakeQuizGeneration extends QuizGenerationPort {
  readonly provider = 'fake';
  readonly promptVersion = 'fake-v1';

  generate(input: {
    topic?: string;
    sourceText?: string;
    count: number;
  }): Promise<GeneratedQuestion[]> {
    const subject =
      input.topic?.trim() ||
      input.sourceText?.trim().slice(0, 40) ||
      'el tema indicado';
    const count = Math.max(1, Math.min(input.count, 50));

    const questions = Array.from({ length: count }, (_, index) => ({
      type: 'MULTIPLE_CHOICE' as const,
      prompt: `[FAKE] Pregunta ${index + 1} sobre ${subject}`,
      options: OPTION_LABELS.map((label) => `Opción ${label}`),
      correctIndex: hashInt(subject, String(index)) % OPTION_LABELS.length,
      explanation: '[FAKE] Pregunta de prueba; no fue generada por un modelo.',
    }));
    return Promise.resolve(questions);
  }
}
