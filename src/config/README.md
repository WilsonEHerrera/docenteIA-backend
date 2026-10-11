# config

Configuración tipada y validada con Zod (`env.schema.ts`, `AppConfig`).

1. **¿Qué entra?** Variables de entorno (`.env`; plantilla en `.env.example`).
2. **¿Qué procesa?** Valida y convierte tipos (puertos, listas CSV, enteros) con valores por defecto seguros.
3. **¿Qué produce?** `AppConfig.values` tipado, inyectable en toda la app.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** El arranque falla de inmediato si falta o es inválida una variable.
6. **¿Qué pasa si falla?** Aborta con `Configuración inválida:` y la lista de variables, sin arrancar a medias.
7. **¿Cómo sabemos que funciona?** `env.schema.spec.ts`; quitar `JWT_ACCESS_SECRET` del `.env` debe impedir el arranque.
