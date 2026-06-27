"use strict";

import { workerData, parentPort } from "worker_threads";
import { bindings }               from "@wasmer/sgp4";
import { Elements, Constants }    from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import type { Sgp4, Result, Error as SgpError } from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import { temeToEcef }             from "../math/coords.js";
import { sunDirectionEcef, isInEarthShadow, sunElevationDeg } from "../math/sun.js";
import { stdMagnitude, apparentMagnitude }                    from "../math/magnitude.js";
import { getCelestialPositions }  from "../math/celestial.js";
import type { CelestialPosition } from "../math/celestial.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const RAD          = Math.PI / 180;
const DEG          = 180 / Math.PI;
const EARTH_A      = 6378.137;
const EARTH_E2     = 2 / 298.257223563 - (1 / 298.257223563) ** 2;
const STEP_S       = 30;
const TWILIGHT_DEG = -6;
const BINARY_ITERS = 12;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Observer {
  lat_deg: number;
  lon_deg: number;
  alt_km:  number;
}

export interface PassPoint {
  time:   string;
  az_deg: number;
  el_deg: number;
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

export interface FindPassesOptions {
  days?:             number;
  minElevation_deg?: number;
}

export interface TleData {
  name:     string;
  line1:    string;
  line2:    string;
  epoch_ms: number;
}

export interface FindPassesResult {
  satellite: { noradId: number; name: string; tleAge_h: number };
  observer:  Observer;
  passes:    SatellitePass[];
}

export interface PassesWorkerData {
  tleRow:   TleData;
  noradId:  number;
  observer: Observer;
  opts:     FindPassesOptions;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveResult<T>(r: Result<T, SgpError>): T {
  if (r.tag === "err") throw r.val;
  return r.val;
}

function r1(v: number): number {
  return parseFloat(v.toFixed(1));
}

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

interface Sample { ms: number; az_deg: number; el_deg: number; satEcef: [number, number, number] }

// ─── Core computation ─────────────────────────────────────────────────────────

export function findPasses(
  wasm:     Sgp4,
  tleRow:   TleData,
  noradId:  number,
  observer: Observer,
  opts:     FindPassesOptions = {},
): FindPassesResult {
  const days  = Math.min(opts.days             ?? 3, 10);
  const minEl = opts.minElevation_deg           ?? 10;

  const elements  = resolveResult(Elements.fromTle(wasm, null, tleRow.line1, tleRow.line2));
  const constants = resolveResult(Constants.fromElementsAfspcCompatibilityMode(wasm, elements));

  const epochMs  = tleRow.epoch_ms;
  const obsEcef  = geodeticToEcef(observer.lat_deg, observer.lon_deg, observer.alt_km);

  function sampleAt(ms: number): Sample | null {
    const t = (ms - epochMs) / 60000;
    let pred;
    try { pred = resolveResult(constants.propagateAfspcCompatibilityMode(t)); }
    catch { return null; }

    const [px, py, pz] = pred.position;
    const satEcef      = temeToEcef([px, py, pz], new Date(ms));
    const rho: [number, number, number] = [
      satEcef[0] - obsEcef[0],
      satEcef[1] - obsEcef[1],
      satEcef[2] - obsEcef[2],
    ];
    const { az_deg, el_deg } = ecefRhoToAzel(rho, observer.lat_deg, observer.lon_deg);
    return { ms, az_deg, el_deg, satEcef };
  }

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

  const startMs = Date.now();
  const endMs   = startMs + days * 86_400_000;
  const stepMs  = STEP_S * 1000;
  const passes: SatellitePass[] = [];

  let prev: Sample | null        = null;
  let beforeRise: Sample | null  = null;
  let peak: Sample | null        = null;
  let lastAbove: Sample | null   = null;
  let inPass                     = false;

  function commitPass(afterSet: Sample | null): void {
    if (!peak || !lastAbove) return;

    const riseMs = beforeRise ? bisect(beforeRise.ms, peak.ms, true) : startMs;
    const setMs  = afterSet   ? bisect(lastAbove.ms, afterSet.ms, false) : endMs;

    const riseSample = sampleAt(riseMs);
    const setSample  = sampleAt(setMs);
    if (!riseSample || !setSample) return;

    const sunDir   = sunDirectionEcef(new Date(peak.ms));
    const inShadow = isInEarthShadow(peak.satEcef, sunDir);
    const visible  = sunElevationDeg(obsEcef, sunDir) < TWILIGHT_DEG && !inShadow;
    const magnitude = inShadow ? null : apparentMagnitude(peak.satEcef, obsEcef, sunDir, stdMagnitude(noradId));

    const track: PassPoint[] = [];
    const durationMs = setMs - riseMs;
    const trackStep  = Math.max(10000, Math.min(30000, Math.round(durationMs / 25)));
    for (let tMs = riseMs; tMs <= setMs; tMs += trackStep) {
      const s = sampleAt(tMs);
      if (s) track.push({ time: new Date(tMs).toISOString(), az_deg: r1(s.az_deg), el_deg: r1(s.el_deg) });
    }
    const setTimeIso = new Date(setMs).toISOString();
    const lastPt     = track[track.length - 1];
    if (!lastPt || lastPt.time !== setTimeIso) {
      const s = sampleAt(setMs);
      if (s) track.push({ time: setTimeIso, az_deg: r1(s.az_deg), el_deg: r1(s.el_deg) });
    }

    const celestialBodies = getCelestialPositions(new Date(peak.ms), observer.lat_deg, observer.lon_deg, observer.alt_km);

    passes.push({
      rise:             { time: new Date(riseMs).toISOString(), az_deg: r1(riseSample.az_deg), el_deg: r1(riseSample.el_deg) },
      peak:             { time: new Date(peak.ms).toISOString(),  az_deg: r1(peak.az_deg),       el_deg: r1(peak.el_deg)       },
      set:              { time: new Date(setMs).toISOString(),    az_deg: r1(setSample.az_deg),   el_deg: r1(setSample.el_deg)  },
      visible,
      maxElevation_deg: r1(peak.el_deg),
      duration_s:       Math.round(durationMs / 1000),
      magnitude,
      track,
      celestialBodies,
    });
  }

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const curr = sampleAt(ms);
    if (!curr) { prev = null; continue; }
    const above = curr.el_deg >= minEl;

    if (!inPass && above) {
      inPass = true; beforeRise = prev; peak = curr; lastAbove = curr;
    } else if (inPass && above) {
      lastAbove = curr;
      if (curr.el_deg > peak!.el_deg) peak = curr;
    } else if (inPass && !above) {
      inPass = false; commitPass(curr); beforeRise = lastAbove = peak = null;
    }

    prev = curr;
  }

  if (inPass) commitPass(null);

  return {
    satellite: { noradId, name: tleRow.name, tleAge_h: parseFloat(((Date.now() - epochMs) / 3_600_000).toFixed(1)) },
    observer,
    passes,
  };
}

// ─── Worker entry point ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  const { tleRow, noradId, observer, opts } = workerData as PassesWorkerData;
  const wasm   = await bindings.sgp4();
  const result = findPasses(wasm, tleRow, noradId, observer, opts);
  parentPort!.postMessage({ ok: true, result });
}

run().catch((err: unknown) => {
  parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
});
