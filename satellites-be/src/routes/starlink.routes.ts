"use strict";

import { Router }     from "express";
import type Database  from "better-sqlite3";
import { makeStarlinkController } from "../controllers/starlink.controller.js";

export function starlinkRouter(db: Database.Database): Router {
  const router = Router();
  const ctrl   = makeStarlinkController(db);

  router.get("/starlink/census", ctrl.getCensus);

  return router;
}
