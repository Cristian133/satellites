"use strict";

import { Router }          from "express";
import { metricsRegistry } from "../metrics/registry.js";

export function metricsRouter(): Router {
  const router = Router();

  router.get("/metrics", async (_req, res) => {
    res.set("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  return router;
}
