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

## Resumen de esfuerzo

| Fase | Horas | Prioridad |
|------|-------|-----------|
| Fase 0 — Calidad y Seguridad | ~14 h | Alta — hacer primero |
| Fase 1 — Estructura BE | ~18 h | Media |
| Fase 2 — Estructura FE | ~18 h | Media |
| Fase 3 — Performance | ~16 h | Baja |
| **Total** | **~66 h** | |

## Orden de ejecución

```
Semana 1 → Fase 0 completa
Semana 2 → Fase 1 (1.1–1.5 primero; Docker y OpenAPI al final)
Semana 3 → Fase 2 (2.1–2.5 antes del cliente generado)
Semana 4 → Fase 3 + tipos compartidos
```

La Fase 2 puede comenzarse en paralelo con la segunda mitad de Fase 1 (2.1–2.5 no dependen de OpenAPI). El item 2.6 sí depende de 1.7.
