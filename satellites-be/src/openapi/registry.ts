"use strict";

import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  SatelliteIdParam,
  SearchQuery,
  PassesQuery,
} from "../schemas/index.js";

const registry = new OpenAPIRegistry();

// ─── Response schemas ─────────────────────────────────────────────────────────

const SatelliteSummarySchema = z.object({
  noradId:     z.number(),
  name:        z.string(),
  groupName:   z.string(),
  inclination: z.number(),
  periodMin:   z.number(),
  country:     z.string().optional(),
}).openapi("SatelliteSummary");

const PassPointSchema = z.object({
  time:   z.string(),
  az_deg: z.number(),
  el_deg: z.number(),
}).openapi("PassPoint");

const SatellitePassSchema = z.object({
  rise:             PassPointSchema,
  peak:             PassPointSchema,
  set:              PassPointSchema,
  visible:          z.boolean(),
  maxElevation_deg: z.number(),
  duration_s:       z.number(),
  magnitude:        z.number().nullable(),
}).openapi("SatellitePass");

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");

// ─── Register paths ───────────────────────────────────────────────────────────

registry.registerPath({
  method:  "get",
  path:    "/satellite/{id}",
  summary: "Get current satellite position",
  tags:    ["Satellites"],
  request: { params: SatelliteIdParam },
  responses: {
    200: { description: "Current satellite state" },
    400: { description: "Invalid NORAD ID",    content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Satellite not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method:  "get",
  path:    "/satellites",
  summary: "Search satellites by name or NORAD ID",
  tags:    ["Satellites"],
  request: { query: SearchQuery },
  responses: {
    200: {
      description: "List of matching satellites",
      content: { "application/json": { schema: z.array(SatelliteSummarySchema) } },
    },
  },
});

registry.registerPath({
  method:  "get",
  path:    "/passes",
  summary: "Predict visible passes from an observer location",
  tags:    ["Passes"],
  request: { query: PassesQuery },
  responses: {
    200: {
      description: "Predicted passes",
      content: { "application/json": { schema: z.object({ passes: z.array(SatellitePassSchema) }) } },
    },
    400: { description: "Invalid parameters", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Satellite not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method:  "get",
  path:    "/status",
  summary: "Catalog stats and last sync info",
  tags:    ["Status"],
  responses: {
    200: { description: "Status information" },
  },
});

registry.registerPath({
  method:  "get",
  path:    "/starlink/census",
  summary: "Starlink constellation analytical census",
  tags:    ["Starlink"],
  responses: {
    200: { description: "Starlink census data" },
  },
});

// ─── Generate spec ────────────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiSpec = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title:       "Satellites API",
    version:     "1.0.0",
    description: "REST API for real-time satellite tracking, pass prediction, and orbital data.",
  },
  servers: [{ url: "/api" }],
});
