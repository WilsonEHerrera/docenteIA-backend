# jobs

Cola de trabajos en segundo plano (`JobQueue`) para sacar la IA del request del usuario. Implementación en memoria (`InMemoryJobQueue`).

1. **¿Qué entra?** `enqueue(nombre, payload, jobId)` desde un servicio; un handler registrado con `register(nombre, handler)`.
2. **¿Qué procesa?** Ejecuta los trabajos en el siguiente tick (no dentro del request), con concurrencia 2, y descarta duplicados con el mismo `jobId` mientras estén esperando o corriendo.
3. **¿Qué produce?** `true` si el trabajo quedó encolado, `false` si ya existía. El resultado lo escribe el handler en la base de datos.
4. **¿Dónde está la inteligencia?** No usa IA; solo ejecuta lo que le pidan.
5. **¿Qué es automatización?** Despacho, concurrencia limitada e idempotencia por `jobId`.
6. **¿Qué pasa si falla?** Una excepción del handler solo se registra en logs: cada handler debe atrapar sus errores y dejar su entidad en un estado manual (p. ej. `MANUAL_REQUIRED`). **Si el proceso se reinicia, los trabajos pendientes se pierden**: por eso el estado vive en la base de datos y el módulo dueño recupera lo que quedó en `PROCESSING` al arrancar.
7. **¿Cómo sabemos que funciona?** Verificado a mano: el segundo `enqueue` con el mismo `jobId` devuelve `false` y el trabajo no corre en el mismo tick. Pendiente: specs.

Límite conocido: sin reintentos propios, sin persistencia y una sola instancia (D21). Cuando haya Redis y proveedores reales, se reemplaza por BullMQ detrás de la misma clase abstracta `JobQueue`.
