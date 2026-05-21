"use strict";

import type Database                              from "better-sqlite3";
import { Elements, Constants }                    from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import type { Sgp4, Result, Error as SgpError }   from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import { getTleByNoradId }                        from "./db.js";
import { temeToEcef }                             from "./coords.js";
import { sunDirectionEcef, isInEarthShadow, sunElevationDeg } from "./sun.js";
import { stdMagnitude, apparentMagnitude }        from "./magnitude.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const RAD          = Math.PI / 180;
const DEG          = 180 / Math.PI;
const EARTH_A      = 6378.137;
const EARTH_E2     = 2 / 298.257223563 - (1 / 298.257223563) ** 2;
const STEP_S       = 30;        // coarse scan step in seconds
const TWILIGHT_DEG = -6;        // civil twilight threshold for observer darkness
const BINARY_ITERS = 12;        // binary-search iterations (~0.1 s precision at 30 s step)

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Observer {
  lat_deg: number;
  lon_deg: number;
  alt_km:  number;
}

export interface PassPoint {
  time:   string;   // ISO-8601 UTC
  az_deg: number;
  el_deg: number;
}

export interface SatellitePass {
  rise:             PassPoint;
  peak:             PassPoint;
  set:              PassPoint;
  visible:          boolean;    // dark observer + illuminated satellite at peak
  maxElevation_deg: number;
  duration_s:       number;
  magnitude:        number | null;  // apparent visual mag at peak; null if in Earth shadow
}

export interface FindPassesOptions {
  days?:             number;   // default 3, max 10
  minElevation_deg?: number;   // default 10
}

export interface FindPassesResult {
  satellite: { noradId: number; name: string; tleAge_h: number };
  observer:  Observer;
  passes:    SatellitePass[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveResult<T>(r: Result<T, SgpError>): T {
  if (r.tag === "err") throw r.val;
  return r.val;
}

function r1(v: number): number {
  return parseFloat(v.toFixed(1));
}

/** Geodetic (deg, deg, km) → ECEF (km). */
function geodeticToEcef(lat_deg: number, lon_deg: number, alt_km: number): [number, number, number] {
  const lat    = lat_deg * RAD;
  const lon    = lon_deg * RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N      = EARTH_A / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat);
  return [
    (N + alt_km) * cosLat * Math.cos(lon),
    (N + alt_km) * cosLat * Math.sin(lon),
    (N * (1 - EARTH_E2) + alt_km) * sinLat,
  ];
}

/**
 * ECEF range vector → azimuth/elevation as seen from observer at (lat, lon).
 * Az: 0° = North, 90° = East. El: 0° = horizon, 90° = zenith.
 */
function ecefRhoToAzel(
  rho:     [number, number, number],
  lat_deg: number,
  lon_deg: number,
): { az_deg: number; el_deg: number } {
  const lat  = lat_deg * RAD;
  const lon  = lon_deg * RAD;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);

  const E = -sLon * rho[0] + cLon * rho[1];
  const N = -sLat * cLon * rho[0] - sLat * sLon * rho[1] + cLat * rho[2];
  const U =  cLat * cLon * rho[0] + cLat * sLon * rho[1] + sLat * rho[2];

  const range  = Math.sqrt(rho[0] ** 2 + rho[1] ** 2 + rho[2] ** 2);
  const el_deg = Math.asin(Math.max(-1, Math.min(1, U / range))) * DEG;
  let   az_deg = Math.atan2(E, N) * DEG;
  if (az_deg < 0) az_deg += 360;

  return { az_deg, el_deg };
}

// ─── Sample type ──────────────────────────────────────────────────────────────

interface Sample {
  ms:      number;
  az_deg:  number;
  el_deg:  number;
  satEcef: [number, number, number];
}

// ─── Pass finder ─────────────────────────────────────────────────────────────

