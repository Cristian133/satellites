import { describe, it, expect } from "vitest";
import { sunDirectionEcef, isInEarthShadow, sunElevationDeg } from "../sun.js";

const EARTH_RADIUS_KM = 6371.0;

describe("sunDirectionEcef", () => {
  it("returns a unit vector (magnitude ≈ 1)", () => {
    const dir = sunDirectionEcef(new Date("2000-01-01T12:00:00Z"));
    const mag = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    expect(mag).toBeCloseTo(1.0, 6);
  });

  it("returns a unit vector at a different epoch", () => {
    const dir = sunDirectionEcef(new Date("2023-06-21T12:00:00Z")); // solsticio de verano
    const mag = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    expect(mag).toBeCloseTo(1.0, 6);
  });

  it("sun direction changes significantly between epochs 6 hours apart", () => {
    // In 6h the Earth rotates ~90° so the ECEF sun direction shifts substantially
    const dir1 = sunDirectionEcef(new Date("2023-01-01T00:00:00Z"));
    const dir2 = sunDirectionEcef(new Date("2023-01-01T06:00:00Z"));
    const dot = dir1[0] * dir2[0] + dir1[1] * dir2[1] + dir1[2] * dir2[2];
    // cos(90°) ≈ 0; we just need to confirm the directions are not the same
    expect(Math.abs(dot)).toBeLessThan(0.2);
  });
});

describe("isInEarthShadow", () => {
  const sunDir: [number, number, number] = [1, 0, 0];

  it("satellite on sun side (positive x) is NOT in shadow", () => {
    const sat: [number, number, number] = [7000, 0, 0];
    expect(isInEarthShadow(sat, sunDir)).toBe(false);
  });

  it("satellite directly behind Earth (negative x, within cylinder) IS in shadow", () => {
    const sat: [number, number, number] = [-7000, 0, 0];
    // perpSq = 0 < EARTH_RADIUS^2 → in shadow
    expect(isInEarthShadow(sat, sunDir)).toBe(true);
  });

  it("satellite beside Earth (90° to sun, outside Earth radius) is NOT in shadow", () => {
    const sat: [number, number, number] = [0, 8000, 0]; // 8000 km > 6371 km
    expect(isInEarthShadow(sat, sunDir)).toBe(false);
  });

  it("satellite beside Earth inside Earth radius (unrealistic, but tests geometry) IS in shadow", () => {
    const sat: [number, number, number] = [0, 5000, 0]; // 5000 km < 6371 km
    expect(isInEarthShadow(sat, sunDir)).toBe(true);
  });
});

describe("sunElevationDeg", () => {
  it("returns ~90° when sun is directly overhead (aligned with zenith)", () => {
    // Observer on equator, x-axis; sun in same direction
    const obsEcef: [number, number, number] = [EARTH_RADIUS_KM, 0, 0];
    const sunDir: [number, number, number] = [1, 0, 0];
    const el = sunElevationDeg(obsEcef, sunDir);
    expect(el).toBeCloseTo(90, 1);
  });

  it("returns ~0° when sun is on the horizon (perpendicular to zenith)", () => {
    const obsEcef: [number, number, number] = [EARTH_RADIUS_KM, 0, 0];
    const sunDir: [number, number, number] = [0, 1, 0]; // perpendicular
    const el = sunElevationDeg(obsEcef, sunDir);
    expect(el).toBeCloseTo(0, 1);
  });

  it("returns negative value when sun is below horizon", () => {
    const obsEcef: [number, number, number] = [EARTH_RADIUS_KM, 0, 0];
    const sunDir: [number, number, number] = [-1, 0, 0]; // opposite of zenith
    const el = sunElevationDeg(obsEcef, sunDir);
    expect(el).toBeCloseTo(-90, 1);
  });

  it("returns within [-90, 90] range for arbitrary inputs", () => {
    const obsEcef: [number, number, number] = [3000, 4000, 5000];
    const sunDir: [number, number, number] = [0.6, 0.8, 0];
    const el = sunElevationDeg(obsEcef, sunDir);
    expect(el).toBeGreaterThanOrEqual(-90);
    expect(el).toBeLessThanOrEqual(90);
  });
});
