// Re-export shared API contract types — single source of truth in @satellites/types
import type { SatellitePass, SatelliteState } from '@satellites/types';
export type {
  SatelliteSummary,
  OrbitClass,
  PassPoint,
  CelestialPosition,
  SatellitePass,
  FindPassesResult,
  StarlinkCensusEntry,
  StarlinkCensusResult,
  SatelliteState,
  Vector3,
  GeodeticPosition,
} from '@satellites/types';

// ─── FE-only types (not part of the HTTP API contract) ───────────────────────

export interface PositionState {
  data: SatelliteState | null;
  error: string | null;
  loading: boolean;
}

export interface PassSelection {
  pass:        SatellitePass;
  observerLat: number;
  observerLon: number;
}
