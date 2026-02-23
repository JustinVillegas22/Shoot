import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const repoRoot = process.cwd();

const rawDir = path.join(repoRoot, "src", "data", "catalog", "raw");
const ngcPath = path.join(rawDir, "NGC.csv");
const addendumPath = path.join(rawDir, "addendum.csv");

const outputDir = path.join(repoRoot, "src", "data", "generated");
const outputPath = path.join(outputDir, "objects.generated.json");

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");

  if (text.startsWith("<!DOCTYPE")) {
    throw new Error(`${filePath} is HTML, not CSV.`);
  }

  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ";",
  });
}

function mapType(t) {
  if (!t) return null;
  t = String(t).trim();

  if (["G", "GPair", "GTrpl", "GGroup"].includes(t)) return "galaxy";
  if (["OCl", "GCl", "Cl+N", "*Ass"].includes(t)) return "cluster";
  if (["Neb", "PN", "HII", "SNR", "EmN", "RfN", "DrkN"].includes(t)) return "nebula";

  return null;
}

function parseRa(str) {
  const s = String(str ?? "").trim();
  const m = s.match(/^(\d+):(\d+):(\d+(\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
}

function parseDec(str) {
  const s = String(str ?? "").trim();
  const m = s.match(/^([+-])(\d+):(\d+):(\d+(\.\d+)?)$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600);
}
function readCrosswalk(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ",",
  });
}

function norm(s) {
  // normalize for matching: uppercase, remove spaces
  return String(s ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function indexRows(rows) {
  const idx = new Map();

  function addKey(keys, k) {
    const nk = norm(k);
    if (nk) keys.add(nk);
  }

  for (const r of rows) {
    const keys = new Set();

    // Primary name (e.g., IC0001, NGC1234, Sh2-155, etc.)
    const name = String(r["Name"] ?? "").trim();
    addKey(keys, name);

    // If Name looks like IC0001 / NGC0123, add a version without leading zeros
    {
      const m = name.match(/^(IC|NGC)\s*0*(\d+)$/i);
      if (m) addKey(keys, `${m[1].toUpperCase()} ${Number(m[2])}`);
    }

    // VERY IMPORTANT: index by NGC / IC numeric columns if present
    const ngcNum = String(r["NGC"] ?? "").trim();
    if (ngcNum) addKey(keys, `NGC ${Number(ngcNum)}`);

    const icNum = String(r["IC"] ?? "").trim();
    if (icNum) addKey(keys, `IC ${Number(icNum)}`);

    // Identifiers column (comma-separated)
    const identifiers = String(r["Identifiers"] ?? "");
    for (const part of identifiers.split(",")) {
      const p = part.trim();
      if (p) addKey(keys, p);
    }

    // Common names column (pipe-separated)
    const commons = String(r["Common names"] ?? "");
    for (const part of commons.split("|")) {
      const p = part.trim();
      if (p) addKey(keys, p);
    }

    // Store first match wins
    for (const k of keys) {
      if (!idx.has(k)) idx.set(k, r);
    }
  }

  return idx;
}
function build(rows, caldwellCrosswalk) {
  const map = new Map();

  // Build a lookup index for Caldwell designations → OpenNGC rows
  const idx = indexRows(rows);
  const missingList = [];

  // --- Messier from OpenNGC (same idea as you already have) ---
  for (const r of rows) {
    const type = mapType(r["Type"]);
    if (!type) continue;

    const ra = parseRa(r["RA"]);
    const dec = parseDec(r["Dec"]);
    const constellation = String(r["Const"] ?? "").trim();
    if (ra === null || dec === null || !constellation) continue;

    const name = (r["Common names"]?.split("|")[0] || r["Name"] || "").toString().trim();
    if (!name) continue;

    const mRaw = String(r["M"] ?? "").trim();
    const m = mRaw ? Number(mRaw) : NaN;

    if (Number.isInteger(m) && m >= 1 && m <= 110) {
      const id = `m${m}`;
      if (!map.has(id)) {
        map.set(id, { id, name, type, constellation, ra, dec });
      }
    }
  }

  // --- Caldwell from crosswalk ---
  let caldwellMissing = 0;

  for (const row of caldwellCrosswalk) {
    const cNum = Number(String(row.c ?? "").trim());
    const designation = String(row.designation ?? "").trim();
    if (!Number.isInteger(cNum) || cNum < 1 || cNum > 109 || !designation) continue;

    const id = `c${cNum}`;
    if (map.has(id)) continue;

    // Some entries have multiple acceptable designations (e.g., "NGC 869|NGC 884")
    const candidates = designation.split("|").map((s) => s.trim()).filter(Boolean);

    let matched = null;
    for (const cand of candidates) {
      matched = idx.get(norm(cand));
      if (matched) break;
    }

if (!matched) {
  caldwellMissing++;
  missingList.push({ id, designation });
  continue;
}

    const type = mapType(matched["Type"]);
    if (!type) continue;

    const ra = parseRa(matched["RA"]);
    const dec = parseDec(matched["Dec"]);
    const constellation = String(matched["Const"] ?? "").trim();
    if (ra === null || dec === null || !constellation) continue;

    const name = (matched["Common names"]?.split("|")[0] || matched["Name"] || "").toString().trim();
    if (!name) continue;

    map.set(id, { id, name, type, constellation, ra, dec });
  }

  if (caldwellMissing > 0) {
    console.log(`[generate-objects] Caldwell crosswalk missing matches: ${caldwellMissing}`);
  }
if (missingList.length) {
  console.log("[generate-objects] Missing Caldwell entries:");
  for (const m of missingList) {
    console.log(`  ${m.id}: ${m.designation}`);
  }
}
  return Array.from(map.values());
}

// MAIN
const caldwellCrosswalkPath = path.join(
  repoRoot,
  "src",
  "data",
  "catalog",
  "caldwell_crosswalk.csv"
);

const ngc = readCsv(ngcPath);
const addendum = readCsv(addendumPath);
const crosswalk = readCrosswalk(caldwellCrosswalkPath);

const objects = build([...ngc, ...addendum], crosswalk);

fs.mkdirSync(outputDir, { recursive: true });

objects.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

fs.writeFileSync(outputPath, JSON.stringify(objects, null, 2));

const messier = objects.filter((o) => o.id.startsWith("m")).length;
const caldwell = objects.filter((o) => o.id.startsWith("c")).length;

console.log(`Generated ${objects.length} objects. Messier: ${messier}, Caldwell: ${caldwell}`);