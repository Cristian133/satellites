"use strict";

// Re-export API contract types from the shared package — single source of truth
export type {
  SatelliteSummary,
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

export interface StatsResult {
  totalSatellites: number;
  lastSync:        unknown;
}
