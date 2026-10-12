# quizzes

Cuestionarios generados con IA a partir de un tema o un texto base, que el docente revisa, edita, aprueba y publica. Reglas puras en `src/domain/quiz-rules.ts`.

1. **¿Qué entra?** `{ courseId, topic?, sourceText?, count? }` para generar; ediciones de preguntas (`prompt`, `options`, `correctIndex`, `status`), preguntas escritas por el docente y la orden de publicar.
2. **¿Qué procesa?** Crea el cuestionario `GENERATING` y encola `quiz.generate`. El job llama a `QuizGenerationPort` vía `AiRunner` y valida cada pregunta con `assertValidQuestion` (forma y respuesta correcta); si no cumple, el intento falla y se reintenta.
3. **¿Qué produce?** Un `Quiz` con preguntas `PENDING_APPROVAL`, que pasan a `APPROVED`/`EDITED`/`REJECTED` solo por decisión del docente. `AuditLog`: `QUIZ_GENERATE`, `QUESTION_CREATE`, `QUESTION_UPDATE`, `QUESTIONS_APPROVE_ALL`, `QUIZ_PUBLISH`.
4. **¿Dónde está la inteligencia?** En `QuizGenerationPort` (hoy `FakeQuizGeneration`, preguntas marcadas `[FAKE]`). Solo redacta propuestas.
5. **¿Qué es automatización?** Validación de forma, bloqueo de publicación con preguntas sin decidir, congelado al publicar y la regla `gradeClosedAnswers` (cerradas por clave, sin IA).
6. **¿Qué pasa si falla?** IA caída, timeout o preguntas inválidas → `MANUAL_REQUIRED` y el docente escribe las preguntas a mano (`POST .../questions`). Al reiniciar, los `GENERATING` se re-encolan (el texto base está guardado). Cuestionario ajeno → `404`.
7. **¿Cómo sabemos que funciona?** Verificado con stubs: nace `GENERATING` y sin preguntas; el job deja 4 `PENDING_APPROVAL`; publicar con pendientes → `409`; editar → `EDITED`; `correctIndex` inválido → `400`; rechazar todas → `409`; publicado queda inmutable; IA caída o pregunta inválida → `MANUAL_REQUIRED` sin preguntas guardadas; abierta con opciones u opciones repetidas → `400`; `gradeClosedAnswers` da 2 de 3 → 3.33 e ignora las abiertas. Pendiente: specs y e2e de acceso cruzado.

Límites conocidos:

- **No hay intentos de estudiante** todavía. Falta decidir el vínculo `User` (rol `STUDENT`) ↔ `Student`; sin él nadie puede responder ni ser calificado. `gradeClosedAnswers` queda lista para cuando exista.
- **Texto, no archivos** (D24): el material base llega ya extraído.
- **Las abiertas no se califican por regla**: quedarían para el docente cuando existan los intentos.
- `TRUE_FALSE` exige exactamente las opciones `Verdadero`/`Falso`; un proveedor que devuelva otras (p. ej. `True`/`False`) cae a `MANUAL_REQUIRED`.
