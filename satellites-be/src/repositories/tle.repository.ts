"use strict";

import Database          from "better-sqlite3";
import type { TleRecord } from "../tle-parser.js";
import type { SatelliteSummary, StatsResult, StarlinkCensusResult, TleRow } from "../types/index.js";

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface DbTleRow extends TleRecord {
  updated_at:        string;
  epoch_ms:          number;
  norad_id:          number;
  intl_designator:   string;
  mean_motion_dot:   number;
  arg_perigee:       number;
  mean_anomaly:      number;
  mean_motion:       number;
  revolution_number: number;
}

interface EpochRow  { epoch_ms: number }
interface CountRow  { n: number }

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

interface SearchRow {
  norad_id:    number;
  name:        string;
  group_name:  string;
  inclination: number;
  period_min:  number;
  country?:    string;
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

// ─── Prepared statement cache ─────────────────────────────────────────────────

interface Stmts {
  getByNorad: Database.Statement<[number], DbTleRow>;
  getEpoch:   Database.Statement<[number], EpochRow>;
  count:      Database.Statement<[], CountRow>;
  lastSync:   Database.Statement<[], SyncLogRow>;
  startLog:   Database.Statement<[string, string]>;
  finishLog:  Database.Statement<[string, number, number, number, number, string, number]>;
  upsert:     Database.Statement<UpsertParams>;
  search:     Database.Statement<[string, string, string, number], SearchRow>;
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
      SELECT t.norad_id, t.name,
             COALESCE(t.group_name, 'Other') AS group_name,
             t.inclination,
             ROUND(1440.0 / t.mean_motion, 0) AS period_min,
             c.country
        FROM tles t
        LEFT JOIN satcat_countries c ON t.norad_id = c.norad_id
       WHERE t.name LIKE ? OR CAST(t.norad_id AS TEXT) LIKE ?
       ORDER BY
         CASE WHEN UPPER(t.name) LIKE ? THEN 0 ELSE 1 END,
         CASE t.group_name
           WHEN 'Space Stations'      THEN 0
           WHEN 'Visually Observable' THEN 1
           WHEN 'Weather'             THEN 2
           WHEN 'Amateur Radio'       THEN 3
           WHEN 'Starlink'            THEN 4
           WHEN 'OneWeb'              THEN 5
           WHEN 'GPS Operational'     THEN 6
           WHEN 'GLONASS Operational' THEN 7
           WHEN 'Galileo'             THEN 8
           WHEN 'BeiDou'              THEN 9
           WHEN 'Science'             THEN 10
           WHEN 'Geodetic'            THEN 11
           ELSE 12 END,
         t.name ASC
       LIMIT ?
    `),
  };

  stmtCache.set(db, s);
  return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
  const now     = new Date().toISOString();
  let inserted  = 0;
  let updated   = 0;

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

export function searchSatellites(
  db:    Database.Database,
  q:     string,
  limit  = 120,
): SatelliteSummary[] {
  let processedQ = q.trim();

  if (processedQ.toLowerCase() === "starlinks") processedQ = "starlink";

  if (/^starlinks?\s+\d+$/i.test(processedQ)) {
    processedQ = processedQ.replace(/\s+/, "-").replace(/starlinks/i, "starlink");
  }

  const term  = `%${processedQ}%`;
  const start = `${processedQ.toUpperCase()}%`;
  const rows  = stmts(db).search.all(term, term, start, limit) as SearchRow[];

  return rows.map(r => ({
    noradId:     r.norad_id,
    name:        r.name,
    groupName:   r.group_name,
    inclination: Math.round(r.inclination * 10) / 10,
    periodMin:   Math.round(r.period_min),
    country:     r.country,
  }));
}

export function getTleByNoradId(db: Database.Database, noradId: number): (DbTleRow & TleRow) | undefined {
  return stmts(db).getByNorad.get(noradId) as (DbTleRow & TleRow) | undefined;
}

export function getStats(db: Database.Database): StatsResult {
  const { count, lastSync } = stmts(db);
  return {
    totalSatellites: count.get()!.n,
    lastSync:        lastSync.get() ?? null,
  };
}

export interface FinishSyncParams {
  totalParsed:  number;
  inserted:     number;
  updated:      number;
  parseErrors:  number;
  status:       string;
}

export function startSyncLog(db: Database.Database, sourceUrl: string): number {
  return stmts(db).startLog.run(sourceUrl, new Date().toISOString()).lastInsertRowid as number;
}

export function finishSyncLog(db: Database.Database, id: number, p: FinishSyncParams): void {
  stmts(db).finishLog.run(
    new Date().toISOString(),
    p.totalParsed, p.inserted, p.updated, p.parseErrors, p.status, id,
  );
}

export function getStarlinkCensus(db: Database.Database): StarlinkCensusResult {
  const rows = db.prepare(`
    SELECT norad_id, name, mean_motion, epoch_ms
      FROM tles
     WHERE group_name = 'Starlink'
  `).all() as { norad_id: number; name: string; mean_motion: number; epoch_ms: number }[];

  let total = 0, active = 0, climbing = 0, decaying = 0;
  const criticalList:   { noradId: number; name: string; altKm: number; epochMs: number }[] = [];
  const allSatellites:  { noradId: number; name: string; altKm: number; epochMs: number }[] = [];

  const G_M = 7.537125e13;

  for (const r of rows) {
    if (r.mean_motion <= 0) continue;
    total++;
    const a_km  = Math.pow(G_M / (r.mean_motion * r.mean_motion), 1 / 3);
    const altKm = Math.round((a_km - 6371) * 10) / 10;
    const entry = { noradId: r.norad_id, name: r.name, altKm, epochMs: r.epoch_ms };

    allSatellites.push(entry);

    if (altKm >= 540)      active++;
    else if (altKm >= 340) climbing++;
    else { decaying++; criticalList.push(entry); }
  }

  criticalList.sort((a, b) => a.altKm - b.altKm);

  return {
    total, active, climbing, decaying,
    criticalList:   criticalList.slice(0, 10),
    recentLaunches: [...allSatellites].sort((a, b) => b.epochMs - a.epochMs).slice(0, 15),
  };
}
