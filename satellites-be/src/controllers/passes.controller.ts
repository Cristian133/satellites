"use strict";

import type { Request, Response } from "express";
import { PassesQuery }            from "../schemas/index.js";
import { getTleByNoradId }        from "../repositories/tle.repository.js";
import { findPassesInWorker }     from "../services/pass-prediction.service.js";
import type Database              from "better-sqlite3";

export function makePassesController(db: Database.Database) {
  return {
    getPasses: async (req: Request, res: Response): Promise<void> => {
      const parsed = PassesQuery.safeParse(req.query);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.status(400).json({ error: first?.message ?? "Invalid query parameters" });
        return;
      }

      const { noradId, lat, lon, alt, days, minEl } = parsed.data;

      const row = getTleByNoradId(db, noradId);
      if (!row) {
        res.status(404).json({
          error: `No TLE found for NORAD ID ${noradId}`,
          hint:  "Catalog sync may still be in progress — try again in a few seconds",
        });
        return;
      }

      try {
        const result = await findPassesInWorker({
          tleRow:   { name: row.name, line1: row.line1, line2: row.line2, epoch_ms: row.epoch_ms },
          noradId,
          observer: { lat_deg: lat, lon_deg: lon, alt_km: alt },
          opts:     { days, minElevation_deg: minEl },
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
