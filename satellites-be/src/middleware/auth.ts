"use strict";

import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

/**
 * Validates the `x-api-key` header against the `API_KEY` env var.
 * If `API_KEY` is not configured the middleware is a no-op — useful for
 * local development without requiring a key to be set.
 *
 * Apply to any future write (POST/PUT/DELETE) endpoint:
 *   router.post('/resource', requireApiKey, handler)
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.API_KEY) {
    next();
    return;
  }

  const provided = req.headers["x-api-key"];
  if (provided === env.API_KEY) {
    next();
    return;
  }

  res.status(401).json({ error: "Invalid or missing API key" });
}
