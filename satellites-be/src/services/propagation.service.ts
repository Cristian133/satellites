"use strict";

import { bindings }         from "@wasmer/sgp4";
import { Elements, Constants } from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import type { Result, Error as SgpError, Sgp4 } from "@wasmer/sgp4/src/bindings/sgp4/sgp4";
import { temeToGeodetic }   from "../math/coords.js";
import type { TleRow }      from "../types/index.js";

// ─── WASM lazy singleton ─────────────────────────────────────────────────────

let _wasm: Sgp4 | null = null;

async function getWasm(): Promise<Sgp4> {
  if (!_wasm) _wasm = await bindings.sgp4();
  return _wasm;
}

// ─── SGP4 constants cache keyed by NORAD ID ──────────────────────────────────

interface CacheEntry { epochMs: number; constants: Constants }
const sgp4Cache = new Map<number, CacheEntry>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveResult<T>(result: Result<T, SgpError>): T {
  if (result.tag === "err") throw result.val;
  return result.val;
}

function minutesSinceTleEpoch(line1: string): number {
  const epochStr = line1.substring(18, 32).trim();
  const year2d   = parseInt(epochStr.substring(0, 2), 10);
  const year     = year2d >= 57 ? 1900 + year2d : 2000 + year2d;
  const dayOfYear = parseFloat(epochStr.substring(2));
  const epochMs   = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
  return (Date.now() - epochMs) / 60000;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SatelliteState {
  satellite:   { noradId: number; name: string };
  tle:         { line1: string; line2: string; epochMs: number };
  propagation: { t_minutes: number; timestamp: string };
  state: {
    teme:     { position_km: { x: number; y: number; z: number }; velocity_km_s: { x: number; y: number; z: number } };
    ecef:     { position_km: { x: number; y: number; z: number } };
    geodetic: { lat_deg: number; lon_deg: number; alt_km: number };
  };
}

export async function propagateSatellite(noradId: number, row: TleRow): Promise<SatelliteState> {
  const wasm = await getWasm();
  const { name, line1, line2, epoch_ms } = row;

  let constants: Constants;
  const cached = sgp4Cache.get(noradId);

  if (cached && cached.epochMs === epoch_ms) {
    constants = cached.constants;
  } else {
    const elements = resolveResult(Elements.fromTle(wasm, null, line1, line2));
    constants       = resolveResult(Constants.fromElementsAfspcCompatibilityMode(wasm, elements));
    sgp4Cache.set(noradId, { epochMs: epoch_ms, constants });
  }

  const t          = minutesSinceTleEpoch(line1);
  const prediction = resolveResult(constants.propagateAfspcCompatibilityMode(t));
  const [px, py, pz] = prediction.position;
  const [vx, vy, vz] = prediction.velocity;
  const now          = new Date();
  const { lat_deg, lon_deg, alt_km, ecef_km } = temeToGeodetic([px, py, pz], now);

  return {
    satellite:   { noradId, name },
    tle:         { line1, line2, epochMs: epoch_ms },
    propagation: { t_minutes: parseFloat(t.toFixed(6)), timestamp: now.toISOString() },
    state: {
      teme:     { position_km: { x: px, y: py, z: pz }, velocity_km_s: { x: vx, y: vy, z: vz } },
      ecef:     { position_km: { x: ecef_km[0], y: ecef_km[1], z: ecef_km[2] } },
      geodetic: { lat_deg, lon_deg, alt_km },
    },
  };
}
