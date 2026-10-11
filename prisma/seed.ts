import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient, Role, Weekday } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('El seed de demo no se ejecuta en producción.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  }),
});

const INSTITUTION_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_PASSWORD = 'Docentia#Demo2026';

// Deterministic ids keep the seed idempotent.
const id = (group: number, n: number): string =>
  `00000000-0000-4000-8000-${String(group).padStart(4, '0')}${String(n).padStart(8, '0')}`;

async function main(): Promise<void> {
  await prisma.institution.upsert({
    where: { id: INSTITUTION_ID },
    update: {},
    create: { id: INSTITUTION_ID, name: 'Institución Demo DocentIA' },
  });

  const users = [
    { n: 1, email: 'admin@demo.docentia.test', fullName: 'Admin Demo', role: Role.ADMIN },
    { n: 2, email: 'coordinador@demo.docentia.test', fullName: 'Coordinadora Demo', role: Role.COORDINATOR },
    { n: 3, email: 'docente1@demo.docentia.test', fullName: 'Docente Uno', role: Role.TEACHER },
    { n: 4, email: 'docente2@demo.docentia.test', fullName: 'Docente Dos', role: Role.TEACHER },
  ];
  // Demo-only credential (the seed refuses to run in production).
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });
  for (const { n, ...data } of users) {
    await prisma.user.upsert({
      where: { email: data.email },
      update: { passwordHash },
      create: {
        id: id(1, n),
        institutionId: INSTITUTION_ID,
        passwordHash,
        ...data,
      },
    });
  }

  const subjects = [
    { n: 1, code: 'MAT101', name: 'Matemáticas' },
    { n: 2, code: 'LEN101', name: 'Lenguaje' },
    { n: 3, code: 'CIE101', name: 'Ciencias' },
  ];
  for (const s of subjects) {
    await prisma.subject.upsert({
      where: { institutionId_code: { institutionId: INSTITUTION_ID, code: s.code } },
      update: {},
      create: { id: id(2, s.n), institutionId: INSTITUTION_ID, code: s.code, name: s.name },
    });
  }

  const courses = [
    { n: 1, subject: 1, teacher: 3, name: 'Matemáticas 10-A' },
    { n: 2, subject: 2, teacher: 3, name: 'Lenguaje 10-A' },
    { n: 3, subject: 3, teacher: 4, name: 'Ciencias 10-B' },
  ];
  for (const c of courses) {
    await prisma.course.upsert({
      where: { id: id(3, c.n) },
      update: {},
      create: {
        id: id(3, c.n),
        institutionId: INSTITUTION_ID,
        subjectId: id(2, c.subject),
        teacherId: id(1, c.teacher),
        name: c.name,
        period: '2026-1',
        maxAbsences: 10,
      },
    });
  }

  for (let n = 1; n <= 12; n++) {
    const code = `E${String(n).padStart(3, '0')}`;
    await prisma.student.upsert({
      where: { institutionId_code: { institutionId: INSTITUTION_ID, code } },
      update: {},
      create: {
        id: id(4, n),
        institutionId: INSTITUTION_ID,
        code,
        fullName: `Estudiante ${n}`,
      },
    });
    const courseN = (n % 3) + 1;
    await prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId: id(3, courseN), studentId: id(4, n) } },
      update: {},
      create: {
        id: id(5, n),
        institutionId: INSTITUTION_ID,
        courseId: id(3, courseN),
        studentId: id(4, n),
      },
    });
  }

  const days = [Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY];
  for (let c = 1; c <= 3; c++) {
    await prisma.schedule.upsert({
      where: { id: id(6, c) },
      update: {},
      create: {
        id: id(6, c),
        institutionId: INSTITUTION_ID,
        courseId: id(3, c),
        weekday: days[c - 1],
        startTime: '07:00',
        endTime: '09:00',
        room: `Aula ${100 + c}`,
      },
    });
  }

  console.log('Seed completado.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
