# Plan de Profesionalización — Satellites

Stack actual: Angular 21 + CesiumJS (FE), Express 5 + TypeScript + SQLite + WASM SGP4 (BE).
El stack está bien elegido. Este plan no cambia frameworks — ataca deuda estructural y de calidad antes de que las features planificadas (debris, reentry, NEOs, ground stations) la profundicen.

---

## Fase 0 — Calidad y Seguridad (impostergable)

| # | Tarea | Área | Esfuerzo |
|---|-------|------|----------|
| 0.1 | Limpiar `.env` del historial de git (`bfg` o `git filter-repo`) y regenerar secretos | BE | 30 min |
| 0.2 | ESLint en FE y BE (ninguno tiene hoy; FE solo tiene Prettier) | Ambos | 2 h |
| 0.3 | Configurar Vitest en BE + tests unitarios para `coords.ts`, `passes.ts`, `celestial.ts`, `magnitude.ts` con valores conocidos | BE | 6 h |
| 0.4 | Tests unitarios para `satellite.service.ts` en FE | FE | 1 h |
| 0.5 | `helmet` + `cors` + `express-rate-limit` + middleware de error global en Express | BE | 1 h |
| 0.6 | Logger estructurado con **Pino** (reemplazar `console.log`/`console.error`) | BE | 1 h |
| 0.7 | CI con **GitHub Actions**: lint → typecheck → test → build en cada push/PR | Ambos | 3 h |

**¿Por qué todo esto primero?**
0.1 es un riesgo activo. 0.3 es mecánica orbital — un bug ahí es invisible a ojo y más caro cuanto más física se acumule encima. 0.5–0.7 son el piso mínimo de una API expuesta. La CI (0.7) protege todo lo siguiente.

---

## Fase 1 — Estructura del Backend

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 1.1 | Separar `index.ts` en `routes/`, `controllers/`, `services/`, `app.ts` / `server.ts` | Cada endpoint nuevo planeado va a `index.ts` si no se separa ahora | 4 h |
| 1.2 | Validación de query params con **Zod** en todos los endpoints (reemplazar `parseInt`/`parseFloat` manual) | Reduce bugs silenciosos y se vuelve declarativo por ruta | 2 h |
| 1.3 | **Worker Threads** para el cálculo de `passes` (`passes.worker.ts`) | `passes.ts` bloquea el event loop de Node durante una propagación de 10 días — si dos usuarios piden pases a la vez, toda la API se congela | 4 h |
| 1.4 | Migraciones SQL versionadas (tabla `migrations` + archivos ordenados) — reemplazar el `ALTER TABLE … catch{}` de `db.ts` | El plan de features ya prevé columnas/tablas nuevas; el patrón actual no escala | 2 h |
| 1.5 | Mover `agents-demo.ts` fuera de `src/` de producción | Es un experimento con `@google/genai` que suma dependencias y superficie al bundle | 30 min |
| 1.6 | Dockerfile multi-stage + docker-compose | Necesario para deploys consistentes y para el futuro NGINX/PostgreSQL | 2 h |
| 1.7 | OpenAPI/Swagger generado desde los esquemas Zod (`zod-to-openapi`) | Documenta la API y habilita el cliente generado del FE (1.8) | 3 h |

**Estructura de carpetas objetivo:**
```
satellites-be/src/
├── config/
├── routes/          # satellite.routes.ts, passes.routes.ts, …
├── controllers/     # handlers HTTP
├── services/        # propagation, tle-sync, pass-prediction
├── repositories/    # tle.repository.ts
├── math/            # coords, magnitude, sun, celestial
├── workers/         # passes.worker.ts
├── types/
├── app.ts           # configura Express
└── server.ts        # listen()
```

---

