"use strict";

import { spawn, ChildProcess } from "child_process";
import http from "http";
import { performance } from "perf_hooks";
import fs from "fs";
import path from "path";

const PORT = 3003;
const TEST_DURATION_MS = 3000; // 3 segundos por endpoint
const CONCURRENCY = 10;        // 10 conexiones concurrentes por canal

interface LoadMetrics {
  endpoint: string;
  totalRequests: number;
  successful: number;
  failed: number;
  opsPerSec: number;
  meanLat: number;
  p50Lat: number;
  p95Lat: number;
  p99Lat: number;
}

// ─── HTTP Load Generator Engine (Pure Node, Zero Dependencies) ─────────────

function runLoadTestForEndpoint(urlPath: string, name: string): Promise<LoadMetrics> {
  return new Promise((resolve) => {
    console.log(`Ejecutando prueba en: ${name} (http://localhost:${PORT}${urlPath})...`);

    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    let activeConnections = 0;

    const agent = new http.Agent({
      keepAlive: true,
      maxSockets: CONCURRENCY,
    });

    const start = performance.now();
    let isRunning = true;

    function sendRequest() {
      if (!isRunning) return;

      const reqStart = performance.now();
      activeConnections++;

      const req = http.get(
        {
          host: "localhost",
          port: PORT,
          path: urlPath,
          agent: agent,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            const duration = performance.now() - reqStart;
            latencies.push(duration);
            
            if (res.statusCode === 200) {
              successful++;
            } else {
              failed++;
            }
            activeConnections--;
            sendRequest(); // Petición inmediata en bucle continuo
          });
        }
      );

      req.on("error", () => {
        failed++;
        activeConnections--;
        setTimeout(sendRequest, 5); // Reintento con delay mínimo
      });

      req.end();
    }

    // Inicializar concurrencia
    for (let i = 0; i < CONCURRENCY; i++) {
      sendRequest();
    }

    // Parar el test tras la duración especificada
    setTimeout(() => {
      isRunning = false;
      const durationTotal = performance.now() - start;
      agent.destroy();

      // Cálculos estadísticos
      const sortedLats = [...latencies].sort((a, b) => a - b);
      const total = latencies.length;
      
      const sum = latencies.reduce((a, b) => a + b, 0);
      const mean = total > 0 ? sum / total : 0;

      const getPercentile = (p: number) => {
        if (total === 0) return 0;
        const index = Math.ceil((p / 100) * total) - 1;
        return sortedLats[Math.min(index, total - 1)];
      };

      resolve({
        endpoint: name,
        totalRequests: total,
        successful,
        failed,
        opsPerSec: parseFloat((total / (durationTotal / 1000)).toFixed(2)),
        meanLat: mean,
        p50Lat: getPercentile(50),
        p95Lat: getPercentile(95),
        p99Lat: getPercentile(99),
      });
    }, TEST_DURATION_MS);
  });
}

// ─── Helpers to manage server spawn ──────────────────────────────────────────

function waitForServer(port: number, retries = 15): Promise<boolean> {
  return new Promise((resolve) => {
    let attempt = 0;
    const check = () => {
      attempt++;
      const req = http.get(`http://localhost:${port}/api/status`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (attempt >= retries) {
          resolve(false);
        } else {
          setTimeout(check, 250);
        }
      });
      req.end();
    };
    check();
  });
}

