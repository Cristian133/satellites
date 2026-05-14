"use strict";

import Database from "better-sqlite3";
import path     from "path";
import fs       from "fs";
import type { TleRecord } from "./tle-parser";

const DB_PATH =
  process.env["DB_PATH"] ??
  path.join(__dirname, "..", "data", "satellites.db");

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface TleRow extends TleRecord {
  updated_at:       string;
  epoch_ms:         number;
  norad_id:         number;
  intl_designator:  string;
  mean_motion_dot:  number;
  arg_perigee:      number;
  mean_anomaly:     number;
  mean_motion:      number;
  revolution_number: number;
}

interface EpochRow {
  epoch_ms: number;
}

interface CountRow {
  n: number;
}

interface SyncLogRow {
  id:           number;
  source_url:   string;
  started_at:   string;
  finished_at:  string | null;
  total_parsed: number;
  inserted:     number;
  updated:      number;
  parse_errors: number;
  status:       string;
}

// ─── Prepared statement cache ─────────────────────────────────────────────────

interface Stmts {
  getByNorad: Database.Statement<[number], TleRow>;
  getEpoch:   Database.Statement<[number], EpochRow>;
  count:      Database.Statement<[], CountRow>;
  lastSync:   Database.Statement<[], SyncLogRow>;
  startLog:   Database.Statement<[string, string]>;
  finishLog:  Database.Statement<[string, number, number, number, number, string, number]>;
  upsert:     Database.Statement<UpsertParams>;
  search:     Database.Statement<[string, string, string, number], SearchRow>;
}

interface SearchRow {
  norad_id:    number;
  name:        string;
  group_name:  string;
  inclination: number;
  period_min:  number;
}

interface UpsertParams extends Record<string, unknown> {
  noradId:          number;
  name:             string;
  line1:            string;
  line2:            string;
  epochMs:          number;
  classification:   string;
  intlDesignator:   string;
  bstar:            number;
  meanMotionDot:    number;
  inclination:      number;
  raan:             number;
  eccentricity:     number;
  argPerigee:       number;
  meanAnomaly:      number;
  meanMotion:       number;
  revolutionNumber: number;
  groupName:        string;
  updatedAt:        string;
}

const stmtCache = new WeakMap<Database.Database, Stmts>();