## Fase 2 — Estructura del Frontend

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 2.1 | **Angular Router** con rutas `/tracker`, `/kessler`, `/census` | Hoy la navegación es un signal `'tracker'\|'kessler'\|'census'` en `app.ts`; cada vista nueva del plan de Sentry empeora eso | 2 h |
| 2.2 | Lazy loading para `KesslerGame` y `StarlinkCensus` | CesiumJS + satellite.js ya pesan; no cargarlos si el usuario no los usa | 2 h |
| 2.3 | `@defer` en Angular para `SatelliteMap` (carga diferida del viewer Cesium) | Mejora FCP/LCP en dispositivos lentos cuando el usuario entra a `/census` o `/kessler` | 1 h |
| 2.4 | Extraer `initViewer` + gestión de entidades Cesium a `cesium-viewer.service.ts` | `satellite-map.ts` tiene ~960 líneas; va a recibir capas de debris/ground stations/NEOs | 3 h |
| 2.5 | Reorganizar `src/app/` en `core/`, `shared/`, `features/` | Separa servicios globales, componentes reutilizables y vistas funcionales | 2 h |
| 2.6 | Cliente HTTP type-safe generado desde el OpenAPI del BE (`openapi-generator` o `kubb`) | Reemplaza la redefinición manual de tipos en `satellite.model.ts` | 3 h |
| 2.7 | Config explícita de API base vía `environments/` | Necesario cuando FE y BE se desplieguen en orígenes distintos | 30 min |
| 2.8 | E2E tests con **Playwright**: flujo crítico buscar satélite → ver órbita | Vitest está configurado pero sin specs reales | 4 h |

**Estructura de carpetas objetivo:**
```
satellites-fe/src/app/
├── core/
│   ├── services/    # SatelliteService, PerformanceMonitorService
│   └── models/
├── shared/
│   └── components/
├── features/
│   ├── tracker/     # satellite-map, passes-panel, radar, hud
│   ├── kessler/
│   └── census/
├── app.config.ts
├── app.ts
└── app.html
```

---

## Fase 3 — Performance y profesionalización

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 3.1 | Paquete `@satellites/types` compartido FE/BE | `satellite.model.ts` redefine a mano las formas que `index.ts` construye inline; cada endpoint nuevo es un punto de drift silencioso | 2 h |
| 3.2 | Husky + lint-staged para pre-commit hooks | Evita que lint roto llegue a CI | 1 h |
| 3.3 | NGINX reverse proxy en docker-compose (caché de respuestas estáticas) | Especialmente útil para `/api/starlink/census` que no cambia entre syncs | 2 h |
| 3.4 | Auth mínima: API keys via header en endpoints de escritura futura | No urgente hoy (solo lectura), pero el patrón hay que diseñarlo antes de tener endpoints POST | 3 h |
| 3.5 | Evaluar migración SQLite → PostgreSQL | Solo necesario si se despliega multi-instancia (contenedores múltiples tras balanceador); hoy SQLite en WAL es suficiente | 8 h |

---

## Fase 4 — Observabilidad

El sistema ya tiene logs estructurados (Pino) y un endpoint `/api/status`. Esta fase lo convierte en algo operable: métricas cuantificables, rastreo de errores y visibilidad de lo que ocurre dentro del worker de passes.

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 4.1 | Endpoint `/metrics` compatible con Prometheus | Exponer contadores y histogramas desde `prom-client`: requests por ruta, duración de pass-calculation, edad del TLE, fallos de sync | 3 h |
| 4.2 | Dashboard Grafana en docker-compose | Contenedor `grafana` + `prometheus` con scrape config apuntando al BE; panel de latencia, TLE staleness y errores | 3 h |
| 4.3 | Sentry en BE y FE | Capturar excepciones no manejadas; en el worker de passes, capturar errores de propagación SGP4 con contexto (noradId, TLE age) | 2 h |
| 4.4 | OpenTelemetry traces para pass-calculation | Span por satélite propagado dentro del worker; exportar a Jaeger o OTLP; útil para detectar qué satélites son outliers de latencia | 4 h |
| 4.5 | Alertas de TLE sync | Si el sync falla dos ciclos seguidos (12 h), que Pino emita un log `fatal` con campo `alert: true`; NGINX o Prometheus Alertmanager puede reaccionar | 1 h |
| 4.6 | Health check detallado en `/api/status` | Actualmente devuelve `{ok: true}`; ampliar con estado de DB, edad del TLE más reciente y uptime; usar ese endpoint en el healthcheck de docker-compose | 1 h |

