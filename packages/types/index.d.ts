/**
 * @satellites/types — shared API contract between BE and FE.
 * Types here are the single source of truth for any shape that crosses
 * the HTTP boundary. Never redefine these in satellites-be or satellites-fe.
 */

// ─── Satellite catalogue ──────────────────────────────────────────────────────

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface SatelliteSummary {
  noradId:     number;
  name:        string;
  groupName:   string;
  inclination: number;
  periodMin:   number;
  orbitClass:  OrbitClass;
  country?:    string;
}

// ─── Pass prediction ──────────────────────────────────────────────────────────

export interface PassPoint {
  time:   string;
  az_deg: number;
  el_deg: number;
}

export interface CelestialPosition {
  name:   string;
  az_deg: number;
  el_deg: number;
  icon:   string;
}

export interface SatellitePass {
  rise:             PassPoint;
  peak:             PassPoint;
  set:              PassPoint;
  visible:          boolean;
  maxElevation_deg: number;
  duration_s:       number;
  magnitude:        number | null;
  track:            PassPoint[];
  celestialBodies:  CelestialPosition[];
}

export interface FindPassesResult {
  satellite: { noradId: number; name: string; tleAge_h: number };
  observer:  { lat_deg: number; lon_deg: number; alt_km: number };
  passes:    SatellitePass[];
}

// ─── Satellite position (HTTP response from /api/satellite/:id) ───────────────

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GeodeticPosition {
  readonly lat_deg: number;
  readonly lon_deg: number;
  readonly alt_km: number;
}

export interface SatelliteState {
  readonly satellite:   { readonly noradId: number; readonly name: string };
  readonly tle:         { readonly line1: string; readonly line2: string; readonly epochMs: number };
  readonly propagation: { readonly t_minutes: number; readonly timestamp: string };
  readonly state: {
    readonly teme:     { readonly position_km: Vector3; readonly velocity_km_s: Vector3 };
    readonly ecef:     { readonly position_km: Vector3 };
    readonly geodetic: GeodeticPosition;
  };
}

// ─── Starlink census ──────────────────────────────────────────────────────────

export interface StarlinkCensusEntry {
  noradId: number;
  name:    string;
  altKm:   number;
  epochMs: number;
}

export interface StarlinkCensusResult {
  total:          number;
  active:         number;
  climbing:       number;
  decaying:       number;
  criticalList:   StarlinkCensusEntry[];
  recentLaunches: StarlinkCensusEntry[];
}
