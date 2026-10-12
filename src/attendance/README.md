# attendance

Asistencia manual por sesión, confirmación, conteo de fallas y alerta al 80 % para el panel. Reglas puras en `src/domain/attendance-rules.ts` y `src/domain/absence-alert.ts`.

1. **¿Qué entra?** `{ courseId, date?, records: [{ studentId, status }] }` para crear la sesión; `{ status }` para corregir un registro; confirmar una sesión.
2. **¿Qué procesa?** Verifica que el curso sea del docente, que la fecha sea real y no futura, y que la lista contenga a cada matriculado una vez. Solo las sesiones `CONFIRMED` cuentan para las fallas (`ABSENT` = 1; `EXCUSED` y `PRESENT` no).
3. **¿Qué produce?** `AttendanceSession` (registros + estadísticas), listado de sesiones y `AttendanceSummary` por curso (fallas, % usado y `alert`). `AuditLog`: `ATTENDANCE_SESSION_CREATE`, `ATTENDANCE_RECORD_UPDATE` (con `from`/`to`) y `ATTENDANCE_CONFIRM`. El conteo alimenta `absences`/`absenceAlert` de la planilla de notas.
4. **¿Dónde está la inteligencia?** Solo en la asistencia por foto (`POST /attendance/sessions`): `FaceRecognitionPort` (hoy `FakeFaceRecognition`) propone quién está; el modo manual no usa IA. La IA solo propone, el docente confirma.
5. **¿Qué es automatización?** Conteo de fallas por estudiante y marca de alerta cuando `fallas × 100 ≥ maxAbsences × umbral` (umbral `ABSENCE_ALERT_THRESHOLD_PCT`, 80 por defecto), con aritmética entera.
6. **¿Qué pasa si falla?** Lista incompleta o con ajenos → `400`; fecha futura → `400`; sesión ya confirmada → `409 SESSION_CONFIRMED`; registros `UNRECOGNIZED` → `409 UNRESOLVED_RECORDS` (nunca se vuelven ausencia solos); sesión ajena → `404`. La confirmación usa un `updateMany` condicionado para que dos confirmaciones simultáneas no ambas triunfen.
7. **¿Cómo sabemos que funciona?** Reglas puras verificadas a mano (8 de 10 al 80 % → alerta, 7 de 10 → no). Asistencia por foto verificada con stubs: 30 estudiantes con 2 rostros cubiertos → 28 `PRESENT` y 2 `UNRECOGNIZED`, 0 `ABSENT` (Prueba #3); proveedor caído o salida inválida → `MANUAL_REQUIRED` sin ausentes (Prueba #5); ids inventados por el proveedor se ignoran; sin elegibles la IA ni se llama. Pendiente: specs y e2e de acceso cruzado (IDOR).

**Asistencia por foto (3.3):**

- `POST /attendance/sessions?courseId` (foto cruda) crea la sesión `PROCESSING` y encola `attendance.recognize`. El job pide a `FaceReferenceService.candidatesFor` solo a quienes tienen consentimiento vigente **y** referencia, llama a la IA vía `AiRunner` y crea un registro por matriculado.
- `confianza ≥ FACE_MATCH_THRESHOLD` → `PRESENT`; el resto → `UNRECOGNIZED` (regla `classifyFaceMatch`). Quien no era elegible queda `UNRECOGNIZED` con `source: MANUAL` y no se envía a la IA.
- Falla, caída o nadie elegible → `MANUAL_REQUIRED` con todos `UNRECOGNIZED`/`MANUAL`. Tras un reinicio, las sesiones `PROCESSING` pasan a `MANUAL_REQUIRED` (la foto solo estaba en memoria, D29).
- Desde `READY` o `MANUAL_REQUIRED` el flujo es el mismo que el manual: corregir registros y confirmar.
- La sesión guarda `mode` (`PHOTO`/`MANUAL`) y una instantánea de lo que propuso la IA (`aiRecognized`, `aiUnrecognized`, `notConsidered`), que alimenta las métricas de `ai-metrics` aunque el docente corrija después.

Límites conocidos:

- **No se envían correos.** El roadmap (2.3) prevé cola de correo con reintentos; no está implementada ni simulada. La alerta es solo un dato en `GET /courses/:id/attendance/summary` y en la planilla.
- Se permiten varias sesiones el mismo día (un curso puede tener dos bloques); evitar duplicados accidentales es responsabilidad de la UI.
- La fecha por defecto usa `America/Bogota` (decisión D18).
