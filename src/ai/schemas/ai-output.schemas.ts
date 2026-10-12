import { z } from 'zod';

/**
 * What a provider is allowed to return. Anything else is treated as a failed
 * attempt: model output is never trusted before it passes these schemas.
 */
export const faceRecognitionOutput = z.object({
  matches: z.array(
    z.object({
      studentId: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  unrecognizedFaces: z.number().int().min(0),
});

export const faceEnrollmentOutput = z.object({
  embedding: z.array(z.number().finite()).min(1).max(2048),
});

export const textEvaluationOutput = z.object({
  criteria: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        level: z.string().min(1),
        score: z.number().min(0),
        justification: z.string().min(1).max(2000),
        evidenceQuote: z.string().min(1).max(500),
      }),
    )
    .min(1),
  feedback: z.string().max(4000),
});

export const quizOutput = z
  .array(
    z
      .object({
        type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'OPEN']),
        prompt: z.string().min(3).max(1000),
        options: z.array(z.string().min(1).max(300)).max(6),
        correctIndex: z.number().int().min(0).nullable(),
        explanation: z.string().max(1000),
      })
      .refine(
        (q) =>
          q.type === 'OPEN'
            ? q.correctIndex === null
            : q.options.length >= 2 &&
              q.correctIndex !== null &&
              q.correctIndex < q.options.length,
        { message: 'correctIndex inconsistente con options/type' },
      ),
  )
  .min(1)
  .max(50);
