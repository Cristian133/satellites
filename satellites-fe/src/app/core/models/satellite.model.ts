// Re-export shared API contract types — single source of truth in @satellites/types
import type { SatellitePass } from '@satellites/types';
export type {
  SatelliteSummary,
  PassPoint,
  CelestialPosition,
  SatellitePass,
  FindPassesResult,
  StarlinkCensusEntry,
  StarlinkCensusResult,
} from '@satellites/types';

// ─── FE-only types (not part of the HTTP API contract) ───────────────────────

export interface SatellitePosition {
  lat_deg: number;
  lon_deg: number;
  alt_km: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface SatelliteApiResponse {
  satellite: {
    noradId: number;
    name: string;
  };
  tle: {
    line1: string;
    line2: string;
    epochMs: number;
  };
  propagation: {
    t_minutes: number;
    timestamp: string;
  };
  state: {
    teme: { position_km: Vector3; velocity_km_s: Vector3 };
    ecef: { position_km: Vector3 };
    geodetic: SatellitePosition;
  };
}

export interface PositionState {
  data: SatelliteApiResponse | null;
  error: string | null;
  loading: boolean;
}

export interface PassSelection {
  pass:        SatellitePass;
  observerLat: number;
  observerLon: number;
}
