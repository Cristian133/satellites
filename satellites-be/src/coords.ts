"use strict";

// WGS84 ellipsoid constants
const WGS84_A  = 6378.137;
const WGS84_F  = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;

const TWO_PI = 2 * Math.PI;
const DEG    = 180 / Math.PI;

export interface GeodeticPosition {
  lat_deg: number;
  lon_deg: number;
  alt_km:  number;
}

export interface GeodeticResult extends GeodeticPosition {
  ecef_km: [number, number, number];
}

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function gmst82(jdUT1: number): number {
  const T = (jdUT1 - 2451545.0) / 36525.0;
  const thetaSec =
    67310.54841 +
    (876600.0 * 3600.0 + 8640184.812866) * T +
    0.093104 * T * T -
    6.2e-6 * T * T * T;

  let theta = ((thetaSec * Math.PI) / 43200) % TWO_PI;
  if (theta < 0) theta += TWO_PI;
  return theta;
}

export function rot3(
  theta: number,
  v: [number, number, number],
): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

export function temeToEcef(
  r_teme: [number, number, number],
  date: Date,
): [number, number, number] {
  return rot3(gmst82(julianDate(date)), r_teme);
}

export function ecefToGeodetic(
  x_km: number,
  y_km: number,
  z_km: number,
): GeodeticPosition {
  const p   = Math.sqrt(x_km * x_km + y_km * y_km);
  const lon = Math.atan2(y_km, x_km);

  let lat = Math.atan2(z_km, p * (1 - WGS84_E2));
  let N   = WGS84_A;
  for (let i = 0; i < 10; i++) {
    const sinLat = Math.sin(lat);
    N             = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const latNew  = Math.atan2(z_km + WGS84_E2 * N * sinLat, p);
    if (Math.abs(latNew - lat) < 1e-12) { lat = latNew; break; }
    lat = latNew;
  }

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const alt =
    Math.abs(cosLat) > 1e-8
      ? p / cosLat - N
      : Math.abs(z_km) / Math.abs(sinLat) - N * (1 - WGS84_E2);

  return { lat_deg: lat * DEG, lon_deg: lon * DEG, alt_km: alt };
}

export function temeToGeodetic(
  r_teme: [number, number, number],
  date: Date,
): GeodeticResult {
  const ecef     = temeToEcef(r_teme, date);
  const geodetic = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return { ...geodetic, ecef_km: ecef };
}
