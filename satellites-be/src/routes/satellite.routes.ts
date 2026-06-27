"use strict";

import { Router } from "express";
import type Database from "better-sqlite3";
import { makeSatelliteControllers } from "../controllers/satellite.controller.js";

export function satelliteRouter(db: Database.Database): Router {
  const router = Router();
  const ctrl   = makeSatelliteControllers(db);

  router.get("/satellite/:id", ctrl.getPosition);
  router.get("/satellites",    ctrl.search);

  return router;
}
