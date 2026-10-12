# consent

Consentimiento biométrico de menores, vínculo acudiente↔estudiante y referencia facial cifrada. Es la puerta que decide quién puede llegar al reconocimiento facial.

1. **¿Qué entra?** Consentimiento (`{purpose, accepted}`), vínculo de acudiente (`{userId}`) y la foto de referencia como cuerpo crudo `image/jpeg` o `image/png`.
2. **¿Qué procesa?** Verifica quién actúa (ADMIN de la institución o acudiente **vinculado**), la imagen por sus bytes y que haya consentimiento vigente. Pide a `FaceRecognitionPort.enroll` la representación facial vía `AiRunner`, la cifra con `FieldCipher` (AES-256-GCM, ligada al `studentId`) y la guarda.
3. **¿Qué produce?** `ConsentView`, estado del consentimiento, tabla por curso (`eligible`) y la referencia cifrada. Auditoría: `CONSENT_GRANT`, `CONSENT_REVOKE`, `FACE_REFERENCE_REGISTER/DELETE`, `GUARDIAN_LINK/UNLINK`. `candidatesFor()` entrega a la asistencia facial (3.3) solo estudiantes con consentimiento vigente **y** referencia.
4. **¿Dónde está la inteligencia?** Solo en `enroll` (hoy `FakeFaceRecognition`), que extrae una representación de la foto. Las decisiones de acceso son reglas fijas.
5. **¿Qué es automatización?** Revocar el consentimiento borra la referencia facial en la misma transacción; el filtrado de candidatos es automático.
6. **¿Qué pasa si falla?** Sin consentimiento → `409`, y nada se envía a la IA. Sin clave de cifrado → `503`, sin tocar la IA. IA caída → `503 AI_UNAVAILABLE` (se reintenta más tarde). Una referencia que no se puede descifrar se omite, nunca se adivina. Estudiante ajeno o acudiente no vinculado → `404`.
7. **¿Cómo sabemos que funciona?** Verificado a mano con stubs: consentir es idempotente; registrar sin consentimiento da `409`; el texto plano no aparece en lo guardado; un cifrado movido a otro estudiante o alterado no se descifra; revocar deja 0 referencias y 0 candidatos conservando la constancia; una referencia huérfana sin consentimiento nunca es candidata. Pendiente: specs y e2e de acceso cruzado.

Notas:

- **La foto no se guarda** (D22): se procesa en memoria y se descarta. Solo persiste la representación cifrada.
- **Clave:** `BIOMETRIC_ENCRYPTION_KEY` (32 bytes en base64). Si se pierde, las referencias existentes quedan inservibles y hay que registrarlas de nuevo; no hay rotación automática todavía.
- **Un propósito** por ahora (`FACIAL_ATTENDANCE`). Añadir otros es agregar el valor del enum.
- El estudiante adulto no puede consentir por sí mismo: no hay vínculo `User`↔`Student`. Mientras tanto lo registra un ADMIN.
- Con el proveedor `fake`, una foto que empiece por `FAKE:` se acepta en lugar de JPEG/PNG real para poder probar el flujo.
