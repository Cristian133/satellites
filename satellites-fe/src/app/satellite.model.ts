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

// ─── Pass prediction ──────────────────────────────────────────────────────────

export interface PassPoint {
  time:   string;
  az_deg: number;
  el_deg: number;
}

export interface CelestialPosition {
  name: string;
  az_deg: number;
  el_deg: number;
  icon: string;
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

export interface SatelliteSummary {
  noradId:     number;
  name:        string;
  groupName:   string;
  inclination: number;
  periodMin:   number;
}

export interface PassSelection {
  pass:        SatellitePass;
  observerLat: number;
  observerLon: number;
}
