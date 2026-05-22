# Reporte de Rendimiento HTTP (Macro-Benchmark)

Este informe se generó automáticamente simulando concurrencia de clientes HTTP contra el servidor Express local.

- **Concurrencia simulada:** 10 conexiones socket simultáneas por endpoint (con Keep-Alive activado).
- **Duración de la prueba:** 3 segundos por endpoint.

## Métricas de Rendimiento por Endpoint

| Endpoint / API Route | Peticiones Totales | Peticiones/seg | Éxitos (200 OK) | Fallos | Latencia Promedio | Percentil 50 (p50) | Percentil 95 (p95) | Percentil 99 (p99) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **GET /api/satellite/:id (Propagar ISS)** | 5265 | **1753,72 req/s** | 5265 | 0 | 5.69 ms | 4.81 ms | 10.74 ms | 16.05 ms |
| **GET /api/satellites?q=STARLINK (Búsqueda DB)** | 4503 | **1500,03 req/s** | 4503 | 0 | 6.65 ms | 5.51 ms | 12.40 ms | 17.09 ms |
| **GET /api/passes (Predecir pases)** | 205 | **68,27 req/s** | 205 | 0 | 143.02 ms | 119.51 ms | 261.05 ms | 550.61 ms |

## Análisis de Cuellos de Botella y Recomendaciones

1. **Propagación SGP4 (`/api/satellite/:id` )**:
   - Este endpoint suele ser extremadamente rápido gracias a WebAssembly. La latencia se mantiene baja y la tasa de transferencia alta.
   - **Recomendación**: La carga es óptima, no requiere mejoras estructurales.

2. **Búsqueda en Base de Datos (`/api/satellites?q=...` )**:
   - Si la latencia es alta, es debido a la consulta `LIKE '%q%'` en SQLite que fuerza un escaneo completo de la tabla (`SCAN TABLE`).
   - **Recomendación**: Implementar búsqueda exacta por prefijo (`q%`) o utilizar un índice de tipo virtual **FTS5** (Full-Text Search) en SQLite si el catálogo excede decenas de miles de registros.

3. **Cálculo de Pases Orbitales (`/api/passes` )**:
   - Este es el endpoint más pesado por la naturaleza iterativa del cálculo físico y de visibilidad solar (involucra cientos de operaciones trigonométricas por paso).
   - **Recomendación**: Implementar almacenamiento en caché temporal en memoria o Redis indexada por `noradId-lat-lon-days`, ya que los TLEs solo se actualizan un par de veces al día.
