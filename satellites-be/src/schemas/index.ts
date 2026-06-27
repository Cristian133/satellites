"use strict";

import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

// ─── Param schemas ────────────────────────────────────────────────────────────

export const SatelliteIdParam = z.object({
  id: z.coerce.number().int().positive().openapi({ description: "NORAD catalog number", example: 25544 }),
});

// ─── Query schemas ────────────────────────────────────────────────────────────

export const SearchQuery = z.object({
  q: z.string().default("").openapi({ description: "Satellite name or NORAD ID fragment", example: "ISS" }),
});

export const PassesQuery = z.object({
  noradId: z.coerce.number().int().positive().openapi({ description: "NORAD catalog number",   example: 25544 }),
  lat:     z.coerce.number().min(-90).max(90).openapi({ description: "Observer latitude (°)",   example: 40.7128 }),
  lon:     z.coerce.number().min(-180).max(180).openapi({ description: "Observer longitude (°)", example: -74.006 }),
  alt:     z.coerce.number().default(0).openapi({ description: "Observer altitude (km)",         example: 0 }),
  days:    z.coerce.number().int().min(1).max(10).default(3).openapi({ description: "Prediction horizon (1–10 days)", example: 3 }),
  minEl:   z.coerce.number().min(0).max(90).default(10).openapi({ description: "Minimum elevation in degrees",        example: 10 }),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type SatelliteIdParamType = z.infer<typeof SatelliteIdParam>;
export type SearchQueryType      = z.infer<typeof SearchQuery>;
export type PassesQueryType      = z.infer<typeof PassesQuery>;
