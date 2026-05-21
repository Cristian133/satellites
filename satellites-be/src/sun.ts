"use strict";

import { julianDate, gmst82, rot3 } from "./coords.js";

const RAD              = Math.PI / 180;
const DEG              = 180 / Math.PI;
const EARTH_RADIUS_KM  = 6371.0;

/**
 * Unit vector from Earth center toward the Sun, in ECEF.
 * Uses the low-precision solar position algorithm from Meeus Ch. 25 (~1° accuracy).
 */
export function sunDirectionEcef(date: Date): [number, number, number] {
  const jd = julianDate(date);
  const T  = (jd - 2451545.0) / 36525.0;

  // Sun's mean longitude and mean anomaly (degrees)
  const L0   = 280.46646 + 36000.76983 * T;
  const M    = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const Mrad = M * RAD;

  // Equation of center
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T)                     * Math.sin(2 * Mrad) +
    0.000289                                       * Math.sin(3 * Mrad);

  // True longitude → ecliptic → geocentric equatorial (ECI, ~J2000)
  const sunLon = (L0 + C) * RAD;
  const eps    = (23.439291111 - 0.013004167 * T) * RAD;

  const xEci: [number, number, number] = [
    Math.cos(sunLon),
    Math.cos(eps) * Math.sin(sunLon),
    Math.sin(eps) * Math.sin(sunLon),
  ];

  // ECI → ECEF: same GMST rotation used for TEME → ECEF
  const ecef = rot3(gmst82(jd), xEci);
  const mag  = Math.sqrt(ecef[0] ** 2 + ecef[1] ** 2 + ecef[2] ** 2);
  return [ecef[0] / mag, ecef[1] / mag, ecef[2] / mag];
}

/**
 * Cylindrical Earth-shadow test.
 * Returns true if the satellite (ECEF, km) is in Earth's shadow.
 */
export function isInEarthShadow(
  satEcef: [number, number, number],
  sunDir:  [number, number, number],
): boolean {
  const dot = satEcef[0] * sunDir[0] + satEcef[1] * sunDir[1] + satEcef[2] * sunDir[2];
  if (dot > 0) return false;                          // on the Sun side

  const satR2  = satEcef[0] ** 2 + satEcef[1] ** 2 + satEcef[2] ** 2;
  const perpSq = satR2 - dot * dot;
  return perpSq < EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

/**
 * Elevation of the Sun (degrees) as seen from an observer (ECEF, km).
 * Uses geocentric approximation: the observer's zenith is r_obs / |r_obs|.
 */
export function sunElevationDeg(
  obsEcef: [number, number, number],
  sunDir:  [number, number, number],
): number {
  const mag   = Math.sqrt(obsEcef[0] ** 2 + obsEcef[1] ** 2 + obsEcef[2] ** 2);
  const sinEl = (obsEcef[0] * sunDir[0] + obsEcef[1] * sunDir[1] + obsEcef[2] * sunDir[2]) / mag;
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
}
