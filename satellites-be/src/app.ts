"use strict";

import express, { type Request, type Response, type NextFunction } from "express";
import helmet      from "helmet";
import cors        from "cors";
import swaggerUi   from "swagger-ui-express";
import type Database from "better-sqlite3";

import { satelliteRouter } from "./routes/satellite.routes.js";
import { passesRouter }    from "./routes/passes.routes.js";
import { starlinkRouter }  from "./routes/starlink.routes.js";
import { statusRouter }    from "./routes/status.routes.js";
import { openApiSpec }     from "./openapi/registry.js";
import { logger }          from "./logger.js";

export function createApp(db: Database.Database): express.Application {
  const app = express();

  // ─── Security middleware ─────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());

  // ─── API routes ──────────────────────────────────────────────────────────
  app.use("/api", satelliteRouter(db));
  app.use("/api", passesRouter(db));
  app.use("/api", starlinkRouter(db));
  app.use("/api", statusRouter(db));

  // ─── OpenAPI docs ────────────────────────────────────────────────────────
  app.get("/api/openapi.json", (_req: Request, res: Response) => res.json(openApiSpec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // ─── Global error handler ────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
