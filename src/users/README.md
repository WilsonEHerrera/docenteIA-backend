# users

Gestión de usuarios de la institución (solo `ADMIN`).

1. **¿Qué entra?** `CreateUserDto` (correo, nombre, rol, contraseña) y `UpdateUserDto` (nombre, rol, `isActive`, `unlock`, `password`).
2. **¿Qué procesa?** Valida la política de contraseñas, la hashea con argon2id, aplica el cambio filtrando por `institutionId` del admin y calcula el `diff`.
3. **¿Qué produce?** `UserView` (nunca `passwordHash`), `AuditLog` (`USER_CREATE`, `USER_UPDATE`, `USER_ROLE_CHANGE`, `USER_SESSIONS_REVOKED`).
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Cambiar rol, desactivar o cambiar contraseña revoca las sesiones del usuario automáticamente.
6. **¿Qué pasa si falla?** Correo repetido → `409`; contraseña débil → `400 WEAK_PASSWORD`; usuario de otra institución → `404`; el admin no puede desactivarse ni cambiarse el rol (`SELF_CHANGE_FORBIDDEN`).
7. **¿Cómo sabemos que funciona?** Revisando `GET /users` y `GET /audit` tras cada cambio; pendiente: pruebas e2e de aislamiento por institución y de roles.
