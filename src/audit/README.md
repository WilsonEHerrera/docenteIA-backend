# audit

Registro de accesos y cambios sensibles (`AuditLog`) y su consulta para `ADMIN`.

1. **¿Qué entra?** Llamadas a `AuditService.record()` desde auth, users y academic, y metadatos `@Audit({ action, resource })` leídos por `AuditInterceptor`.
2. **¿Qué procesa?** Guarda usuario, institución, acción, recurso, IP y un `diff` opcional. No almacena contraseñas, tokens ni biometría.
3. **¿Qué produce?** Filas en `audit_logs` y `GET /audit` paginado con filtros `userId`, `action`, `from`, `to`.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** El interceptor registra automáticamente las altas decoradas con `@Audit`.
6. **¿Qué pasa si falla?** `record()` nunca lanza: si la escritura falla se deja un error en logs y la petición del usuario continúa.
7. **¿Cómo sabemos que funciona?** Tras un login o una alta, la acción aparece en `GET /audit`.

Pendiente de fases siguientes: `AuditLog` de cambios de notas (Fase 2) y de aprobaciones de IA/consentimientos (Fase 3).
