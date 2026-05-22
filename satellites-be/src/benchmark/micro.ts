"use strict";

import { performance } from "perf_hooks";
import { bindings } from "@wasmer/sgp4";
import { Elements, Constants } from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import { temeToGeodetic } from "../coords";
import { openDatabase, getTleByNoradId } from "../db";
import { findPasses } from "../passes";

// ─── Benchmarking Harness ───────────────────────────────────────────────────

interface BenchResult {
  name: string;
  iterations: number;
  opsPerSec: string;
  meanMs: string;
  minMs: string;
  maxMs: string;
  stdDevMs: string;
}

function runBenchmark(name: string, fn: () => void, durationMs = 1500): BenchResult {
  const times: number[] = [];
  const startTotal = performance.now();
  let iterations = 0;

  // Calentamiento rápido (Warmup) de 100ms
  const warmupStart = performance.now();
  while (performance.now() - warmupStart < 100) {
    fn();
  }

  // Ejecución real
  const runStart = performance.now();
  while (performance.now() - runStart < durationMs) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    times.push(t1 - t0);
    iterations++;
  }
  const totalDuration = performance.now() - runStart;

  // Cálculos estadísticos
  const sum = times.reduce((acc, t) => acc + t, 0);
  const mean = sum / times.length;
  
  let min = Infinity;
  let max = -Infinity;
  for (const t of times) {
    if (t < min) min = t;
    if (t > max) max = t;
  }

  const variance = times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / times.length;
  const stdDev = Math.sqrt(variance);

  const opsPerSec = (iterations / (totalDuration / 1000)).toFixed(2);

  return {
    name,
    iterations,
    opsPerSec: `${Number(opsPerSec).toLocaleString()} ops/s`,
    meanMs: `${mean.toFixed(4)} ms`,
    minMs: `${min.toFixed(4)} ms`,
    maxMs: `${max.toFixed(4)} ms`,
    stdDevMs: `${stdDev.toFixed(4)} ms`,
  };
}

// ─── Main Execution ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("==========================================================================");
  console.log("   INICIANDO SUITE DE MICRO-BENCHMARKS ORBITALES Y MATEMÁTICOS DE CPU     ");
  console.log("==========================================================================\n");

  console.log("Cargando entorno WebAssembly SGP4...");
  const wasm = await bindings.sgp4();
  console.log("Cargando base de datos SQLite...");
  const db = openDatabase();
  console.log("WASM y Base de Datos cargados correctamente.\n");

  // Obtener un satélite real para las pruebas de propagación (ISS - NORAD 25544)
  const issId = 25544;
  const row = getTleByNoradId(db, issId);
  if (!row) {
    console.error("ADVERTENCIA: La base de datos no contiene el registro de la ISS (NORAD 25544).");
    console.error("Por favor, asegúrate de correr una sincronización inicial.");
    process.exit(1);
  }

  const { name: satName, line1, line2 } = row;
  console.log(`Usando datos reales del satélite: ${satName} (NORAD ${issId})`);
  console.log(`L1: "${line1}"`);
  console.log(`L2: "${line2}"\n`);

  // Preparar elementos de propagación
  const elements = Elements.fromTle(wasm, null, line1, line2);
  if (elements.tag === "err") throw elements.val;
  
  const constants = Constants.fromElementsAfspcCompatibilityMode(wasm, elements.val);
  if (constants.tag === "err") throw constants.val;

  const propConstants = constants.val;
  const t = 100.0; // 100 minutos tras la época
  
  const predictionResult = propConstants.propagateAfspcCompatibilityMode(t);
  if (predictionResult.tag === "err") throw predictionResult.val;
  const prediction = predictionResult.val;

  const now = new Date();

  // Coordenadas del observador (Buenos Aires, Argentina)
  const observer = { lat_deg: -34.6037, lon_deg: -58.3816, alt_km: 0.025 };

  // Ejecutando micro-benchmarks
  const results: BenchResult[] = [];

  console.log("Calculando benchmarks... (Espera un momento)");

  // 1. SGP4 Propagate
  results.push(runBenchmark("1. Propagación SGP4 (WASM)", () => {
    const res = propConstants.propagateAfspcCompatibilityMode(t);
    if (res.tag === "err") throw res.val;
  }));

  // 2. TEME to Geodetic
  results.push(runBenchmark("2. Conversión TEME a Geodésica (Matemáticas JS)", () => {
    temeToGeodetic(prediction.position, now);
  }));

  // 3. findPasses - 1 día
  results.push(runBenchmark("3. Búsqueda de pases (1 día)", () => {
    findPasses(db, wasm, issId, observer, { days: 1 });
  }, 2000));

  // 4. findPasses - 3 días
  results.push(runBenchmark("4. Búsqueda de pases (3 días)", () => {
    findPasses(db, wasm, issId, observer, { days: 3 });
  }, 2000));

  // 5. findPasses - 10 días
  results.push(runBenchmark("5. Búsqueda de pases (10 días - Carga Máxima)", () => {
    findPasses(db, wasm, issId, observer, { days: 10 });
  }, 3000));

  // Mostrar tabla de resultados hermosamente formateada
  console.log("\n==========================================================================");
  console.log("                         TABLA DE RESULTADOS METRICAS                     ");
  console.log("==========================================================================");
  console.table(
    results.map((r) => ({
      Prueba: r.name,
      "Ops/Segundo": r.opsPerSec,
      "Latencia Promedio": r.meanMs,
      "Mínimo": r.minMs,
      "Máximo": r.maxMs,
      "Desv. Estándar": r.stdDevMs,
    }))
  );
  console.log("==========================================================================\n");
}

main().catch((err: unknown) => {
  console.error("Error fatal en la ejecución de micro-benchmarks:", err);
  process.exit(1);
});
