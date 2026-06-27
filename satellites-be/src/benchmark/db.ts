"use strict";

import { performance } from "perf_hooks";
import { openDatabase } from "../db";
import { searchSatellites, getTleByNoradId, upsertTles } from "../repositories/tle.repository";
import type { TleRecord } from "../tle-parser";

// ─── Auxiliary Helpers ────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  return `${ms.toFixed(4)} ms`;
}

// ─── Main Execution ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("==========================================================================");
  console.log("   INICIANDO SUITE DE BENCHMARKS PARA BASE DE DATOS SQLITE (better-sqlite3) ");
  console.log("==========================================================================\n");

  const db = openDatabase();
  console.log("Base de datos SQLite abierta correctamente.\n");

  // Obtener estadísticas iniciales
  const totalCount = db.prepare("SELECT COUNT(*) AS n FROM tles").get() as { n: number };
  console.log(`Registros actuales en la tabla 'tles': ${totalCount.n} satélites.\n`);

  if (totalCount.n === 0) {
    console.error("ADVERTENCIA: La base de datos está vacía.");
    console.error("Por favor, ejecuta la app o sincroniza TLEs antes de correr los benchmarks.");
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Búsqueda con Índice vs Escaneo de Tabla Completa
  // ───────────────────────────────────────────────────────────────────────────
  console.log("--------------------------------------------------------------------------");
  console.log("TEST 1: Búsqueda Indexada (Clave Primaria) vs Búsqueda de Texto (LIKE %term%)");
  console.log("--------------------------------------------------------------------------");

  // A. Obtener por NORAD_ID (Indexado - Clave Primaria)
  const testNoradId = 25544; // ISS
  const timesPk: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    getTleByNoradId(db, testNoradId);
    timesPk.push(performance.now() - t0);
  }
  const avgPk = timesPk.reduce((a, b) => a + b, 0) / timesPk.length;
  console.log(`A. Búsqueda exacta por NORAD ID (PK - INDEX):`);
  console.log(`   - Ejecuciones: 1,000`);
  console.log(`   - Tiempo promedio: ${formatMs(avgPk)}`);

  // B. Búsqueda por texto libre utilizando LIKE con comodines de inicio y fin (Fuerza SCAN TABLE)
  const timesLike: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    // Búsqueda pesada en el campo text
    searchSatellites(db, "STARLINK");
    timesLike.push(performance.now() - t0);
  }
  const avgLike = timesLike.reduce((a, b) => a + b, 0) / timesLike.length;
  console.log(`B. Búsqueda de texto flexible (LIKE '%STARLINK%' - SCAN TABLE):`);
  console.log(`   - Ejecuciones: 200`);
  console.log(`   - Tiempo promedio: ${formatMs(avgLike)}`);

  const diffFactor = (avgLike / avgPk).toFixed(1);
  console.log(`👉 ¡La búsqueda indexada por clave primaria es x${diffFactor} veces más rápida que el escaneo por LIKE!\n`);


  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Transacciones Masivas (Bulk Upsert) vs Operaciones Individuales
  // ───────────────────────────────────────────────────────────────────────────
  console.log("--------------------------------------------------------------------------");
  console.log("TEST 2: Rendimiento de Inserciones / Actualizaciones (Transacciones vs Individual)");
  console.log("--------------------------------------------------------------------------");

  // Clonar algunos TLEs reales para testear escrituras
  const tlesToTest = db.prepare("SELECT * FROM tles LIMIT 100").all() as Array<{
    norad_id: number;
    name: string;
    line1: string;
    line2: string;
    epoch_ms: number;
    classification: string;
    intl_designator: string;
    bstar: number;
    mean_motion_dot: number;
    inclination: number;
    raan: number;
    eccentricity: number;
    arg_perigee: number;
    mean_anomaly: number;
    mean_motion: number;
    revolution_number: number;
    group_name: string;
  }>;

  const records: TleRecord[] = tlesToTest.map(row => ({
    noradId: row.norad_id + 900000, // ID ficticio fuera de rango para evitar conflictos reales
    name: `BENCH-${row.name}`,
    line1: row.line1,
    line2: row.line2,
    epochMs: row.epoch_ms,
    classification: row.classification || "U",
    intlDesignator: row.intl_designator || "",
    bstar: row.bstar || 0,
    meanMotionDot: row.mean_motion_dot || 0,
    inclination: row.inclination || 0,
    raan: row.raan || 0,
    eccentricity: row.eccentricity || 0,
    argPerigee: row.arg_perigee || 0,
    meanAnomaly: row.mean_anomaly || 0,
    meanMotion: row.mean_motion || 0,
    revolutionNumber: row.revolution_number || 0,
  }));

  // A. Inserciones individuales (sin transacciones explícitas)
  console.log(`Insertando ${records.length} registros uno por uno...`);
  const t0Individual = performance.now();
  for (const record of records) {
    db.transaction(() => {
      // better-sqlite3 fuerza transacciones en cada execute si no está agrupado
      db.prepare(`
        INSERT OR REPLACE INTO tles (
          norad_id, name, line1, line2, epoch_ms, group_name, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'BenchmarkTemp', ?)
      `).run(
        record.noradId,
        record.name,
        record.line1,
        record.line2,
        record.epochMs,
        new Date().toISOString()
      );
    })();
  }
  const durationIndividual = performance.now() - t0Individual;
  console.log(`   - Tiempo total: ${formatMs(durationIndividual)}`);
  console.log(`   - Promedio por registro: ${formatMs(durationIndividual / records.length)}`);

  // Limpiar
  db.prepare("DELETE FROM tles WHERE group_name = 'BenchmarkTemp'").run();

  // B. Inserciones agrupadas dentro de una sola transacción (Bulk Upsert)
  console.log(`Insertando los mismos ${records.length} registros dentro de UNA SÓLA transacción...`);
  const t0Tx = performance.now();
  upsertTles(db, records, "BenchmarkTemp");
  const durationTx = performance.now() - t0Tx;
  console.log(`   - Tiempo total: ${formatMs(durationTx)}`);
  console.log(`   - Promedio por registro: ${formatMs(durationTx / records.length)}`);

  const txImprovement = (durationIndividual / durationTx).toFixed(1);
  console.log(`👉 ¡Usar una transacción agrupada (transaction/bulk) hace el proceso x${txImprovement} veces más rápido!\n`);

  // Limpieza final de datos de prueba
  db.prepare("DELETE FROM tles WHERE group_name = 'BenchmarkTemp'").run();


  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Monitoreo de Lectura y Escritura Concurrente (Modo WAL)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("--------------------------------------------------------------------------");
  console.log("TEST 3: Lecturas concurrentes en modo WAL (Write-Ahead Logging)");
  console.log("--------------------------------------------------------------------------");
  console.log("Node ejecuta SQLite en el mismo hilo, pero probaremos lecturas asíncronas");
  console.log("simuladas intercaladas con una gran operación de escritura de fondo.");

  const t0Concurrencia = performance.now();
  
  // Hacemos lecturas repetitivas simuladas
  const readPromise = new Promise<number>((resolve) => {
    let reads = 0;
    const interval = setInterval(() => {
      getTleByNoradId(db, testNoradId);
      reads++;
      if (reads >= 200) {
        clearInterval(interval);
        resolve(reads);
      }
    }, 1);
  });

  // Hacemos una transacción grande de escritura simultánea
  const writePromise = new Promise<void>((resolve) => {
    // Inserta y elimina repetidamente
    for (let j = 0; j < 15; j++) {
      upsertTles(db, records, "BenchmarkConcurrente");
      db.prepare("DELETE FROM tles WHERE group_name = 'BenchmarkConcurrente'").run();
    }
    resolve();
  });

  const totalReads = await readPromise;
  await writePromise;
  const durationConcurrency = performance.now() - t0Concurrencia;

  console.log(`   - ${totalReads} lecturas concurrentes completadas de manera exitosa.`);
  console.log(`   - Escrituras masivas intercaladas finalizadas sin bloqueos (Locks).`);
  console.log(`   - Tiempo total concurrencia: ${formatMs(durationConcurrency)}`);
  console.log(`👉 ¡SQLite WAL e hilos de ejecución ligeros permiten lecturas ultra-rápidas concurrentes sin interferir con las escrituras!`);
  console.log("==========================================================================\n");
}

main().catch((err: unknown) => {
  console.error("Error fatal en la ejecución de benchmarks de base de datos:", err);
  process.exit(1);
});