// ─── Main Process ───────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================================================");
  console.log("       INICIANDO SUITE DE PRUEBAS DE CARGA HTTP (MACRO-BENCHMARK)         ");
  console.log("==========================================================================\n");

  console.log("Lanzando servidor de fondo satellites-be en puerto 3003...");
  const serverProcess = spawn("npx", ["tsx", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SYNC_ON_START: "false", // Desactivar sincronización de inicio para evitar lag
    },
    stdio: "pipe",
  });

  // Loguear errores del proceso del servidor si los hay
  serverProcess.stderr.on("data", (data) => {
    console.error(`[Servidor Error]: ${data}`);
  });

  const isOnline = await waitForServer(PORT);
  if (!isOnline) {
    console.error("ERROR: No se pudo levantar el servidor Express en el puerto 3003.");
    serverProcess.kill();
    process.exit(1);
  }
  console.log("¡Servidor Express levantado correctamente y listo para recibir carga!\n");

  const results: LoadMetrics[] = [];

  try {
    // 1. Satellite propagation endpoint
    results.push(await runLoadTestForEndpoint("/api/satellite/25544", "GET /api/satellite/:id (Propagar ISS)"));
    console.log();

    // 2. Search endpoint
    results.push(await runLoadTestForEndpoint("/api/satellites?q=STARLINK", "GET /api/satellites?q=STARLINK (Búsqueda DB)"));
    console.log();

    // 3. Passes endpoint
    results.push(await runLoadTestForEndpoint("/api/passes?noradId=25544&lat=-34.6&lon=-58.3&days=3", "GET /api/passes (Predecir pases)"));
    console.log();

  } catch (err) {
    console.error("Ocurrió un error ejecutando la carga HTTP:", err);
  } finally {
    console.log("Apagando servidor Express de fondo...");
    serverProcess.kill("SIGTERM");
  }

  // Generar reporte en consola
  console.log("==========================================================================");
  console.log("                   REPORTE FINAL DE RENDIMIENTO HTTP                      ");
  console.log("==========================================================================");
  console.table(
    results.map((r) => ({
      Endpoint: r.endpoint,
      Peticiones: r.totalRequests.toLocaleString(),
      "Peticiones/Seg": `${r.opsPerSec.toLocaleString()} req/s`,
      "Éxitos (200 OK)": r.successful.toLocaleString(),
      Fallos: r.failed.toLocaleString(),
      "Latencia Media": `${r.meanLat.toFixed(1)} ms`,
      "Percentil 50 (Median)": `${r.p50Lat.toFixed(1)} ms`,
      "Percentil 95 (P95)": `${r.p95Lat.toFixed(1)} ms`,
      "Percentil 99 (P99)": `${r.p99Lat.toFixed(1)} ms`,
    }))
  );
  console.log("==========================================================================\n");

  // Guardar archivo Markdown de resultados
  const mdContent = `# Reporte de Rendimiento HTTP (Macro-Benchmark)

Este informe se generó automáticamente simulando concurrencia de clientes HTTP contra el servidor Express local.

- **Concurrencia simulada:** ${CONCURRENCY} conexiones socket simultáneas por endpoint (con Keep-Alive activado).
- **Duración de la prueba:** ${TEST_DURATION_MS / 1000} segundos por endpoint.

## Métricas de Rendimiento por Endpoint

| Endpoint / API Route | Peticiones Totales | Peticiones/seg | Éxitos (200 OK) | Fallos | Latencia Promedio | Percentil 50 (p50) | Percentil 95 (p95) | Percentil 99 (p99) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${results
  .map(
    (r) =>
      `| **${r.endpoint}** | ${r.totalRequests.toLocaleString()} | **${r.opsPerSec.toLocaleString()} req/s** | ${r.successful.toLocaleString()} | ${r.failed.toLocaleString()} | ${r.meanLat.toFixed(2)} ms | ${r.p50Lat.toFixed(2)} ms | ${r.p95Lat.toFixed(2)} ms | ${r.p99Lat.toFixed(2)} ms |`
  )
  .join("\n")}

## Análisis de Cuellos de Botella y Recomendaciones

1. **Propagación SGP4 (\`/api/satellite/:id\` )**:
   - Este endpoint suele ser extremadamente rápido gracias a WebAssembly. La latencia se mantiene baja y la tasa de transferencia alta.
   - **Recomendación**: La carga es óptima, no requiere mejoras estructurales.

2. **Búsqueda en Base de Datos (\`/api/satellites?q=...\` )**:
   - Si la latencia es alta, es debido a la consulta \`LIKE '%q%'\` en SQLite que fuerza un escaneo completo de la tabla (\`SCAN TABLE\`).
   - **Recomendación**: Implementar búsqueda exacta por prefijo (\`q%\`) o utilizar un índice de tipo virtual **FTS5** (Full-Text Search) en SQLite si el catálogo excede decenas de miles de registros.

3. **Cálculo de Pases Orbitales (\`/api/passes\` )**:
   - Este es el endpoint más pesado por la naturaleza iterativa del cálculo físico y de visibilidad solar (involucra cientos de operaciones trigonométricas por paso).
   - **Recomendación**: Implementar almacenamiento en caché temporal en memoria o Redis indexada por \`noradId-lat-lon-days\`, ya que los TLEs solo se actualizan un par de veces al día.
`;

  const reportPath = path.join(__dirname, "..", "..", "load-test-results.md");
  fs.writeFileSync(reportPath, mdContent);
  console.log(`¡Reporte escrito exitosamente en el archivo: ${reportPath}!\n`);
}

main().catch((err) => {
  console.error("Error catastrófico en el orquestador del benchmark de carga:", err);
});
