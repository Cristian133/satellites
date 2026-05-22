"use strict";

import { julianDate, gmst82, rot3 } from "./coords";
import { sunDirectionEcef } from "./sun";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const AU_KM = 1.495978707e8;
const EARTH_A = 6378.137;
const EARTH_E2 = 2 / 298.257223563 - (1 / 298.257223563) ** 2;

export interface CelestialPosition {
  name: string;
  az_deg: number;
  el_deg: number;
  icon: string;
}

interface KeplerElements {
  a: number;      // Semi-major axis in AU
  e: number;      // Eccentricity
  I: number;      // Inclination in degrees
  L: number;      // Mean longitude at J2000 in degrees
  L_rate: number; // Mean motion rate in degrees/day
  varpi: number;  // Longitude of perihelion in degrees
  Omega: number;  // Longitude of ascending node in degrees
}

// Heliocentric Keplerian elements for J2000
const PLANETS: Record<string, KeplerElements> = {
  Mercury: {
    a: 0.387098,
    e: 0.205630,
    I: 7.0049,
    L: 252.2508,
    L_rate: 4.092334436,
    varpi: 77.4564,
    Omega: 48.33167,
  },
  Venus: {
    a: 0.723332,
    e: 0.006773,
    I: 3.3947,
    L: 181.9797,
    L_rate: 1.602130224,
    varpi: 131.53298,
    Omega: 76.68069,
  },
  Earth: {
    a: 1.000000,
    e: 0.016708,
    I: 0.0,
    L: 100.4643,
    L_rate: 0.9856002585,
    varpi: 102.94719,
    Omega: 0.0,
  },
  Mars: {
    a: 1.523662,
    e: 0.093412,
    I: 1.8506,
    L: 355.4533,
    L_rate: 0.5240207766,
    varpi: 336.0408,
    Omega: 49.57854,
  },
  Jupiter: {
    a: 5.203363,
    e: 0.048393,
    I: 1.3053,
    L: 34.40438,
    L_rate: 0.0830853001,
    varpi: 14.75385,
    Omega: 100.55615,
  },
  Saturn: {
    a: 9.537070,
    e: 0.054150,
    I: 2.48446,
    L: 49.94432,
    L_rate: 0.0333717830,
    varpi: 92.43194,
    Omega: 113.71504,
  }
};

const PLANET_SPANISH_NAMES: Record<string, { name: string; icon: string }> = {
  Mercury: { name: "Mercurio", icon: "☿" },
  Venus: { name: "Venus", icon: "♀" },
  Mars: { name: "Marte", icon: "♂" },
  Jupiter: { name: "Júpiter", icon: "♃" },
  Saturn: { name: "Saturno", icon: "♄" },
};

function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 5; i++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  return E;
}

function getHeliocentricCartesian(el: KeplerElements, d: number): [number, number, number] {
  const L = (el.L + el.L_rate * d) % 360;
  const M_deg = (L - el.varpi + 360) % 360;
  const M = M_deg * RAD;
  const e = el.e;
  const E = solveKepler(M, e);

  const x_orb = el.a * (Math.cos(E) - e);
  const y_orb = el.a * Math.sqrt(1 - e * e) * Math.sin(E);

  const omega = (el.varpi - el.Omega) * RAD;
  const Omega = el.Omega * RAD;
  const I = el.I * RAD;

  const cos_om = Math.cos(omega);
  const sin_om = Math.sin(omega);
  const cos_Om = Math.cos(Omega);
  const sin_Om = Math.sin(Omega);
  const cos_I = Math.cos(I);
  const sin_I = Math.sin(I);

  const x_hel = x_orb * (cos_om * cos_Om - sin_om * sin_Om * cos_I) - y_orb * (sin_om * cos_Om + cos_om * sin_Om * cos_I);
  const y_hel = x_orb * (cos_om * sin_Om + sin_om * cos_Om * cos_I) - y_orb * (sin_om * sin_Om - cos_om * cos_Om * cos_I);
  const z_hel = x_orb * (sin_om * sin_I) + y_orb * (cos_om * sin_I);

  return [x_hel, y_hel, z_hel];
}

function getObliquity(d: number): number {
  return (23.4392911 - 3.562e-7 * d) * RAD;
}

function eclipticToEquatorial(v: [number, number, number], eps: number): [number, number, number] {
  const [xe, ye, ze] = v;
  return [
    xe,
    ye * Math.cos(eps) - ze * Math.sin(eps),
    ye * Math.sin(eps) + ze * Math.cos(eps)
  ];
}

function geodeticToEcef(lat_deg: number, lon_deg: number, alt_km: number): [number, number, number] {
  const lat = lat_deg * RAD;
  const lon = lon_deg * RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = EARTH_A / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat);
  return [
    (N + alt_km) * cosLat * Math.cos(lon),
    (N + alt_km) * cosLat * Math.sin(lon),
    (N * (1 - EARTH_E2) + alt_km) * sinLat,
  ];
}

