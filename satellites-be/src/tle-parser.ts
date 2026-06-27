"use strict";

// ─── Public types ────────────────────────────────────────────────────────────

export interface TleRecord {
  noradId:          number;
  name:             string;
  line1:            string;
  line2:            string;
  epochMs:          number;
  classification:   string;
  intlDesignator:   string;
  bstar:            number;
  meanMotionDot:    number;
  inclination:      number;
  raan:             number;
  eccentricity:     number;
  argPerigee:       number;
  meanAnomaly:      number;
  meanMotion:       number;
  revolutionNumber: number;
}

export interface ParseError {
  name:   string;
  errors: string[];
}

export interface ParseCatalogResult {
  tles:        TleRecord[];
  parseErrors: ParseError[];
  noNewData?:  true;
}

// ─── Internal line-parse types ────────────────────────────────────────────────

interface ParsedLine1 {
  errors:           string[];
  noradId:          number;
  classification:   string;
  intlDesignator:   string;
  epochYear:        number;
  epochDay:         number;
  epochMs:          number;
  meanMotionDot:    number;
  meanMotionDotDot: number;
  bstar:            number;
  ephemerisType:    number;
  elementSetNumber: number;
}

interface ParsedLine2 {
  errors:           string[];
  noradId:          number;
  inclination:      number;
  raan:             number;
  eccentricity:     number;
  argPerigee:       number;
  meanAnomaly:      number;
  meanMotion:       number;
  revolutionNumber: number;
}

type TleBlockResult =
  | { ok: true;  tle: TleRecord }
  | { ok: false; name: string; errors: string[] };

// ─── Checksum & compact-exp helpers ──────────────────────────────────────────

export function lineChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i];
    if (c >= "0" && c <= "9") sum += c.charCodeAt(0) - 48;
    else if (c === "-") sum += 1;
  }
  return sum % 10;
}

function parseCompactExp(field: string): number {
  const s = field.trim();
  if (!s) return 0;
  const m = s.match(/^([+-]?)(\d{5})([+-]\d)$/);
  if (!m) return NaN;
  const sign     = m[1] === "-" ? -1 : 1;
  const mantissa = parseInt(m[2], 10) * 1e-5;
  const exp      = parseInt(m[3], 10);
  return sign * mantissa * Math.pow(10, exp);
}

// ─── Field-level validators ───────────────────────────────────────────────────

function assertLength(errors: string[], where: string, line: string, expected: number): void {
  if (line.length !== expected)
    errors.push(`${where}: length ${line.length} ≠ ${expected}`);
}

function assertChar(errors: string[], where: string, line: string, idx: number, validChars: string): void {
  const c = line[idx];
  if (!validChars.includes(c))
    errors.push(`${where}[${idx + 1}]: expected one of "${validChars}", got "${c}"`);
}

function assertNumeric(errors: string[], where: string, raw: string): void {
  if (!/^[0-9 .-]+$/.test(raw))
    errors.push(`${where}: non-numeric chars in "${raw.trim()}"`);
}

function assertFloat(errors: string[], where: string, raw: string, min: number, max: number): number {
  const v = parseFloat(raw.trim());
  if (isNaN(v)) {
    errors.push(`${where}: cannot parse "${raw.trim()}" as float`);
    return NaN;
  }
  if (v < min || v > max)
    errors.push(`${where}: ${v} out of range [${min}, ${max}]`);
  return v;
}

// ─── Line parsers ─────────────────────────────────────────────────────────────

export function parseLine1(raw: string): ParsedLine1 {
  const line   = raw.trimEnd().padEnd(69);
  const errors: string[] = [];

  assertLength(errors, "L1", raw.trimEnd(), 69);
  assertChar(errors, "L1", line, 0, "1");

  const noradRaw = line.substring(2, 7);
  assertNumeric(errors, "L1 NORAD", noradRaw);
  const noradId  = parseInt(noradRaw.trim(), 10);
  if (isNaN(noradId) || noradId < 1 || noradId > 999999)
    errors.push(`L1 NORAD ID out of range: ${noradId}`);

  assertChar(errors, "L1 class", line, 7, "UCS ");

  const epochYearRaw = line.substring(18, 20);
  const epochDayRaw  = line.substring(20, 32);
  const epochYear2d  = parseInt(epochYearRaw, 10);
  if (isNaN(epochYear2d)) errors.push(`L1 epoch year invalid: "${epochYearRaw}"`);
  const epochDay = assertFloat(errors, "L1 epoch day", epochDayRaw, 1.0, 366.9999999);

  const mmDot = parseFloat(line.substring(33, 43).trim());
  if (isNaN(mmDot)) errors.push(`L1 mean-motion dot invalid: "${line.substring(33, 43).trim()}"`);

  const mmDotDot = parseCompactExp(line.substring(44, 52));
  if (isNaN(mmDotDot)) errors.push(`L1 mean-motion ddot invalid: "${line.substring(44, 52).trim()}"`);

  const bstar = parseCompactExp(line.substring(53, 61));
  if (isNaN(bstar)) errors.push(`L1 BSTAR invalid: "${line.substring(53, 61).trim()}"`);

  assertChar(errors, "L1 eph-type", line, 62, "0123456789 ");

  const computedCs = lineChecksum(line);
  const recordedCs = parseInt(line[68], 10);
  if (isNaN(recordedCs) || computedCs !== recordedCs)
    errors.push(`L1 checksum: computed ${computedCs}, stored ${line[68]}`);

  const fullYear = epochYear2d >= 57 ? 1900 + epochYear2d : 2000 + epochYear2d;
  const epochMs  = isNaN(epochDay)
    ? NaN
    : Date.UTC(fullYear, 0, 1) + (epochDay - 1) * 86400000;

  return {
    errors,
    noradId,
    classification:   line[7].trim() || "U",
    intlDesignator:   line.substring(9, 17).trim(),
    epochYear:        fullYear,
    epochDay,
    epochMs,
    meanMotionDot:    mmDot,
    meanMotionDotDot: mmDotDot,
    bstar,
    ephemerisType:    parseInt(line[62], 10) || 0,
    elementSetNumber: parseInt(line.substring(64, 68).trim(), 10) || 0,
  };
}

