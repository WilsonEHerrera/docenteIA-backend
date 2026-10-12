# submissions

Rúbricas, entregas de estudiantes y sugerencias de calificación de la IA que el docente aprueba, edita o rechaza.

1. **¿Qué entra?** Rúbrica (`criteria` con `weightPct` y `levels`), entregas como texto ya extraído (`items[{studentId, text}]`) y la decisión del docente (`approve`, `edit {finalScore, feedback}`, `reject`).
2. **¿Qué procesa?** Guarda el texto y encola `submission.evaluate`. El job llama a `TextEvaluationPort` a través de `AiRunner` y valida la salida contra **esta** rúbrica y **este** texto: todos los criterios exactos, niveles existentes y cita literal. El puntaje de cada criterio sale del nivel de la rúbrica; la sugerencia final la calcula `weightedAverage` de `domain/`.
3. **¿Qué produce?** `AiSuggestion` en `PENDING_APPROVAL` con puntaje, justificación y cita por criterio. Solo al aprobar o editar se escribe el `Grade` (misma tabla que la planilla) con `AuditLog` `GRADE_UPDATE` (`source: AI_SUGGESTION`).
4. **¿Dónde está la inteligencia?** En `TextEvaluationPort` (hoy `FakeTextEvaluation`). Sugiere un nivel por criterio con justificación y cita; nada más.
5. **¿Qué es automatización?** Validación de la salida, cálculo de la nota, guardas de estado (una sugerencia solo se resuelve una vez) y la recuperación de entregas `PROCESSING` al arrancar.
6. **¿Qué pasa si falla?** Proveedor caído, timeout, salida inválida o cita inventada → reintentos y luego `MANUAL_REQUIRED` (el docente califica a mano); nunca se escribe una nota sin aprobación. Sin rúbrica → `409`; actividad/entrega ajena → `404`.
7. **¿Cómo sabemos que funciona?** Verificado con stubs de base de datos: éxito (nota recalculada a mano coincide), proveedor caído, cita inventada, criterio faltante y puntaje del modelo ignorado. Pendiente: specs y e2e de IDOR (Prueba #4).

Límites conocidos:

- **Solo texto.** No hay subida de archivos ni extracción de PDF/DOCX (D24); el texto llega ya extraído. PDF escaneados requerirían OCR y caerían a `MANUAL_REQUIRED`.
- **El texto del estudiante es dato, no instrucciones.** Los adaptadores reales deberán delimitarlo en el prompt; la validación de salida (cita literal, criterios y niveles cerrados) limita el daño de una inyección, pero no la reemplaza.
- El job corre en memoria (D21): al reiniciar se pierden los trabajos, pero las entregas `PROCESSING` se re-encolan.
- La retroalimentación no se muestra a estudiantes todavía (no hay endpoints de estudiante).
