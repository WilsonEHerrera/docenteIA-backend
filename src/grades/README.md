# grades

Actividades con porcentaje, notas por estudiante, planilla (`gradebook`) y estudiantes en riesgo. Reglas puras en `src/domain/weighted-average.ts` y `src/domain/grade-risk.ts`.

1. **¿Qué entra?** `{ name, weightPct, period? }` para crear/editar una actividad; `{ value }` (string decimal `"0"`–`"5"` o `null`) para una nota; `?period` para la planilla.
2. **¿Qué procesa?** Valida forma (DTO) y rango (`domain`: nota 0–5, porcentaje 0–100). Los porcentajes de un curso+periodo nunca pueden sumar más de 100 (transacción `Serializable`). Calcula el promedio ponderado con `decimal.js`, redondeo half-up a 2 decimales.
3. **¿Qué produce?** `ActivityView`, `GradeView` y `GradebookView` (filas con `average`, `isFinal`, `gradedWeightPct`, `atRisk`, ids de cada nota); `AuditLog` `GRADE_UPDATE` con `{from, to}`, y `ACTIVITY_CREATE`/`ACTIVITY_UPDATE`.
4. **¿Dónde está la inteligencia?** No usa IA. Cuando exista, la IA solo sugerirá puntajes por criterio; la nota final la sigue calculando `domain/`.
5. **¿Qué es automatización?** Promedio ponderado (final cuando el periodo suma 100 % y está todo calificado; acumulado sobre lo calificado en otro caso), marca de riesgo (`average < 3.0`) y creación de las celdas vacías para cada matriculado.
6. **¿Qué pasa si falla?** Porcentajes > 100 → `409 WEIGHTS_EXCEED_100`; nota fuera de rango → `400 INVALID_GRADE`; curso/actividad/nota ajena → `404`; conflicto concurrente → `409 CONFLICT`. Un fallo de auditoría no revierte la nota (ver D14).
7. **¿Cómo sabemos que funciona?** Prueba #1 (4.0/3.5/4.5 → 4.05) sobre `weightedAverage`. Pendiente: specs de dominio, e2e de acceso cruzado entre docentes (IDOR) y de la planilla.

Notas de diseño:

- `GET /courses/:id/gradebook` crea (idempotente, `skipDuplicates`) las celdas faltantes de estudiantes matriculados después de crear la actividad; así cada celda tiene un `id` para `PUT /grades/:id`.
- `absences` viene de `AttendanceService` (solo sesiones confirmadas); `absenceAlert` usa `domain/absence-alert.ts` y `atRisk` es promedio bajo **o** alerta de fallas.
- Escribir notas es solo `TEACHER` dueño del curso; `COORDINATOR` solo lee la planilla.
