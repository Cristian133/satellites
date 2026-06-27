"use strict";

import Database from "better-sqlite3";
import { logger } from "../logger.js";

interface Migration {
  version: number;
  name:    string;
  sql:     string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name:    "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS tles (
        norad_id          INTEGER PRIMARY KEY,
        name              TEXT    NOT NULL,
        line1             TEXT    NOT NULL,
        line2             TEXT    NOT NULL,
        epoch_ms          INTEGER NOT NULL,
        classification    TEXT,
        intl_designator   TEXT,
        bstar             REAL,
        mean_motion_dot   REAL,
        inclination       REAL,
        raan              REAL,
        eccentricity      REAL,
        arg_perigee       REAL,
        mean_anomaly      REAL,
        mean_motion       REAL,
        revolution_number INTEGER,
        group_name        TEXT,
        updated_at        TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url   TEXT    NOT NULL,
        started_at   TEXT    NOT NULL,
        finished_at  TEXT,
        total_parsed INTEGER DEFAULT 0,
        inserted     INTEGER DEFAULT 0,
        updated      INTEGER DEFAULT 0,
        parse_errors INTEGER DEFAULT 0,
        status       TEXT    NOT NULL DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS satcat_countries (
        norad_id INTEGER PRIMARY KEY,
        country  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tles_name  ON tles (name);
      CREATE INDEX IF NOT EXISTS idx_tles_group ON tles (group_name);
    `,
  },
  {
    version: 2,
    name:    "add_group_name",
    sql:     "ALTER TABLE tles ADD COLUMN group_name TEXT",
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    );
  `);

  const applied = db.prepare("SELECT version FROM schema_migrations WHERE version = ?");
  const record  = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const m of MIGRATIONS) {
    if (applied.get(m.version)) continue;

    try {
      db.exec(m.sql);
    } catch (err) {
      // Idempotent failures (e.g. ALTER TABLE on existing column) are expected on old DBs.
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ migration: m.name, err: msg }, `[migrations] Migration ${m.version} skipped (already applied)`);
    }

    record.run(m.version, m.name, new Date().toISOString());
    logger.info({ version: m.version, name: m.name }, "[migrations] Applied migration");
  }
}
