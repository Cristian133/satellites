"use strict";

import { Router }    from "express";
import type Database from "better-sqlite3";
import { makeStatusController } from "../controllers/status.controller.js";

export function statusRouter(db: Database.Database): Router {
  const router = Router();
  const ctrl   = makeStatusController(db);

  router.get("/status", ctrl.getStatus);

  return router;
}
