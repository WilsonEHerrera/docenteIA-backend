# ai-metrics

Métricas de uso y calidad de la IA para ADMIN y COORDINATOR: cuánto se usa, cuánto falla, qué tan rápido responde y cuánto tiene que corregir el docente. Estadística pura en `src/domain/statistics.ts`.

1. **¿Qué entra?** `?from&to` (días `YYYY-MM-DD` de Colombia, ambos opcionales). La institución sale del token.
2. **¿Qué procesa?** Agrega solo lo ya registrado: `AiCallLog` (llamadas), `AiSuggestion` (sugerencias de nota), `QuizQuestion` de origen `AI`, y las sesiones `PHOTO` con los contadores que el job congela al proponer. No llama a la IA ni modifica nada.
3. **¿Qué produce?** `AiMetricsView`: por tipo de llamada (total, fallos, reintentos, latencia media y p95, errores por código, costo); % de sugerencias aceptadas vs. corregidas y corrección media de nota; lo mismo para preguntas; y para asistencia facial reconocimiento, cobertura y tasa de recurso a manual.
4. **¿Dónde está la inteligencia?** No usa IA: mide a la IA.
5. **¿Qué es automatización?** El cálculo de tasas y percentiles; reemplaza revisar tablas a mano (Prueba/operación: "% de reconocimiento por sesión").
6. **¿Qué pasa si falla?** Sin datos todas las tasas son `null` (no hay divisiones por cero). Fechas inválidas o rango invertido → `400`. Si hay más de 50 000 filas se corta y la respuesta trae `truncated: true`. Solo lectura: no puede afectar al flujo del docente.
7. **¿Cómo sabemos que funciona?** Verificado con datos sintéticos y resultados calculados a mano: 14 llamadas → 14.3 % de fallos, latencia 450 ms y p95 800 ms; 12 sugerencias → 60.0 % aceptadas y 40.0 % corregidas, corrección media 0.50; 5 sesiones → 85.8 % de reconocimiento y 96.0 % de cobertura; rangos y fechas inválidas; sin datos. Pendiente: specs.

Notas:

- **Costo:** la columna existe, pero los adaptadores `fake` no reportan costo; cuando haya proveedores reales, deberán llenar `costUsd` en `AiCallLog` (hoy el ejecutor lo deja `null`).
- **Por qué hay contadores congelados en la sesión** (`aiRecognized`, `aiUnrecognized`, `notConsidered`): al corregir, el docente reescribe los registros (`source: MANUAL`), así que reconstruir lo que propuso la IA desde ellos daría una tasa de reconocimiento sesgada.
- **Por qué `origin` en las preguntas:** las que escribe el docente nacen `APPROVED` y, sin distinguirlas, inflarían la tasa de aceptación de la IA.
- Las sesiones por foto anteriores a esta versión no tienen contadores y no aportan a reconocimiento/cobertura.
