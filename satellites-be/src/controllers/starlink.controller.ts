"use strict";

import type { Request, Response } from "express";
import { getStarlinkCensus }      from "../repositories/tle.repository.js";
import type Database              from "better-sqlite3";

export function makeStarlinkController(db: Database.Database) {
  return {
    getCensus: (_req: Request, res: Response): void => {
      try {
        res.json(getStarlinkCensus(db));
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    },
  };
}
