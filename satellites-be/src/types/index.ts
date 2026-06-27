"use strict";

export interface TleRow {
  name:     string;
  line1:    string;
  line2:    string;
  epoch_ms: number;
}

export interface SatelliteSummary {
  noradId:     number;
  name:        string;
  groupName:   string;
  inclination: number;
  periodMin:   number;
  country?:    string;
}

export interface StatsResult {
  totalSatellites: number;
  lastSync:        unknown;
}

export interface StarlinkCensusResult {
  total:          number;
  active:         number;
  climbing:       number;
  decaying:       number;
  criticalList:   { noradId: number; name: string; altKm: number; epochMs: number }[];
  recentLaunches: { noradId: number; name: string; altKm: number; epochMs: number }[];
}
