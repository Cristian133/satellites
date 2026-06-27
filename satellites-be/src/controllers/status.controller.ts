"use strict";

import type { Request, Response } from "express";
import { getStats }               from "../repositories/tle.repository.js";
import type Database              from "better-sqlite3";

export function makeStatusController(db: Database.Database) {
  return {
    getStatus: (_req: Request, res: Response): void => {
      res.json(getStats(db));
    },
  };
}
