# ai

Capa de IA: puertos, adaptadores `Fake*` determinísticos y el ejecutor que protege al resto del sistema de los proveedores. No expone endpoints; la usan `attendance` (3.3), `submissions` (3.4) y `quizzes` (3.5).

1. **¿Qué entra?** Una llamada a un puerto (`FaceRecognitionPort`, `TextEvaluationPort`, `QuizGenerationPort`) con su entrada tipada, más el esquema Zod que debe cumplir la salida.
2. **¿Qué procesa?** `AiRunner`: verifica el límite diario de la institución, aplica timeout, reintenta con backoff exponencial (250 ms, 500 ms, 1 s… tope 5 s), valida la salida con Zod y registra la operación en `AiCallLog`.
3. **¿Qué produce?** La salida ya validada, o un `AiUnavailableError` (`503 AI_UNAVAILABLE` / `429 AI_DAILY_LIMIT`). Una fila de `AiCallLog` por operación: tipo, proveedor, versión de prompt, éxito, intentos, latencia y código de error.
4. **¿Dónde está la inteligencia?** Aquí es donde viviría: detrás de los puertos. Hoy solo hay adaptadores `Fake` (`AI_PROVIDER=fake`); sus textos llevan la marca `[FAKE]`.
5. **¿Qué es automatización?** Los reintentos, el timeout, la validación de salida y el límite diario son reglas fijas, sin IA.
6. **¿Qué pasa si falla?** Timeout, error del proveedor o salida inválida cuentan como intento fallido; agotados los intentos se lanza `AiUnavailableError` y quien llama pasa a modo manual (`MANUAL_REQUIRED`). El sistema nunca se detiene por la IA.
7. **¿Cómo sabemos que funciona?** Verificado a mano con los Fakes: 30 estudiantes con 2 rostros cubiertos → 28 coincidencias y 2 sin reconocer; reintento tras fallos, `INVALID_OUTPUT`, `TIMEOUT` y límite diario. Pendiente: specs.

Notas:

- **Intentos:** `AI_MAX_RETRIES` es el total de intentos, el primero incluido (3 = una llamada y dos reintentos).
- **Sin persistir fotos ni textos:** el puerto de reconocimiento recibe el `Buffer` de la imagen, se procesa en memoria y se descarta. `AiCallLog` no guarda prompts, imágenes, texto del estudiante ni mensajes de error del proveedor.
- **Escenarios del Fake de rostros:** una foto de prueba puede empezar con `FAKE:{"covered":2,"lowConfidence":1}\n`; `down:true` simula una caída del proveedor.
- **Límite diario:** aproximado (dos llamadas simultáneas pueden pasarse por poco). El día se cuenta en hora de Colombia.
- El timeout abandona la espera, pero no cancela la petición ya enviada al proveedor.
