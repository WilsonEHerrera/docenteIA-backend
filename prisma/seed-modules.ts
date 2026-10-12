import { PrismaClient } from '@prisma/client';
import { FakeFaceRecognition } from '../src/ai/adapters/fake-face-recognition';
import { weightedAverage } from '../src/domain/weighted-average';
import { FieldCipher } from '../src/security/field-cipher';
import type { AppConfig } from '../src/config/app-config';

/**
 * Demo data for attendance, consent, rubrics, submissions, AI suggestions,
 * quizzes and AI call logs. Every row has a deterministic id and is written
 * with `upsert(update: {})`, so running the seed twice changes nothing.
 *
 * Everything the "AI" produced here is labelled [FAKE] like the adapters do.
 * Course 1 (Matemáticas 10-A) has students E003, E006, E009 and E012.
 */
export interface SeedContext {
  institutionId: string;
  id: (group: number, n: number) => string;
}

const TEACHER = 3; // docente1
const ADMIN = 1;
const GUARDIAN = 5;

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string): Date => new Date(iso);

export async function seedModuleData(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<void> {
  const { institutionId: inst, id } = ctx;
  const course = id(3, 1);
  const student = (n: number): string => id(4, n);

  // --- Guardian ↔ student, consent and facial reference --------------------

  for (const n of [3, 6]) {
    await prisma.studentGuardian.upsert({
      where: {
        studentId_guardianId: {
          studentId: student(n),
          guardianId: id(1, GUARDIAN),
        },
      },
      update: {},
      create: {
        id: id(9, n),
        institutionId: inst,
        studentId: student(n),
        guardianId: id(1, GUARDIAN),
      },
    });
  }

  const consents = [
    // E003 and E006: granted by their guardian.
    { n: 3, by: GUARDIAN, role: 'GUARDIAN' as const },
    { n: 6, by: GUARDIAN, role: 'GUARDIAN' as const },
    // E009: no guardian linked, an ADMIN recorded it on their behalf.
    { n: 9, by: ADMIN, role: 'ADMIN' as const },
  ];
  for (const c of consents) {
    await prisma.biometricConsent.upsert({
      where: { id: id(10, c.n) },
      update: {},
      create: {
        id: id(10, c.n),
        institutionId: inst,
        studentId: student(c.n),
        purpose: 'FACIAL_ATTENDANCE',
        grantedById: id(1, c.by),
        grantedByRole: c.role,
        grantedAt: at('2026-09-01T14:00:00Z'),
      },
    });
  }
  // E012: consent granted and later revoked — history, no facial reference.
  await prisma.biometricConsent.upsert({
    where: { id: id(10, 12) },
    update: {},
    create: {
      id: id(10, 12),
      institutionId: inst,
      studentId: student(12),
      purpose: 'FACIAL_ATTENDANCE',
      grantedById: id(1, ADMIN),
      grantedByRole: 'ADMIN',
      grantedAt: at('2026-09-01T14:05:00Z'),
      revokedAt: at('2026-09-20T10:00:00Z'),
      revokedById: id(1, ADMIN),
    },
  });

  // Facial references are encrypted, so they need BIOMETRIC_ENCRYPTION_KEY.
  const rawKey = process.env.BIOMETRIC_ENCRYPTION_KEY?.trim();
  const keyOk =
    rawKey !== undefined && Buffer.from(rawKey, 'base64').length === 32;
  let faceReferences = 0;
  if (keyOk) {
    const cipher = new FieldCipher({
      values: { BIOMETRIC_ENCRYPTION_KEY: rawKey },
    } as unknown as AppConfig);
    const faces = new FakeFaceRecognition();
    for (const n of [3, 6, 9]) {
      const { embedding } = await faces.enroll({
        image: Buffer.from(
          `FAKE:{}\nseed-reference-E${String(n).padStart(3, '0')}`,
        ),
      });
      await prisma.faceReference.upsert({
        where: { studentId: student(n) },
        update: {},
        create: {
          id: id(11, n),
          institutionId: inst,
          studentId: student(n),
          consentId: id(10, n),
          embeddingEnc: cipher.encrypt(JSON.stringify(embedding), student(n)),
        },
      });
      faceReferences += 1;
    }
  }

  // --- Attendance ----------------------------------------------------------

  // Eight confirmed manual sessions: E006 misses all of them (8 of 10 = alert at 80 %).
  const manualDays = [
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
  ];
  for (const [index, date] of manualDays.entries()) {
    const sessionN = index + 1;
    await prisma.attendanceSession.upsert({
      where: { id: id(12, sessionN) },
      update: {},
      create: {
        id: id(12, sessionN),
        institutionId: inst,
        courseId: course,
        createdById: id(1, TEACHER),
        date: day(date),
        status: 'CONFIRMED',
        mode: 'MANUAL',
        confirmedAt: at(`${date}T13:00:00Z`),
      },
    });
    for (const n of [3, 6, 9, 12]) {
      const status =
        n === 6
          ? 'ABSENT'
          : n === 9 && index < 2
            ? 'ABSENT'
            : n === 12 && index === 4
              ? 'EXCUSED'
              : 'PRESENT';
      await prisma.attendanceRecord.upsert({
        where: { id: id(13, sessionN * 100 + n) },
        update: {},
        create: {
          id: id(13, sessionN * 100 + n),
          institutionId: inst,
          sessionId: id(12, sessionN),
          studentId: student(n),
          status,
          source: 'MANUAL',
        },
      });
    }
  }

  // A photo session the AI could process: READY, waiting for the teacher.
  await prisma.attendanceSession.upsert({
    where: { id: id(12, 9) },
    update: {},
    create: {
      id: id(12, 9),
      institutionId: inst,
      courseId: course,
      createdById: id(1, TEACHER),
      date: day('2026-10-09'),
      status: 'READY',
      mode: 'PHOTO',
      facesNotMatched: 1,
      aiRecognized: 2,
      aiUnrecognized: 1,
      notConsidered: 1,
    },
  });
  const photoRecords: {
    n: number;
    status: 'PRESENT' | 'UNRECOGNIZED';
    source: 'AI' | 'MANUAL';
    confidence: string | null;
  }[] = [
    { n: 3, status: 'PRESENT', source: 'AI', confidence: '0.971' },
    { n: 6, status: 'PRESENT', source: 'AI', confidence: '0.934' },
    // Searched for but not matched with enough confidence.
    { n: 9, status: 'UNRECOGNIZED', source: 'AI', confidence: '0.618' },
    // Not considered: no consent in force and no reference. Must be marked by hand.
    { n: 12, status: 'UNRECOGNIZED', source: 'MANUAL', confidence: null },
  ];
  for (const r of photoRecords) {
    await prisma.attendanceRecord.upsert({
      where: { id: id(13, 900 + r.n) },
      update: {},
      create: {
        id: id(13, 900 + r.n),
        institutionId: inst,
        sessionId: id(12, 9),
        studentId: student(r.n),
        status: r.status,
        source: r.source,
        confidence: r.confidence,
      },
    });
  }

  // A photo session where the AI was unavailable: everyone is marked by hand.
  await prisma.attendanceSession.upsert({
    where: { id: id(12, 10) },
    update: {},
    create: {
      id: id(12, 10),
      institutionId: inst,
      courseId: course,
      createdById: id(1, TEACHER),
      date: day('2026-10-08'),
      status: 'MANUAL_REQUIRED',
      mode: 'PHOTO',
    },
  });
  for (const n of [3, 6, 9, 12]) {
    await prisma.attendanceRecord.upsert({
      where: { id: id(13, 1000 + n) },
      update: {},
      create: {
        id: id(13, 1000 + n),
        institutionId: inst,
        sessionId: id(12, 10),
        studentId: student(n),
        status: 'UNRECOGNIZED',
        source: 'MANUAL',
      },
    });
  }

  // --- Rubric, submissions and AI suggestions (activity 1: "Taller 1") -----

  const activity = id(7, 1);
  await prisma.rubric.upsert({
    where: { activityId: activity },
    update: {},
    create: { id: id(14, 1), institutionId: inst, activityId: activity },
  });
  const levels = (low: string, mid: string, high: string) => [
    { name: low, score: '2.00' },
    { name: mid, score: '3.50' },
    { name: high, score: '5.00' },
  ];
  const criteria = [
    {
      n: 1,
      name: 'Claridad',
      weightPct: '40.00',
      levels: levels('Confusa', 'Aceptable', 'Clara'),
    },
    {
      n: 2,
      name: 'Precisión conceptual',
      weightPct: '60.00',
      levels: levels('Imprecisa', 'Parcial', 'Precisa'),
    },
  ];
  for (const c of criteria) {
    await prisma.rubricCriterion.upsert({
      where: { id: id(15, c.n) },
      update: {},
      create: {
        id: id(15, c.n),
        rubricId: id(14, 1),
        name: c.name,
        weightPct: c.weightPct,
        position: c.n - 1,
        levels: c.levels,
      },
    });
  }

  const textE012 =
    'La fotosíntesis es el proceso mediante el cual las plantas convierten la luz solar en energía química. Ocurre en los cloroplastos y produce glucosa y oxígeno.';
  const textE009 =
    'Las plantas usan la luz para producir su alimento. En las hojas hay clorofila que absorbe la luz y así se forma el azúcar.';
  const textE003 = 'Entrego mi taller resuelto a mano; ver hoja adjunta.';

  const submissions = [
    { n: 12, text: textE012, status: 'SUGGESTED' as const },
    { n: 9, text: textE009, status: 'SUGGESTED' as const },
    // The AI could not evaluate it: graded by hand (E003 has a manual grade).
    { n: 3, text: textE003, status: 'MANUAL_REQUIRED' as const },
  ];
  for (const s of submissions) {
    await prisma.submission.upsert({
      where: { id: id(16, s.n) },
      update: {},
      create: {
        id: id(16, s.n),
        institutionId: inst,
        activityId: activity,
        studentId: student(s.n),
        text: s.text,
        status: s.status,
      },
    });
  }

  const resultsFor = (
    picks: {
      criterion: number;
      level: number;
      justification: string;
      quote: string;
    }[],
  ) =>
    picks.map((p) => {
      const criterion = criteria[p.criterion];
      const level = criterion.levels[p.level];
      return {
        criterionId: id(15, criterion.n),
        criterionName: criterion.name,
        weightPct: criterion.weightPct,
        level: level.name,
        score: level.score,
        justification: p.justification,
        evidenceQuote: p.quote,
      };
    });
  const scoreOf = (results: { score: string; weightPct: string }[]): string =>
    weightedAverage(
      results.map((r) => ({ value: r.score, weightPct: r.weightPct })),
    ).toFixed(2);

  // E012: pending the teacher's decision.
  const pending = resultsFor([
    {
      criterion: 0,
      level: 1,
      justification:
        '[FAKE] La idea central es comprensible pero la redacción es escueta.',
      quote: 'las plantas convierten la luz solar en energía química',
    },
    {
      criterion: 1,
      level: 2,
      justification: '[FAKE] Identifica el lugar y los productos del proceso.',
      quote: 'produce glucosa y oxígeno',
    },
  ]);
  await prisma.aiSuggestion.upsert({
    where: { id: id(17, 12) },
    update: {},
    create: {
      id: id(17, 12),
      institutionId: inst,
      submissionId: id(16, 12),
      status: 'PENDING_APPROVAL',
      suggestedScore: scoreOf(pending),
      feedback:
        '[FAKE] Retroalimentación de prueba: buen resumen; amplía el papel de la clorofila.',
      criteria: pending,
      provider: 'fake',
      promptVersion: 'fake-v1',
    },
  });

  // E009: the teacher corrected the suggestion (final 3.80, matches the gradebook).
  const edited = resultsFor([
    {
      criterion: 0,
      level: 2,
      justification: '[FAKE] Explicación ordenada y fácil de seguir.',
      quote: 'En las hojas hay clorofila que absorbe la luz',
    },
    {
      criterion: 1,
      level: 1,
      justification:
        '[FAKE] Nombra la clorofila pero no explica el producto final.',
      quote: 'así se forma el azúcar',
    },
  ]);
  await prisma.aiSuggestion.upsert({
    where: { id: id(17, 9) },
    update: {},
    create: {
      id: id(17, 9),
      institutionId: inst,
      submissionId: id(16, 9),
      status: 'EDITED',
      suggestedScore: scoreOf(edited),
      finalScore: '3.80',
      feedback:
        'Buen intento; falta explicar qué se produce además del azúcar.',
      criteria: edited,
      provider: 'fake',
      promptVersion: 'fake-v1',
      decidedById: id(1, TEACHER),
      decidedAt: at('2026-10-10T15:30:00Z'),
    },
  });

  // --- Quizzes -------------------------------------------------------------

  const quizzes = [
    {
      n: 1,
      title: 'Cuestionario: Fotosíntesis',
      topic: 'Fotosíntesis',
      status: 'PUBLISHED' as const,
      publishedAt: at('2026-10-06T16:00:00Z'),
    },
    {
      n: 2,
      title: 'Cuestionario: Células',
      topic: 'Células',
      status: 'DRAFT' as const,
      publishedAt: null,
    },
    {
      n: 3,
      title: 'Cuestionario: Átomos',
      topic: 'Átomos',
      status: 'MANUAL_REQUIRED' as const,
      publishedAt: null,
    },
  ];
  for (const q of quizzes) {
    await prisma.quiz.upsert({
      where: { id: id(18, q.n) },
      update: {},
      create: {
        id: id(18, q.n),
        institutionId: inst,
        courseId: course,
        createdById: id(1, TEACHER),
        title: q.title,
        topic: q.topic,
        requestedCount: 4,
        status: q.status,
        // Quiz 3 is the case where the AI failed and the teacher writes by hand.
        provider: q.n === 3 ? null : 'fake',
        promptVersion: q.n === 3 ? null : 'fake-v1',
        publishedAt: q.publishedAt,
      },
    });
  }

  const tf = ['Verdadero', 'Falso'];
  const questions = [
    // Quiz 1 (published): AI approved / AI edited / AI rejected / teacher-written open.
    {
      n: 1,
      quiz: 1,
      pos: 0,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: '[FAKE] ¿Qué gas absorben las plantas durante la fotosíntesis?',
      options: ['Oxígeno', 'Dióxido de carbono', 'Nitrógeno', 'Hidrógeno'],
      correct: 1,
      status: 'APPROVED' as const,
      origin: 'AI' as const,
    },
    {
      n: 2,
      quiz: 1,
      pos: 1,
      type: 'TRUE_FALSE' as const,
      prompt: 'La fotosíntesis ocurre en los cloroplastos.',
      options: tf,
      correct: 0,
      status: 'EDITED' as const,
      origin: 'AI' as const,
    },
    {
      n: 3,
      quiz: 1,
      pos: 2,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: '[FAKE] ¿Cuál es el color del cielo en Marte?',
      options: ['Azul', 'Rojo', 'Verde'],
      correct: 0,
      status: 'REJECTED' as const,
      origin: 'AI' as const,
    },
    {
      n: 4,
      quiz: 1,
      pos: 3,
      type: 'OPEN' as const,
      prompt:
        'Explica con tus palabras por qué la fotosíntesis es importante para la vida.',
      options: [] as string[],
      correct: null,
      status: 'APPROVED' as const,
      origin: 'TEACHER' as const,
    },
    // Quiz 2 (draft): all waiting for the teacher.
    {
      n: 5,
      quiz: 2,
      pos: 0,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: '[FAKE] ¿Qué orgánulo produce energía en la célula?',
      options: ['Núcleo', 'Mitocondria', 'Ribosoma', 'Vacuola'],
      correct: 1,
      status: 'PENDING_APPROVAL' as const,
      origin: 'AI' as const,
    },
    {
      n: 6,
      quiz: 2,
      pos: 1,
      type: 'TRUE_FALSE' as const,
      prompt: '[FAKE] Todas las células tienen núcleo.',
      options: tf,
      correct: 1,
      status: 'PENDING_APPROVAL' as const,
      origin: 'AI' as const,
    },
    {
      n: 7,
      quiz: 2,
      pos: 2,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: '[FAKE] ¿Qué estructura rodea a la célula animal?',
      options: ['Pared celular', 'Membrana plasmática', 'Cápsula'],
      correct: 1,
      status: 'PENDING_APPROVAL' as const,
      origin: 'AI' as const,
    },
  ];
  for (const q of questions) {
    const decided = q.status !== 'PENDING_APPROVAL';
    await prisma.quizQuestion.upsert({
      where: { id: id(19, q.n) },
      update: {},
      create: {
        id: id(19, q.n),
        quizId: id(18, q.quiz),
        position: q.pos,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correct,
        explanation:
          q.origin === 'AI'
            ? '[FAKE] Pregunta de prueba; no fue generada por un modelo.'
            : '',
        origin: q.origin,
        status: q.status,
        decidedById: decided ? id(1, TEACHER) : null,
        decidedAt: decided ? at('2026-10-06T15:45:00Z') : null,
      },
    });
  }

  // --- AI call log (what the metrics endpoint aggregates) -------------------

  const calls: {
    n: number;
    kind:
      | 'FACE_ENROLLMENT'
      | 'FACE_RECOGNITION'
      | 'TEXT_EVALUATION'
      | 'QUIZ_GENERATION';
    success: boolean;
    attempts: number;
    latencyMs: number;
    errorCode: string | null;
    when: string;
  }[] = [
    {
      n: 1,
      kind: 'FACE_ENROLLMENT',
      success: true,
      attempts: 1,
      latencyMs: 120,
      errorCode: null,
      when: '2026-10-05T14:00:00Z',
    },
    {
      n: 2,
      kind: 'FACE_ENROLLMENT',
      success: true,
      attempts: 1,
      latencyMs: 140,
      errorCode: null,
      when: '2026-10-05T14:01:00Z',
    },
    {
      n: 3,
      kind: 'FACE_ENROLLMENT',
      success: true,
      attempts: 1,
      latencyMs: 110,
      errorCode: null,
      when: '2026-10-05T14:02:00Z',
    },
    {
      n: 4,
      kind: 'FACE_RECOGNITION',
      success: true,
      attempts: 1,
      latencyMs: 820,
      errorCode: null,
      when: '2026-10-09T13:00:00Z',
    },
    {
      n: 5,
      kind: 'FACE_RECOGNITION',
      success: false,
      attempts: 3,
      latencyMs: 45200,
      errorCode: 'TIMEOUT',
      when: '2026-10-08T13:00:00Z',
    },
    {
      n: 6,
      kind: 'TEXT_EVALUATION',
      success: true,
      attempts: 1,
      latencyMs: 2300,
      errorCode: null,
      when: '2026-10-10T14:00:00Z',
    },
    {
      n: 7,
      kind: 'TEXT_EVALUATION',
      success: true,
      attempts: 2,
      latencyMs: 5100,
      errorCode: null,
      when: '2026-10-10T14:01:00Z',
    },
    {
      n: 8,
      kind: 'TEXT_EVALUATION',
      success: false,
      attempts: 3,
      latencyMs: 9800,
      errorCode: 'INVALID_OUTPUT',
      when: '2026-10-10T14:02:00Z',
    },
    {
      n: 9,
      kind: 'QUIZ_GENERATION',
      success: true,
      attempts: 1,
      latencyMs: 3100,
      errorCode: null,
      when: '2026-10-06T15:30:00Z',
    },
    {
      n: 10,
      kind: 'QUIZ_GENERATION',
      success: true,
      attempts: 1,
      latencyMs: 2800,
      errorCode: null,
      when: '2026-10-07T15:30:00Z',
    },
    {
      n: 11,
      kind: 'QUIZ_GENERATION',
      success: false,
      attempts: 3,
      latencyMs: 7400,
      errorCode: 'PROVIDER_ERROR',
      when: '2026-10-07T16:00:00Z',
    },
  ];
  for (const c of calls) {
    await prisma.aiCallLog.upsert({
      where: { id: id(20, c.n) },
      update: {},
      create: {
        id: id(20, c.n),
        institutionId: inst,
        userId: id(1, TEACHER),
        kind: c.kind,
        provider: 'fake',
        promptVersion:
          c.kind === 'TEXT_EVALUATION' || c.kind === 'QUIZ_GENERATION'
            ? 'fake-v1'
            : null,
        success: c.success,
        attempts: c.attempts,
        latencyMs: c.latencyMs,
        errorCode: c.errorCode,
        createdAt: at(c.when),
      },
    });
  }

  console.log(
    `Datos de módulos: ${manualDays.length + 2} sesiones de asistencia, ` +
      `${consents.length + 1} consentimientos, ${faceReferences} referencias faciales` +
      (keyOk
        ? ''
        : ' (sin BIOMETRIC_ENCRYPTION_KEY: no se crearon referencias)') +
      `, 1 rúbrica, ${submissions.length} entregas, 2 sugerencias, ` +
      `${quizzes.length} cuestionarios, ${calls.length} llamadas de IA.`,
  );
}
