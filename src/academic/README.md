# academic

Asignaturas, cursos, horarios, estudiantes, matrícula e importación CSV.

1. **¿Qué entra?** DTOs de asignatura, curso, horario, estudiante y matrícula; un CSV (`course,studentCode,fullName,email`) como cuerpo `text/csv`.
2. **¿Qué procesa?** Filtra siempre por `institutionId`; un `TEACHER` solo ve cursos con `teacherId = su id` (`CourseOwnershipGuard` + filtro en el servicio). La importación valida cada fila, crea estudiantes que no existan y matricula.
3. **¿Qué produce?** `CourseView`, `CourseDetailView` e `ImportReport` (`enrolled`, `alreadyEnrolled`, `studentsCreated`, `errors[{row,message}]`); auditoría de altas e importación.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Creación de estudiantes y matrículas en lote; idempotente (repetir el CSV no duplica).
6. **¿Qué pasa si falla?** Fila inválida → se reporta con su número de línea y se continúa; encabezado incorrecto o > 2000 filas → `400` sin tocar datos; curso ajeno → `404`.
7. **¿Cómo sabemos que funciona?** Cubierto por pruebas unitarias del parser (`csv.spec.ts`); pendiente: e2e de acceso cruzado entre docentes (IDOR) e importación.

Límite conocido: la importación aplica fila a fila sin transacción global (decisión para poder entregar un reporte parcial). Los nombres de curso deben ser únicos para importar.
