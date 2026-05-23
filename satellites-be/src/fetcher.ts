"use strict";

import cron                                        from "node-cron";
import type Database                               from "better-sqlite3";
import { parseCatalog }                            from "./tle-parser.js";
import { upsertTles, startSyncLog, finishSyncLog } from "./db.js";

interface Source {
  name: string;
  url:  string;
}

export interface SyncResult {
  inserted:    number;
  updated:     number;
  parseErrors: number;
}

const SOURCES: Source[] = [
  { name: "Space Stations",      url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" },
  { name: "Visually Observable", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle"   },
  { name: "Weather",             url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle"  },
  { name: "Amateur Radio",       url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle"  },
  { name: "Starlink",            url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle" },
  { name: "OneWeb",              url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=tle"   },
  { name: "GPS Operational",     url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle" },
  { name: "GLONASS Operational", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle" },
  { name: "Galileo",             url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle" },
  { name: "BeiDou",              url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=tle"  },
  { name: "Science",             url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle" },
  { name: "Geodetic",            url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=geodetic&FORMAT=tle"},
];

// ─── HTTP fetch with timeout ──────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "satellites-api/1.0 (educational project)" },
    signal:  AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

// ─── Single-source sync ───────────────────────────────────────────────────────

async function syncSource(db: Database.Database, source: Source): Promise<SyncResult> {
  const logId = startSyncLog(db, source.url);
  const tag   = `[sync:${source.name}]`;
  let text: string;

  try {
    text = await fetchText(source.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} fetch failed: ${message}`);
    finishSyncLog(db, logId, { totalParsed: 0, inserted: 0, updated: 0, parseErrors: 1, status: "error" });
    return { inserted: 0, updated: 0, parseErrors: 1 };
  }

  const { tles, parseErrors, noNewData } = parseCatalog(text);

  if (noNewData) {
    console.log(`${tag} no new data since last fetch — skipping`);
    finishSyncLog(db, logId, { totalParsed: 0, inserted: 0, updated: 0, parseErrors: 0, status: "skipped" });
    return { inserted: 0, updated: 0, parseErrors: 0 };
  }

  if (parseErrors.length > 0) {
    console.warn(`${tag} ${parseErrors.length} TLE block(s) rejected:`);
    parseErrors.slice(0, 5).forEach((e) =>
      console.warn(`  "${e.name || "?"}" — ${e.errors.join("; ")}`)
    );
    if (parseErrors.length > 5)
      console.warn(`  … and ${parseErrors.length - 5} more`);
  }

  const { inserted, updated } = upsertTles(db, tles, source.name);
  console.log(`${tag} parsed ${tles.length}, inserted ${inserted}, updated ${updated}, rejected ${parseErrors.length}`);

  finishSyncLog(db, logId, {
    totalParsed: tles.length,
    inserted,
    updated,
    parseErrors: parseErrors.length,
    status:      "ok",
  });

  return { inserted, updated, parseErrors: parseErrors.length };
}

// ─── Sync SATCAT (Country mappings) ──────────────────────────────────────────

export async function syncSatcat(db: Database.Database): Promise<void> {
  console.log("[sync] Syncing SATCAT country registry...");
  try {
    const text = await fetchText("https://celestrak.org/pub/satcat.csv");
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return;

    const headers = lines[0].split(",");
    const noradIdx = headers.indexOf("NORAD_CAT_ID");
    const ownerIdx = headers.indexOf("OWNER");

    if (noradIdx === -1 || ownerIdx === -1) {
      console.error("[sync] SATCAT CSV columns not found in header:", lines[0]);
      return;
    }

    const insert = db.prepare("INSERT OR REPLACE INTO satcat_countries (norad_id, country) VALUES (?, ?)");

    const run = db.transaction((rows: [number, string][]) => {
      for (const [noradId, owner] of rows) {
        insert.run(noradId, owner);
      }
    });

    const batch: [number, string][] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const noradStr = cols[noradIdx]?.replace(/"/g, "").trim();
      const ownerStr = cols[ownerIdx]?.replace(/"/g, "").trim();
      if (noradStr && ownerStr) {
        const noradId = parseInt(noradStr, 10);
        if (!isNaN(noradId)) {
          batch.push([noradId, ownerStr]);
        }
      }
    }

    if (batch.length > 0) {
      run(batch);
      console.log(`[sync] Successfully synced ${batch.length} SATCAT entries.`);
    }
  } catch (err) {
    console.error("[sync] SATCAT sync failed:", err);
  }
}

// ─── Full sync (all sources in parallel) ─────────────────────────────────────

export async function syncAll(db: Database.Database): Promise<SyncResult> {
  console.log(`[sync] Starting full catalog sync (${SOURCES.length} sources)`);

  // First sync the SATCAT country mappings
  await syncSatcat(db).catch((err: unknown) => {
    console.error("[sync] SATCAT sync failed:", err);
  });

  const results = await Promise.all(SOURCES.map((source) => syncSource(db, source)));

  const totals = results.reduce<SyncResult>(
    (acc, r) => ({
      inserted:    acc.inserted    + r.inserted,
      updated:     acc.updated     + r.updated,
      parseErrors: acc.parseErrors + r.parseErrors,
    }),
    { inserted: 0, updated: 0, parseErrors: 0 }
  );

  console.log(
    `[sync] Complete — total inserted: ${totals.inserted}, updated: ${totals.updated}, errors: ${totals.parseErrors}`
  );
  return totals;
}

// ─── Cron scheduler ───────────────────────────────────────────────────────────

export function startCronJob(db: Database.Database): void {
  const schedule = process.env["SYNC_SCHEDULE"] ?? "0 */6 * * *";

  if (!cron.validate(schedule)) {
    console.error(`[cron] Invalid SYNC_SCHEDULE expression: "${schedule}"`);
    return;
  }

  cron.schedule(schedule, async () => {
    console.log(`[cron] Scheduled sync triggered (${new Date().toISOString()})`);
    try {
      await syncAll(db);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[cron] Sync error:", message);
    }
  });

  console.log(`[cron] TLE sync scheduled: "${schedule}"`);
}
