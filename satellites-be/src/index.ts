"use strict";

import express,  { type Request, type Response } from "express";
import { bindings }                               from "@wasmer/sgp4";
import { Elements, Constants }                    from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import type { Result, Error as SgpError }         from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import type { Sgp4 }                              from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import { temeToGeodetic }                         from "./coords.js";
import { openDatabase, getTleByNoradId, getStats, searchSatellites } from "./db.js";
import { syncAll, startCronJob }                  from "./fetcher.js";
import { findPasses }                             from "./passes.js";

const PORT = process.env["PORT"] ?? 3000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveResult<T>(result: Result<T, SgpError>): T {
  if (result.tag === "err") throw result.val;
  return result.val;
}

function minutesSinceTleEpoch(line1: string): number {
  const epochStr  = line1.substring(18, 32).trim();
  const year2d    = parseInt(epochStr.substring(0, 2), 10);
  const year      = year2d >= 57 ? 1900 + year2d : 2000 + year2d;
  const dayOfYear = parseFloat(epochStr.substring(2));
  const epochMs   = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
  return (Date.now() - epochMs) / 60000;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const wasm: Sgp4 = await bindings.sgp4();
  const db         = openDatabase();

  const syncOnStart = process.env["SYNC_ON_START"] !== "false";
  if (syncOnStart) {
    syncAll(db).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[startup] Sync error:", message);
    });
  }

  startCronJob(db);

  // ─── Express app ─────────────────────────────────────────────────────────

  const app = express();

  const sgp4Cache = new Map<number, { epochMs: number; constants: Constants }>();

  // GET /api/satellite/:id  — propagate satellite to current instant
  app.get("/api/satellite/:id", (req: Request, res: Response) => {
    const noradId = parseInt(req.params["id"] as string, 10);
    if (isNaN(noradId) || noradId < 1) {
      res.status(400).json({ error: "NORAD ID must be a positive integer" });
      return;
    }

    const row = getTleByNoradId(db, noradId);
    if (!row) {
      res.status(404).json({
        error: `No TLE found for NORAD ID ${noradId}`,
        hint:  "Catalog sync may still be in progress — try again in a few seconds",
      });
      return;
    }

    const { name, line1, line2 } = row;

    let constants: Constants;
    const cached = sgp4Cache.get(noradId);
    if (cached && cached.epochMs === row.epoch_ms) {
      constants = cached.constants;
    } else {
      let elements:  Elements;
      try {
        elements  = resolveResult(Elements.fromTle(wasm, null, line1, line2));
        constants = resolveResult(Constants.fromElementsAfspcCompatibilityMode(wasm, elements));
        sgp4Cache.set(noradId, { epochMs: row.epoch_ms, constants });
      } catch (err) {
        res.status(500).json({ error: "SGP4 initialisation failed", detail: String(err) });
        return;
      }
    }

    const t = minutesSinceTleEpoch(line1);

    let prediction: ReturnType<typeof constants.propagateAfspcCompatibilityMode> extends Result<infer P, unknown> ? P : never;
    try {
      prediction = resolveResult(constants.propagateAfspcCompatibilityMode(t));
    } catch (err) {
      res.status(500).json({ error: "SGP4 propagation failed", detail: String(err) });
      return;
    }

    const [px, py, pz] = prediction.position;
    const [vx, vy, vz] = prediction.velocity;
    const now           = new Date();
    const { lat_deg, lon_deg, alt_km, ecef_km } = temeToGeodetic([px, py, pz], now);

    res.json({
      satellite: { noradId, name },
      tle:       { line1, line2, epochMs: row.epoch_ms },
      propagation: {
        t_minutes: parseFloat(t.toFixed(6)),
        timestamp: now.toISOString(),
      },
      state: {
        teme: {
          position_km:   { x: px, y: py, z: pz },
          velocity_km_s: { x: vx, y: vy, z: vz },
        },
        ecef:     { position_km: { x: ecef_km[0], y: ecef_km[1], z: ecef_km[2] } },
        geodetic: { lat_deg, lon_deg, alt_km },
      },
    });
  });

  // GET /api/satellites  — search satellites by name or NORAD ID
  //   Optional: q (search term, default "")
  app.get("/api/satellites", (req: Request, res: Response) => {
    const q = ((req.query["q"] as string) ?? "").trim();
    res.json(searchSatellites(db, q));
  });

  // GET /api/status  — catalog stats and last sync info
  app.get("/api/status", (_req: Request, res: Response) => {
    res.json(getStats(db));
  });

  // GET /api/passes  — predict visible passes from an observer location
  //   Required: noradId, lat, lon
  //   Optional: alt (km, default 0), days (default 3, max 10), minEl (deg, default 10)
  app.get("/api/passes", (req: Request, res: Response) => {
    const noradId = parseInt(req.query["noradId"] as string, 10);
    const lat     = parseFloat(req.query["lat"] as string);
    const lon     = parseFloat(req.query["lon"] as string);
    const alt     = parseFloat((req.query["alt"] as string) ?? "0") || 0;
    const days    = parseInt((req.query["days"] as string) ?? "3", 10)   || 3;
    const minEl   = parseFloat((req.query["minEl"] as string) ?? "10")   || 10;

    if (isNaN(noradId) || noradId < 1)
      return void res.status(400).json({ error: "noradId must be a positive integer" });
    if (isNaN(lat) || lat < -90 || lat > 90)
      return void res.status(400).json({ error: "lat must be in [-90, 90]" });
    if (isNaN(lon) || lon < -180 || lon > 180)
      return void res.status(400).json({ error: "lon must be in [-180, 180]" });

    try {
      const result = findPasses(db, wasm, noradId, { lat_deg: lat, lon_deg: lon, alt_km: alt }, { days, minElevation_deg: minEl });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Satellites API listening on http://localhost:${PORT}`);
    console.log(`  GET /api/satellite/:noradId   — propagate satellite`);
    console.log(`  GET /api/status               — catalog stats`);
    console.log(`  GET /api/passes               — predict passes from observer`);
  });
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