function ecefRhoToAzel(
  rho: [number, number, number],
  lat_deg: number,
  lon_deg: number,
): { az_deg: number; el_deg: number } {
  const lat = lat_deg * RAD;
  const lon = lon_deg * RAD;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);

  const E = -sLon * rho[0] + cLon * rho[1];
  const N = -sLat * cLon * rho[0] - sLat * sLon * rho[1] + cLat * rho[2];
  const U = cLat * cLon * rho[0] + cLat * sLon * rho[1] + sLat * rho[2];

  const range = Math.sqrt(rho[0] ** 2 + rho[1] ** 2 + rho[2] ** 2);
  const el_deg = Math.asin(Math.max(-1, Math.min(1, U / range))) * DEG;
  let az_deg = Math.atan2(E, N) * DEG;
  if (az_deg < 0) az_deg += 360;

  return { az_deg, el_deg };
}

function getMoonEcef(jd: number): [number, number, number] {
  const d = jd - 2451545.0;

  const L = (218.316 + 13.176396 * d) % 360;
  const M = (134.963 + 13.064993 * d) % 360;
  const F = (93.272 + 13.229350 * d) % 360;

  const L_rad = L * RAD;
  const M_rad = M * RAD;
  const F_rad = F * RAD;

  const lambda = L + 6.289 * Math.sin(M_rad)
                   + 1.274 * Math.sin((2 * F_rad - M_rad) * RAD)
                   + 0.658 * Math.sin(2 * F_rad * RAD)
                   + 0.214 * Math.sin(2 * M_rad * RAD);
  const beta = 5.128 * Math.sin(F_rad * RAD)
                 + 0.280 * Math.sin((M_rad + F_rad * RAD))
                 - 0.280 * Math.sin((F_rad - M_rad) * RAD);
  const r = 385001 - 20905 * Math.cos(M_rad);

  const lambda_rad = lambda * RAD;
  const beta_rad = beta * RAD;

  const cos_beta = Math.cos(beta_rad);
  const x_ecl = r * cos_beta * Math.cos(lambda_rad);
  const y_ecl = r * cos_beta * Math.sin(lambda_rad);
  const z_ecl = r * Math.sin(beta_rad);

  const eps = getObliquity(d);
  const eci = eclipticToEquatorial([x_ecl, y_ecl, z_ecl], eps);

  return rot3(gmst82(jd), eci);
}

export function getCelestialPositions(
  date: Date,
  obsLat: number,
  obsLon: number,
  obsAlt: number
): CelestialPosition[] {
  const jd = julianDate(date);
  const d = jd - 2451545.0;
  const obsEcef = geodeticToEcef(obsLat, obsLon, obsAlt);
  const results: CelestialPosition[] = [];

  // 1. Sun
  const sunDir = sunDirectionEcef(date);
  // Scale Sun direction to astronomical distance to avoid paralax error
  const sunEcef: [number, number, number] = [
    sunDir[0] * AU_KM,
    sunDir[1] * AU_KM,
    sunDir[2] * AU_KM
  ];
  const sunRho: [number, number, number] = [
    sunEcef[0] - obsEcef[0],
    sunEcef[1] - obsEcef[1],
    sunEcef[2] - obsEcef[2]
  ];
  const sunAzel = ecefRhoToAzel(sunRho, obsLat, obsLon);
  results.push({
    name: "Sol",
    az_deg: parseFloat(sunAzel.az_deg.toFixed(1)),
    el_deg: parseFloat(sunAzel.el_deg.toFixed(1)),
    icon: "☀️"
  });

  // 2. Moon
  const moonEcef = getMoonEcef(jd);
  const moonRho: [number, number, number] = [
    moonEcef[0] - obsEcef[0],
    moonEcef[1] - obsEcef[1],
    moonEcef[2] - obsEcef[2]
  ];
  const moonAzel = ecefRhoToAzel(moonRho, obsLat, obsLon);
  results.push({
    name: "Luna",
    az_deg: parseFloat(moonAzel.az_deg.toFixed(1)),
    el_deg: parseFloat(moonAzel.el_deg.toFixed(1)),
    icon: "🌙"
  });

  // 3. Planets (Mercury, Venus, Mars, Jupiter, Saturn)
  const earthHeliocentric = getHeliocentricCartesian(PLANETS["Earth"]!, d);
  const eps = getObliquity(d);

  for (const [key, elements] of Object.entries(PLANETS)) {
    if (key === "Earth") continue;

    const helio = getHeliocentricCartesian(elements, d);
    // Geocentric Ecliptic in AU
    const geoEcl: [number, number, number] = [
      helio[0] - earthHeliocentric[0],
      helio[1] - earthHeliocentric[1],
      helio[2] - earthHeliocentric[2]
    ];

    // Scale to km
    const geoEclKm: [number, number, number] = [
      geoEcl[0] * AU_KM,
      geoEcl[1] * AU_KM,
      geoEcl[2] * AU_KM
    ];

    // Ecliptic to Equatorial (ECI)
    const eci = eclipticToEquatorial(geoEclKm, eps);
    // ECI to ECEF
    const ecef = rot3(gmst82(jd), eci);

    const rho: [number, number, number] = [
      ecef[0] - obsEcef[0],
      ecef[1] - obsEcef[1],
      ecef[2] - obsEcef[2]
    ];

    const azel = ecefRhoToAzel(rho, obsLat, obsLon);
    const info = PLANET_SPANISH_NAMES[key]!;

    results.push({
      name: info.name,
      az_deg: parseFloat(azel.az_deg.toFixed(1)),
      el_deg: parseFloat(azel.el_deg.toFixed(1)),
      icon: info.icon
    });
  }

  return results;
}
