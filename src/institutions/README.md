# institutions

La institución propia del usuario autenticado (`/institutions/me`).

1. **¿Qué entra?** El JWT (institución del usuario) y, para editar, `{ name }` de un `ADMIN`.
2. **¿Qué procesa?** Lee o actualiza solo la institución del token; nunca recibe un id por URL.
3. **¿Qué produce?** `{ id, name }` y `AuditLog` `INSTITUTION_UPDATE`.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Ninguna.
6. **¿Qué pasa si falla?** Institución inexistente o borrada → `404`; rol sin permiso → `403`.
7. **¿Cómo sabemos que funciona?** `GET /institutions/me` devuelve la institución del seed; pendiente: prueba e2e de rol.

Decisión: cada usuario pertenece a una sola institución, por eso no hay CRUD multi-institución (alta de instituciones queda para un rol de plataforma, fuera del alcance actual).
