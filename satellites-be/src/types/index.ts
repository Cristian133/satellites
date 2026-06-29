"use strict";

// Re-export API contract types from the shared package — single source of truth
export type {
  SatelliteSummary,
  OrbitClass,
  FindPassesResult,
  SatellitePass,
  PassPoint,
  CelestialPosition,
  StarlinkCensusResult,
  StarlinkCensusEntry,
} from "@satellites/types";

// BE-internal types (not part of the HTTP API contract)

export interface TleRow {
  name:     string;
  line1:    string;
  line2:    string;
  epoch_ms: number;
}

export interface HealthResult {
  status:          "healthy" | "degraded";
  uptime_s:        number;
  totalSatellites: number;
  tle: {
    oldestEpochMs: number;
    newestEpochMs: number;
    ageHours:      number;
  };
  lastSync: unknown;
  db:       { ok: boolean };
}