function stmts(db: Database.Database): Stmts {
  const cached = stmtCache.get(db);
  if (cached) return cached;

  const s: Stmts = {
    getByNorad: db.prepare("SELECT * FROM tles WHERE norad_id = ?"),
    getEpoch:   db.prepare("SELECT epoch_ms FROM tles WHERE norad_id = ?"),
    count:      db.prepare("SELECT COUNT(*) AS n FROM tles"),
    lastSync:   db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"),
    startLog:   db.prepare(
      "INSERT INTO sync_log (source_url, started_at, status) VALUES (?, ?, 'running')"
    ),
    finishLog: db.prepare(`
      UPDATE sync_log
         SET finished_at = ?, total_parsed = ?, inserted = ?,
             updated = ?, parse_errors = ?, status = ?
       WHERE id = ?
    `),
    upsert: db.prepare(`
      INSERT INTO tles (
        norad_id, name, line1, line2, epoch_ms,
        classification, intl_designator, bstar, mean_motion_dot,
        inclination, raan, eccentricity, arg_perigee,
        mean_anomaly, mean_motion, revolution_number, group_name, updated_at
      ) VALUES (
        @noradId, @name, @line1, @line2, @epochMs,
        @classification, @intlDesignator, @bstar, @meanMotionDot,
        @inclination, @raan, @eccentricity, @argPerigee,
        @meanAnomaly, @meanMotion, @revolutionNumber, @groupName, @updatedAt
      )
      ON CONFLICT(norad_id) DO UPDATE SET
        name              = excluded.name,
        line1             = excluded.line1,
        line2             = excluded.line2,
        epoch_ms          = excluded.epoch_ms,
        classification    = excluded.classification,
        intl_designator   = excluded.intl_designator,
        bstar             = excluded.bstar,
        mean_motion_dot   = excluded.mean_motion_dot,
        inclination       = excluded.inclination,
        raan              = excluded.raan,
        eccentricity      = excluded.eccentricity,
        arg_perigee       = excluded.arg_perigee,
        mean_anomaly      = excluded.mean_anomaly,
        mean_motion       = excluded.mean_motion,
        revolution_number = excluded.revolution_number,
        group_name        = excluded.group_name,
        updated_at        = excluded.updated_at
      WHERE excluded.epoch_ms > tles.epoch_ms
    `),
    search: db.prepare(`
      SELECT norad_id, name,
             COALESCE(group_name, 'Other') AS group_name,
             inclination,
             ROUND(1440.0 / mean_motion, 0) AS period_min
        FROM tles
       WHERE name LIKE ? OR CAST(norad_id AS TEXT) LIKE ?
       ORDER BY
         CASE WHEN UPPER(name) LIKE ? THEN 0 ELSE 1 END,
         CASE group_name
           WHEN 'Space Stations'      THEN 0
           WHEN 'Visually Observable' THEN 1
           WHEN 'Weather'             THEN 2
           WHEN 'Amateur Radio'       THEN 3
           ELSE 4 END,
         name ASC
       LIMIT ?
    `),
  };

  stmtCache.set(db, s);
  return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function openDatabase(dbPath: string = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
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
  `);

  // Migration: add group_name column to existing databases
  try { db.exec("ALTER TABLE tles ADD COLUMN group_name TEXT"); } catch { /* already exists */ }

  return db;
}

export interface UpsertResult {
  inserted: number;
  updated:  number;
}

export function upsertTles(
  db:        Database.Database,
  tles:      TleRecord[],
  groupName = "Other",
): UpsertResult {
  const { upsert, getEpoch } = stmts(db);
  const now = new Date().toISOString();
  let inserted = 0;
  let updated  = 0;

  const run = db.transaction((batch: TleRecord[]) => {
    for (const tle of batch) {
      const prev = getEpoch.get(tle.noradId);
      const info = upsert.run({ ...tle, groupName, updatedAt: now });
      if (info.changes === 1) {
        if (!prev) inserted++;
        else       updated++;
      }
    }
  });

  run(tles);
  return { inserted, updated };
}

export interface SatelliteSummary {
  noradId:    number;
  name:       string;
  groupName:  string;
  inclination: number;
  periodMin:  number;
}

export function searchSatellites(
  db:    Database.Database,
  q:     string,
  limit  = 120,
): SatelliteSummary[] {
  const term  = `%${q}%`;
  const start = `${q.toUpperCase()}%`;
  const rows  = stmts(db).search.all(term, term, start, limit) as SearchRow[];
  return rows.map(r => ({
    noradId:     r.norad_id,
    name:        r.name,
    groupName:   r.group_name,
    inclination: Math.round(r.inclination * 10) / 10,
    periodMin:   Math.round(r.period_min),
  }));
}

export function getTleByNoradId(db: Database.Database, noradId: number): TleRow | undefined {
  return stmts(db).getByNorad.get(noradId);
}

export interface StatsResult {
  totalSatellites: number;
  lastSync:        SyncLogRow | null;
}

export function getStats(db: Database.Database): StatsResult {
  const { count, lastSync } = stmts(db);
  return {
    totalSatellites: count.get()!.n,
    lastSync:        lastSync.get() ?? null,
  };
}

export function startSyncLog(db: Database.Database, sourceUrl: string): number {
  return stmts(db).startLog.run(sourceUrl, new Date().toISOString()).lastInsertRowid as number;
}

export interface FinishSyncParams {
  totalParsed:  number;
  inserted:     number;
  updated:      number;
  parseErrors:  number;
  status:       string;
}

export function finishSyncLog(db: Database.Database, id: number, p: FinishSyncParams): void {
  stmts(db).finishLog.run(
    new Date().toISOString(),
    p.totalParsed,
    p.inserted,
    p.updated,
    p.parseErrors,
    p.status,
    id,
  );
}
