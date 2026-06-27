"use strict";

import { Router }     from "express";
import rateLimit      from "express-rate-limit";
import type Database  from "better-sqlite3";
import { makePassesController } from "../controllers/passes.controller.js";

const passesLimiter = rateLimit({
  windowMs:       60_000,
  max:            30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Too many requests — try again in a minute" },
});

export function passesRouter(db: Database.Database): Router {
  const router = Router();
  const ctrl   = makePassesController(db);

  router.get("/passes", passesLimiter, ctrl.getPasses);

  return router;
}
