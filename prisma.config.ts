import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations run through DIRECT_URL (session pooler); the app uses DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? '',
  },
});
