# health

Sondas de vida y disponibilidad para monitoreo/uptime (`@Public`).

1. **¿Qué entra?** `GET /api/v1/health/live` y `/health/ready`, sin credenciales.
2. **¿Qué procesa?** `live` responde sin tocar dependencias; `ready` ejecuta `SELECT 1` contra la BD.
3. **¿Qué produce?** `{ status: "ok" }` / `{ status: "ok", database: "up" }`, o `503`.
4. **¿Dónde está la inteligencia?** No usa IA.
5. **¿Qué es automatización?** Insumo del smoke test de despliegue y de las alertas de uptime (Fase 4).
6. **¿Qué pasa si falla?** Si la BD no responde → `503` sin detalle interno; el detalle queda en logs con `traceId`.
7. **¿Cómo sabemos que funciona?** `curl` a ambas rutas; `ready` debe pasar a `503` si se corta la BD.
