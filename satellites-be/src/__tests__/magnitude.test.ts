import { describe, it, expect } from "vitest";
import { stdMagnitude, apparentMagnitude } from "../magnitude.js";

describe("stdMagnitude", () => {
  it("returns known mag for ISS (NORAD 25544)", () => {
    expect(stdMagnitude(25544)).toBe(-1.8);
  });

  it("returns known mag for Hubble (NORAD 20580)", () => {
    expect(stdMagnitude(20580)).toBe(1.5);
  });

  it("returns default 3.5 for unknown NORAD ID", () => {
    expect(stdMagnitude(99999)).toBe(3.5);
    expect(stdMagnitude(1)).toBe(3.5);
  });
});

describe("apparentMagnitude", () => {
  // Setup: observer at equator on x-axis, satellite 1000 km directly overhead.
  // Sun perpendicular to the obs→sat axis → phase angle = π/2 → phaseTerm = 0.
  // Range = 1000 km → rangeTerm = 5·log10(1000/1000) = 0.
  // Result should equal stdMag.
  const obsEcef: [number, number, number] = [6378.137, 0, 0];
  const satEcef: [number, number, number] = [6378.137 + 1000, 0, 0];
  const sunDir90: [number, number, number] = [0, 1, 0]; // perpendicular → φ = π/2

  it("equals stdMag at 1000 km range and 90° phase angle", () => {
    const mag = apparentMagnitude(satEcef, obsEcef, sunDir90, 0.0);
    expect(mag).toBeCloseTo(0.0, 1);
  });

  it("increases (dimmer) at longer range", () => {
    const farSat: [number, number, number] = [6378.137 + 2000, 0, 0];
    const mag1000 = apparentMagnitude(satEcef, obsEcef, sunDir90, 0.0);
    const mag2000 = apparentMagnitude(farSat, obsEcef, sunDir90, 0.0);
    expect(mag2000).toBeGreaterThan(mag1000); // dimmer = higher magnitude number
  });

  it("is brighter (lower mag) when sun is behind observer (favourable phase)", () => {
    // obsEcef is in -x from sat, so sunDir=-x aligns with the observer direction → φ ≈ 0
    // phaseFn(0) = sin(0) + π·cos(0) = π > 1 → phaseTerm = -2.5·log10(π) < 0 → brighter
    const sunDirFavourable: [number, number, number] = [-1, 0, 0];
    const magFavourable = apparentMagnitude(satEcef, obsEcef, sunDirFavourable, 0.0);
    const magNeutral    = apparentMagnitude(satEcef, obsEcef, sunDir90, 0.0);
    expect(magFavourable).toBeLessThan(magNeutral);
  });

  it("range term: +1.5 mag per doubling of range (5·log10(2) ≈ 1.505)", () => {
    const sat2x: [number, number, number] = [6378.137 + 2000, 0, 0];
    const mag1 = apparentMagnitude(satEcef, obsEcef, sunDir90, 0.0);
    const mag2 = apparentMagnitude(sat2x,   obsEcef, sunDir90, 0.0);
    expect(mag2 - mag1).toBeCloseTo(5 * Math.log10(2), 1);
  });
});
