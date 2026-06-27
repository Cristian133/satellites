"use strict";

// Standard magnitudes at 1000 km range, 90° phase angle.
// Values from community observations / Heavens-Above catalog.
const STD_MAG: Record<number, number> = {
  25544: -1.8,  // ISS
  20580:  1.5,  // Hubble Space Telescope
  48274: -0.5,  // Tiangong CSS (Tianhe)
  54216: -0.5,  // Tiangong CSS (Mengtian)
  25338:  2.0,  // NOAA-15
  28654:  2.0,  // NOAA-18
  33591:  2.0,  // NOAA-19
};

const DEFAULT_STD_MAG = 3.5; // Generic LEO satellite

export function stdMagnitude(noradId: number): number {
  return STD_MAG[noradId] ?? DEFAULT_STD_MAG;
}

/**
 * Apparent visual magnitude of a satellite seen from the observer.
 *
 * Formula: m = m_std + 5·log10(range_km / 1000) + phase_term
 *
 * Phase model: Lambertian diffuse sphere, normalized at 90° so that
 * the correction is 0 when the phase angle equals 90° (matching the
 * m_std definition).  Φ(φ) = sin φ + (π − φ)·cos φ, Φ(π/2) = 1.
 */
export function apparentMagnitude(
  satEcef: [number, number, number],
  obsEcef: [number, number, number],
  sunDir:  [number, number, number],  // unit vector Earth→Sun
  stdMag:  number,
): number {
  const dx = obsEcef[0] - satEcef[0];
  const dy = obsEcef[1] - satEcef[1];
  const dz = obsEcef[2] - satEcef[2];
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const rangeTerm = 5 * Math.log10(range / 1000);

  // Phase angle: at the satellite, between Sun direction and observer direction
  const toObsX = dx / range;
  const toObsY = dy / range;
  const toObsZ = dz / range;
  const cosPhase = sunDir[0] * toObsX + sunDir[1] * toObsY + sunDir[2] * toObsZ;
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhase)));

  const phaseFn = Math.sin(phi) + (Math.PI - phi) * Math.cos(phi); // Φ(π/2) = 1
  const phaseTerm = phaseFn > 0 ? -2.5 * Math.log10(phaseFn) : 30;

  return parseFloat((stdMag + rangeTerm + phaseTerm).toFixed(1));
}
