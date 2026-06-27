"use strict";

import type { Request, Response } from "express";
import { SatelliteIdParam, SearchQuery } from "../schemas/index.js";
import { getTleByNoradId, searchSatellites } from "../repositories/tle.repository.js";
import { propagateSatellite } from "../services/propagation.service.js";
import type Database from "better-sqlite3";

export function makeSatelliteControllers(db: Database.Database) {
  return {
    getPosition: async (req: Request, res: Response): Promise<void> => {
      const parsed = SatelliteIdParam.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "NORAD ID must be a positive integer" });
        return;
      }
      const { id: noradId } = parsed.data;

      const row = getTleByNoradId(db, noradId);
      if (!row) {
        res.status(404).json({
          error: `No TLE found for NORAD ID ${noradId}`,
          hint:  "Catalog sync may still be in progress — try again in a few seconds",
        });
        return;
      }

      try {
        const state = await propagateSatellite(noradId, row);
        res.json(state);
      } catch (err) {
        res.status(500).json({ error: "SGP4 propagation failed", detail: String(err) });
      }
    },

    search: (req: Request, res: Response): void => {
      const parsed = SearchQuery.safeParse(req.query);
      const q      = parsed.success ? parsed.data.q : "";
      res.json(searchSatellites(db, q));
    },
  };
}
