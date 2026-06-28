"use strict";

import type { Request, Response } from "express";
import { getHealth }              from "../repositories/tle.repository.js";
import type Database              from "better-sqlite3";

export function makeStatusController(db: Database.Database) {
  return {
    getStatus: (_req: Request, res: Response): void => {
      const health = getHealth(db);
      res.status(health.status === "healthy" ? 200 : 503).json(health);
    },
  };
}