**¿Por qué aquí?**
Sin métricas no se sabe si el worker de passes tarda 200 ms o 20 s. El plan de features (debris, reentry, NEOs) va a multiplicar la carga de cómputo; instrumentar antes de escalar evita depurar en producción.

---

## Fase 5 — Release y Despliegue

Convierte el proyecto en algo que se puede desplegar y actualizar de forma repetible, con TLS, sin downtime y con los cabos sueltos de fases anteriores cerrados.

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 5.1 | CD en GitHub Actions (deploy automático a VPS) | Paso adicional al CI existente: build de imagen Docker, push a ghcr.io, SSH al servidor y `docker compose up -d --pull always` | 3 h |
| 5.2 | TLS con Let's Encrypt vía Traefik o Certbot | Añadir contenedor Traefik en docker-compose como ingress; certificado automático por dominio; reemplaza el server block HTTP-only de NGINX | 3 h |
| 5.3 | Gestión de secretos en producción | Variables de entorno sensibles (`API_KEY`, Sentry DSN) via GitHub Actions secrets + Docker secrets; nunca en el repo ni en docker-compose.yml | 1 h |
| 5.4 | Estrategia de backup de SQLite | Script cron que copia el archivo `.db` a S3/Backblaze con retención de 30 días; documentar procedimiento de restore | 2 h |
| 5.5 | Cliente HTTP generado desde OpenAPI (deuda 2.6) | Depende de 1.7 (`zod-to-openapi`); usar `kubb` o `openapi-generator` para generar el cliente Angular y eliminar la redefinición manual de tipos en `satellite.model.ts` | 3 h |
| 5.6 | E2E tests con Playwright (deuda 2.8) | Flujo crítico: buscar satélite → ver órbita → ver pases; correr en CI contra el build de producción | 4 h |
| 5.7 | Evaluar migración SQLite → PostgreSQL (deuda 3.5) | Solo necesario si se escala a múltiples réplicas del BE; si no, WAL + backup (5.4) es suficiente | 8 h |

**¿Por qué aquí y no antes?**
El CD y TLS requieren un servidor real apuntando a un dominio — no tienen sentido hasta tener algo estable para desplegar. Los ítems 5.5–5.7 son deuda técnica diferida explícitamente en fases anteriores.

---

## Resumen de esfuerzo

| Fase | Horas | Prioridad |
|------|-------|-----------|
| Fase 0 — Calidad y Seguridad | ~14 h | ✅ Completada |
| Fase 1 — Estructura BE | ~18 h | ✅ Completada |
| Fase 2 — Estructura FE | ~18 h | ✅ Completada |
| Fase 3 — Performance | ~16 h | ✅ Completada |
| Fase 4 — Observabilidad | ~14 h | Alta |
| Fase 5 — Release y Despliegue | ~24 h | Media |
| **Total** | **~104 h** | |

## Orden de ejecución

```
Semana 1 → Fase 0 completa
Semana 2 → Fase 1 (1.1–1.5 primero; Docker y OpenAPI al final)
Semana 3 → Fase 2 (2.1–2.5 antes del cliente generado)
Semana 4 → Fase 3 + tipos compartidos
Semana 5 → Fase 4 (4.1–4.3 antes de 4.4; 4.5–4.6 son rápidos y se pueden intercalar)
Semana 6 → Fase 5 (5.1–5.3 en orden; 5.5–5.7 en paralelo con otras fases si hay tiempo)
```

La Fase 2 puede comenzarse en paralelo con la segunda mitad de Fase 1 (2.1–2.5 no dependen de OpenAPI). El item 2.6 sí depende de 1.7.
La Fase 4 puede comenzarse en paralelo con Fase 5 — son independientes entre sí excepto que 5.1 (CD) se beneficia de tener 4.1 (métricas) para validar deploys.
