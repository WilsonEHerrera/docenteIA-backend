# security

Primitivas criptográficas compartidas: hash de contraseñas, JWT de acceso, política de contraseñas.

1. **¿Qué entra?** Contraseñas en claro, datos del usuario (`id`, `institutionId`, `role`) y tokens.
2. **¿Qué procesa?** `PasswordService` (argon2id), `TokenService` (JWT HS256 con `node:crypto`, algoritmo fijo, comparación en tiempo constante), `passwordPolicyViolation`, `randomToken`/`sha256`.
3. **¿Qué produce?** Hashes, access tokens firmados y `AuthUser` verificado.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Ninguna.
6. **¿Qué pasa si falla?** Un token malformado, manipulado o vencido devuelve `null` (→ `401`); un hash ilegible verifica como `false`.
7. **¿Cómo sabemos que funciona?** `security.spec.ts` (firma, manipulación, expiración, `alg=none`, política de contraseñas).

Requisito: `JWT_ACCESS_SECRET` de al menos 32 caracteres; rotarlo invalida todos los access tokens vigentes.
