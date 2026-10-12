# reports

Reportes de rendimiento y asistencia por curso, y su exportación a CSV (abre directo en Excel). Estadística pura en `src/domain/statistics.ts`.

1. **¿Qué entra?** `courseId` y filtros: `period` (rendimiento) o `from`/`to` (asistencia); `type` y `format=csv` para exportar.
2. **¿Qué procesa?** Verifica que el curso sea del docente (un `COORDINATOR` ve los de su institución). Rendimiento reutiliza `GradesService.gradebook` y agrega promedios por actividad y del curso; asistencia agrupa los registros de sesiones **confirmadas** del rango.
3. **¿Qué produce?** `PerformanceReport`, `AttendanceReport` o un archivo `text/csv` (UTF-8 con BOM). Cada exportación deja `AuditLog` `REPORT_EXPORT`.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Consolidación de promedios, conteo de en riesgo y porcentajes de asistencia que el docente haría a mano en una hoja de cálculo.
6. **¿Qué pasa si falla?** Curso ajeno → `404`; fechas inválidas o rango invertido → `400`; formato distinto de `csv` → `400`. No hay efectos secundarios salvo la auditoría (que nunca lanza, D14) y la reposición idempotente de celdas vacías de la planilla.
7. **¿Cómo sabemos que funciona?** Verificado a mano: escape de CSV (comas, comillas, `=…` prefijado con `'`) y `mean`/`percentage`. Pendiente: specs de `domain/statistics.ts` y `csv-writer.ts`, y e2e de acceso cruzado entre docentes.

Límites conocidos:

- **Solo CSV.** No hay PDF ni `.xlsx` (decisión D20). En un Excel con configuración regional que use `;` como separador, abrir con *Datos → Desde texto/CSV* y elegir coma.
- Las exportaciones se arman en memoria; suficiente para cursos de decenas de estudiantes.