export function parseLine2(raw: string): ParsedLine2 {
  const line   = raw.trimEnd().padEnd(69);
  const errors: string[] = [];

  assertLength(errors, "L2", raw.trimEnd(), 69);
  assertChar(errors, "L2", line, 0, "2");

  const noradRaw = line.substring(2, 7);
  assertNumeric(errors, "L2 NORAD", noradRaw);
  const noradId  = parseInt(noradRaw.trim(), 10);
  if (isNaN(noradId) || noradId < 1) errors.push(`L2 NORAD ID invalid: "${noradRaw}"`);

  const inclination = assertFloat(errors, "L2 inclination", line.substring(8, 16), 0, 180);
  const raan        = assertFloat(errors, "L2 RAAN",        line.substring(17, 25), 0, 360);

  const eccRaw = line.substring(26, 33);
  if (!/^\d{7}$/.test(eccRaw.trim().padStart(7, "0")))
    errors.push(`L2 eccentricity non-numeric: "${eccRaw}"`);
  const eccentricity = parseInt(eccRaw.trim() || "0", 10) * 1e-7;
  if (eccentricity < 0 || eccentricity >= 1)
    errors.push(`L2 eccentricity out of range: ${eccentricity}`);

  const argPerigee  = assertFloat(errors, "L2 arg-perigee",  line.substring(34, 42), 0, 360);
  const meanAnomaly = assertFloat(errors, "L2 mean-anomaly", line.substring(43, 51), 0, 360);

  const meanMotion = parseFloat(line.substring(52, 63).trim());
  if (isNaN(meanMotion) || meanMotion <= 0)
    errors.push(`L2 mean motion invalid: "${line.substring(52, 63).trim()}"`);

  const revNumber  = parseInt(line.substring(63, 68).trim(), 10) || 0;

  const computedCs = lineChecksum(line);
  const recordedCs = parseInt(line[68], 10);
  if (isNaN(recordedCs) || computedCs !== recordedCs)
    errors.push(`L2 checksum: computed ${computedCs}, stored ${line[68]}`);

  return {
    errors, noradId, inclination, raan, eccentricity,
    argPerigee, meanAnomaly, meanMotion, revolutionNumber: revNumber,
  };
}

// ─── Block and catalog parsers ────────────────────────────────────────────────

export function parseTleBlock(nameRaw: string, line1Raw: string, line2Raw: string): TleBlockResult {
  const name   = (nameRaw || "").trim();
  const l1     = parseLine1(line1Raw);
  const l2     = parseLine2(line2Raw);
  const errors = [...l1.errors, ...l2.errors];

  if (l1.noradId !== undefined && l2.noradId !== undefined && l1.noradId !== l2.noradId)
    errors.push(`NORAD ID mismatch: L1=${l1.noradId} L2=${l2.noradId}`);

  if (errors.length > 0) return { ok: false, name, errors };

  return {
    ok:  true,
    tle: {
      noradId:          l1.noradId,
      name,
      line1:            line1Raw.trimEnd(),
      line2:            line2Raw.trimEnd(),
      epochMs:          l1.epochMs,
      classification:   l1.classification,
      intlDesignator:   l1.intlDesignator,
      bstar:            l1.bstar,
      meanMotionDot:    l1.meanMotionDot,
      inclination:      l2.inclination,
      raan:             l2.raan,
      eccentricity:     l2.eccentricity,
      argPerigee:       l2.argPerigee,
      meanAnomaly:      l2.meanAnomaly,
      meanMotion:       l2.meanMotion,
      revolutionNumber: l2.revolutionNumber,
    },
  };
}

export function parseCatalog(text: string): ParseCatalogResult {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines[0]?.startsWith("GP data has not updated")) {
    return { tles: [], parseErrors: [], noNewData: true };
  }

  const tles:        TleRecord[]  = [];
  const parseErrors: ParseError[] = [];

  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;

    if (l[0] === "1" && l[1] === " " && l.length === 69) {
      const result = parseTleBlock("", l, lines[i + 1] ?? "");
      if (result.ok) tles.push(result.tle); else parseErrors.push(result);
      i += 2;
    } else if (l[0] === "2" && l[1] === " ") {
      i++;
    } else {
      const l1 = lines[i + 1] ?? "";
      const l2 = lines[i + 2] ?? "";
      if (l1[0] === "1" && l1[1] === " " && l2[0] === "2" && l2[1] === " ") {
        const result = parseTleBlock(l, l1, l2);
        if (result.ok) tles.push(result.tle); else parseErrors.push(result);
        i += 3;
      } else {
        i++;
      }
    }
  }

  return { tles, parseErrors };
}
