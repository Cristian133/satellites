"use strict";

import Database from "better-sqlite3";
import path     from "path";
import fs       from "fs";
import { runMigrations } from "./migrations/runner.js";
import { env } from "./config/env.js";

const DB_PATH = env.DB_PATH ?? path.join(__dirname, "..", "data", "satellites.db");

export function openDatabase(dbPath: string = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  runMigrations(db);
  return db;
}

// Re-export repository functions so existing callers (benchmark, etc.) don't break
export {
  upsertTles,
  searchSatellites,
  getTleByNoradId,
  getStats,
  startSyncLog,
  finishSyncLog,
  getStarlinkCensus,
} from "./repositories/tle.repository.js";
export type { UpsertResult, FinishSyncParams } from "./repositories/tle.repository.js";
