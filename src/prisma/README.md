# prisma

`PrismaService` (cliente con driver adapter `pg`) y esquema en `/prisma`.

1. **¿Qué entra?** `DATABASE_URL` (pooler, para la app) y `DIRECT_URL` (migraciones y seed, en `prisma.config.ts`).
2. **¿Qué procesa?** Consultas parametrizadas; conexión al iniciar y cierre al apagar.
3. **¿Qué produce?** Acceso tipado a la BD para todos los módulos.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** `prisma migrate dev` / `migrate deploy` versionan el esquema; `prisma db seed` carga datos demo.
6. **¿Qué pasa si falla?** Sin BD la app no arranca limpio y `/health/ready` responde `503`.
7. **¿Cómo sabemos que funciona?** `npx prisma migrate status` al día y `/health/ready` en `200`.

Comandos: `npx prisma migrate dev --name <cambio>`, `npx prisma generate`, `npx prisma db seed` (se niega con `NODE_ENV=production`). Contraseña demo del seed: `Docentia#Demo2026` (solo desarrollo).
