"use strict";

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new Counter({
  name:       "http_requests_total",
  help:       "Total HTTP requests by method, route pattern and status code",
  labelNames: ["method", "route", "status"] as const,
  registers:  [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name:       "http_request_duration_seconds",
  help:       "HTTP request latency in seconds",
  labelNames: ["method", "route"] as const,
  buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers:  [metricsRegistry],
});

export const passCalculationDuration = new Histogram({
  name:      "pass_calculation_duration_seconds",
  help:      "Worker round-trip time for satellite pass calculation in seconds",
  buckets:   [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export const tleAgeHoursGauge = new Gauge({
  name:      "tle_age_hours",
  help:      "Hours since the oldest TLE epoch currently in the catalog",
  registers: [metricsRegistry],
});

export const syncFailuresTotal = new Counter({
  name:       "sync_failures_total",
  help:       "Total TLE fetch failures by source name",
  labelNames: ["source"] as const,
  registers:  [metricsRegistry],
});

export const syncConsecutiveFailures = new Gauge({
  name:      "sync_consecutive_failures",
  help:      "Number of consecutive full-sync cycles that ended in error",
  registers: [metricsRegistry],
});

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startNs = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    // req.route.path is the pattern (e.g. '/passes'), avoiding high-cardinality from raw URLs
    const route = (req.route as { path?: string } | undefined)?.path ?? "unknown";
    httpRequestsTotal.inc({ method: req.method, route, status: String(res.statusCode) });
    httpRequestDuration.observe({ method: req.method, route }, durationSeconds);
  });

  next();
}
