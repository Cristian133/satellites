import { describe, it, expect } from "vitest";
import { julianDate, gmst82, rot3, ecefToGeodetic, temeToEcef } from "../math/coords.js";

const TWO_PI = 2 * Math.PI;

describe("julianDate", () => {
  it("returns 2451545.0 for J2000 epoch (2000-01-01T12:00:00Z)", () => {
    const jd = julianDate(new Date("2000-01-01T12:00:00.000Z"));
    expect(jd).toBeCloseTo(2451545.0, 6);
  });

  it("returns 2440587.5 for Unix epoch (1970-01-01T00:00:00Z)", () => {
    const jd = julianDate(new Date("1970-01-01T00:00:00.000Z"));
    expect(jd).toBeCloseTo(2440587.5, 6);
  });
});

describe("gmst82", () => {
  it("returns a value in [0, 2π) for J2000 epoch", () => {
    const theta = gmst82(2451545.0);
    expect(theta).toBeGreaterThanOrEqual(0);
    expect(theta).toBeLessThan(TWO_PI);
  });

  it("returns approximately 4.8950 rad at J2000 (GMST ≈ 18h 41m 50s)", () => {
    // IAU standard: GMST at J2000.0 ≈ 280.46061837° ≈ 4.8949 rad
    const theta = gmst82(2451545.0);
    expect(theta).toBeCloseTo(4.8949, 2);
  });

  it("increases monotonically by ~2π per sidereal day (~86164 s)", () => {
    const jd0 = 2451545.0;
    const siderealDayJD = 0.99726958;
    const theta0 = gmst82(jd0);
    const theta1 = gmst82(jd0 + siderealDayJD);
    const diff = ((theta1 - theta0 + TWO_PI) % TWO_PI);
    expect(diff).toBeCloseTo(0, 2); // one full rotation
  });
});

describe("rot3", () => {
  it("is identity when theta = 0", () => {
    const v: [number, number, number] = [1, 2, 3];
    const [x, y, z] = rot3(0, v);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(2, 10);
    expect(z).toBeCloseTo(3, 10);
  });

  it("preserves vector magnitude", () => {
    const v: [number, number, number] = [3, 4, 0];
    const r = rot3(Math.PI / 4, v);
    const mag = Math.sqrt(r[0] ** 2 + r[1] ** 2 + r[2] ** 2);
    expect(mag).toBeCloseTo(5, 10);
  });

  it("rotates [1,0,0] by π/2 to [0,-1,0]", () => {
    const [x, y, z] = rot3(Math.PI / 2, [1, 0, 0]);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(-1, 10);
    expect(z).toBeCloseTo(0, 10);
  });
});

describe("ecefToGeodetic", () => {
  it("point on equator at prime meridian → lat=0, lon=0, alt≈0", () => {
    const WGS84_A = 6378.137;
    const { lat_deg, lon_deg, alt_km } = ecefToGeodetic(WGS84_A, 0, 0);
    expect(lat_deg).toBeCloseTo(0, 6);
    expect(lon_deg).toBeCloseTo(0, 6);
    expect(alt_km).toBeCloseTo(0, 3);
  });

  it("North Pole → lat≈90°, alt≈0", () => {
    // WGS84 semi-minor axis b = a*(1 - 1/f) ≈ 6356.752 km
    const WGS84_B = 6356.752314245;
    const { lat_deg, alt_km } = ecefToGeodetic(0, 0, WGS84_B);
    expect(lat_deg).toBeCloseTo(90, 4);
    expect(alt_km).toBeCloseTo(0, 1);
  });

  it("satellite at 400 km altitude on equator → alt≈400 km", () => {
    const WGS84_A = 6378.137;
    const { lat_deg, lon_deg, alt_km } = ecefToGeodetic(WGS84_A + 400, 0, 0);
    expect(lat_deg).toBeCloseTo(0, 5);
    expect(lon_deg).toBeCloseTo(0, 5);
    expect(alt_km).toBeCloseTo(400, 3);
  });

  it("point at 45°N, 90°E, sea level", () => {
    const lat = 45 * (Math.PI / 180);
    const lon = 90 * (Math.PI / 180);
    const WGS84_A = 6378.137;
    const WGS84_E2 = 2 / 298.257223563 - (1 / 298.257223563) ** 2;
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    const x = N * Math.cos(lat) * Math.cos(lon);
    const y = N * Math.cos(lat) * Math.sin(lon);
    const z = N * (1 - WGS84_E2) * Math.sin(lat);
    const { lat_deg, lon_deg, alt_km } = ecefToGeodetic(x, y, z);
    expect(lat_deg).toBeCloseTo(45, 4);
    expect(lon_deg).toBeCloseTo(90, 4);
    expect(alt_km).toBeCloseTo(0, 2);
  });
});

describe("temeToEcef", () => {
  it("preserves vector magnitude (pure rotation)", () => {
    const r_teme: [number, number, number] = [7000, 0, 0];
    const date = new Date("2000-01-01T12:00:00Z");
    const ecef = temeToEcef(r_teme, date);
    const mag = Math.sqrt(ecef[0] ** 2 + ecef[1] ** 2 + ecef[2] ** 2);
    expect(mag).toBeCloseTo(7000, 3);
  });

  it("rotates the z-component unchanged (rot3 does not affect z)", () => {
    const r_teme: [number, number, number] = [0, 0, 6371];
    const date = new Date("2023-06-15T00:00:00Z");
    const ecef = temeToEcef(r_teme, date);
    expect(ecef[2]).toBeCloseTo(6371, 3);
  });
});
