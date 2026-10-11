# auth

Login, sesión con refresh rotativo, logout y recuperación de contraseña.

1. **¿Qué entra?** `email` + `password` (login); la cookie `docentia_rt` (refresh/logout); `email` (forgot); `token` + `newPassword` (reset).
2. **¿Qué procesa?** Verifica argon2id, cuenta intentos fallidos, emite un access JWT (15 min) y un refresh opaco guardado **hasheado** (SHA-256) en `refresh_tokens`, agrupado por `familyId`.
3. **¿Qué produce?** `{ accessToken, expiresIn, user }` + cookie `httpOnly; SameSite=Strict; Path=/api/v1/auth`. Filas de `AuditLog` por cada evento.
4. **¿Dónde está la inteligencia?** En ninguna parte: no usa IA.
5. **¿Qué es automatización?** Bloqueo temporal tras `LOGIN_MAX_ATTEMPTS`, rotación del refresh, revocación de la familia si se reutiliza un token viejo, revocación de sesiones al resetear la contraseña.
6. **¿Qué pasa si falla?** Credenciales inválidas → `401` genérico idéntico exista o no el correo. Cuenta bloqueada → `423`. Fallo al escribir auditoría no rompe el login (se registra en logs). Sin proveedor de correo, `forgot-password` no entrega el enlace (llega con `notifications`, Fase 2).
7. **¿Cómo sabemos que funciona?** Verificación manual con `POST /auth/login` y `refresh` (ver `docs/PRUEBAS_Y_OPERACION.md`); pendiente: pruebas e2e de rotación/reuso, bloqueo y reset.

Notas de seguridad: `refresh`/`logout` son `@Public` a nivel JWT porque el access puede estar vencido; se protegen con la cookie y la verificación de `Origin`. Rate limit en memoria por instancia (`AUTH_RATE_LIMIT_PER_MIN`).