export function findPasses(
  db:       Database.Database,
  wasm:     Sgp4,
  noradId:  number,
  observer: Observer,
  opts:     FindPassesOptions = {},
): FindPassesResult {
  const days  = Math.min(opts.days             ?? 3,  10);
  const minEl = opts.minElevation_deg           ?? 10;

  const row = getTleByNoradId(db, noradId);
  if (!row) throw new Error(`No TLE found for NORAD ID ${noradId}`);

  const elements  = resolveResult(Elements.fromTle(wasm, null, row.line1, row.line2));
  const constants = resolveResult(Constants.fromElementsAfspcCompatibilityMode(wasm, elements));

  const epochMs = row.epoch_ms;
  const obsEcef = geodeticToEcef(observer.lat_deg, observer.lon_deg, observer.alt_km);

  // ── Sample function: propagate to a Unix timestamp (ms) ──────────────────

  function sampleAt(ms: number): Sample | null {
    const t = (ms - epochMs) / 60000;
    let pred;
    try {
      pred = resolveResult(constants.propagateAfspcCompatibilityMode(t));
    } catch {
      return null;
    }
    const [px, py, pz] = pred.position;
    const satEcef = temeToEcef([px, py, pz], new Date(ms));
    const rho: [number, number, number] = [
      satEcef[0] - obsEcef[0],
      satEcef[1] - obsEcef[1],
      satEcef[2] - obsEcef[2],
    ];
    const { az_deg, el_deg } = ecefRhoToAzel(rho, observer.lat_deg, observer.lon_deg);
    return { ms, az_deg, el_deg, satEcef };
  }

  // ── Binary search: find the ms at which elevation crosses minEl ───────────

  function bisect(loMs: number, hiMs: number, risingEdge: boolean): number {
    for (let i = 0; i < BINARY_ITERS; i++) {
      const mid   = Math.round((loMs + hiMs) / 2);
      const s     = sampleAt(mid);
      const above = s !== null && s.el_deg >= minEl;
      if (risingEdge ? above : !above) hiMs = mid;
      else                              loMs = mid;
    }
    return Math.round((loMs + hiMs) / 2);
  }

  // ── Coarse scan ───────────────────────────────────────────────────────────

  const startMs  = Date.now();
  const endMs    = startMs + days * 86_400_000;
  const stepMs   = STEP_S * 1000;
  const passes:  SatellitePass[] = [];

  // State machine variables
  let prev:        Sample | null = null;   // sample from previous step
  let beforeRise:  Sample | null = null;   // last sample below minEl before pass
  let peak:        Sample | null = null;   // highest-elevation sample in current pass
  let lastAbove:   Sample | null = null;   // most recent sample above minEl

  function commitPass(afterSet: Sample | null): void {
    if (!peak || !lastAbove) return;

    const riseMs = beforeRise
      ? bisect(beforeRise.ms, peak.ms, true)   // refine rising edge
      : startMs;

    const setMs = afterSet
      ? bisect(lastAbove.ms, afterSet.ms, false) // refine falling edge
      : endMs;

    const riseSample = sampleAt(riseMs);
    const setSample  = sampleAt(setMs);
    if (!riseSample || !setSample) return;

    const sunDir    = sunDirectionEcef(new Date(peak.ms));
    const inShadow  = isInEarthShadow(peak.satEcef, sunDir);
    const visible   =
      sunElevationDeg(obsEcef, sunDir) < TWILIGHT_DEG && !inShadow;

    const magnitude = inShadow
      ? null
      : apparentMagnitude(peak.satEcef, obsEcef, sunDir, stdMagnitude(noradId));

    passes.push({
      rise:             { time: new Date(riseMs).toISOString(), az_deg: r1(riseSample.az_deg), el_deg: r1(riseSample.el_deg) },
      peak:             { time: new Date(peak.ms).toISOString(), az_deg: r1(peak.az_deg),      el_deg: r1(peak.el_deg)      },
      set:              { time: new Date(setMs).toISOString(),   az_deg: r1(setSample.az_deg),  el_deg: r1(setSample.el_deg) },
      visible,
      maxElevation_deg: r1(peak.el_deg),
      duration_s:       Math.round((setMs - riseMs) / 1000),
      magnitude,
    });
  }

  let inPass = false;

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const curr = sampleAt(ms);
    if (!curr) { prev = null; continue; }

    const above = curr.el_deg >= minEl;

    if (!inPass && above) {
      // Entered a pass
      inPass      = true;
      beforeRise  = prev;
      peak        = curr;
      lastAbove   = curr;
    } else if (inPass && above) {
      // Still in pass — track peak
      lastAbove = curr;
      if (curr.el_deg > peak!.el_deg) peak = curr;
    } else if (inPass && !above) {
      // Left the pass
      inPass = false;
      commitPass(curr);
      beforeRise = lastAbove = peak = null;
    }

    prev = curr;
  }

  // Pass still open at end of window
  if (inPass) commitPass(null);

  return {
    satellite: {
      noradId,
      name:      row.name,
      tleAge_h:  parseFloat(((Date.now() - epochMs) / 3_600_000).toFixed(1)),
    },
    observer,
    passes,
  };
}
