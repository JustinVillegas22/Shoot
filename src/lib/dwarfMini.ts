// src/lib/dwarfMini.ts

export type Suitability = "great" | "ok" | "hard";

export type DwarfMiniRating = {
  suitability: Suitability;
  reasons: string[];
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getMagnitude(obj: any): number | null {
  return (
    toNumber(obj.magnitude) ??
    toNumber(obj.mag) ??
    toNumber(obj.vmag) ??
    toNumber(obj.bmag) ??
    toNumber(obj.photMag) ??
    null
  );
}

export function getSizeArcmin(obj: any): number | null {
  const direct =
    toNumber(obj.sizeArcmin) ??
    toNumber(obj.diameterArcmin) ??
    toNumber(obj.sizeMajor) ??
    toNumber(obj.majorAxis) ??
    null;

  if (direct !== null) return direct;

  const s = obj.size;
  if (typeof s === "string") {
    const parts = s.toLowerCase().replace("×", "x").split("x");
    const major = toNumber(parts[0]);
    if (major !== null) return major;
  }

  return null;
}

function normalizeType(t: unknown): string {
  return String(t ?? "").toLowerCase();
}

// Keep this permissive but focused on typical Mini-friendly DSO categories
function isSupportedType(typeStr: string): boolean {
  return (
    typeStr.includes("galaxy") ||
    typeStr.includes("nebula") ||
    typeStr.includes("cluster") ||
    typeStr.includes("open") ||
    typeStr.includes("globular") ||
    typeStr.includes("planetary")
  );
}

export function moonIsProblematic(moon: { altitude: number; illumination: number } | null) {
  if (!moon) return false;
  return moon.altitude > 0 && moon.illumination >= 0.6;
}

/**
 * Conservative feasibility + recommendation scoring for DWARF Mini.
 * - "hard" = excluded from list
 * - "great" = recommended at top
 * - "ok" = still realistic
 */
export function rateDwarfMiniTarget(args: {
  obj: any;
  window: { start: Date; end: Date; maxAlt: number };
  moon: { altitude: number; illumination: number } | null;
}): DwarfMiniRating {
  const { obj, window, moon } = args;

  const reasons: string[] = [];
  const typeStr = normalizeType(obj.type);

  if (!isSupportedType(typeStr)) {
    return { suitability: "hard", reasons: ["Unsupported type"] };
  }

  const mag = getMagnitude(obj);
  const sizeArcmin = getSizeArcmin(obj);

  const durationMin = (window.end.getTime() - window.start.getTime()) / 60000;

  // Basic observing quality notes (not all are disqualifiers)
  if (window.maxAlt < 25) reasons.push("Low max altitude");
  if (durationMin < 45) reasons.push("Short window");

  // Size heuristics (tele lens reality)
  if (sizeArcmin !== null) {
    if (sizeArcmin < 3) reasons.push("Very small target");
    if (sizeArcmin > 240) reasons.push("Very large target");
  } else {
    reasons.push("Unknown size");
  }

  // Mag heuristics (galaxies harsher than clusters/nebulae at same mag)
  if (mag !== null) {
    if (typeStr.includes("galaxy")) {
      if (mag > 10.5) reasons.push("Dim galaxy");
      else if (mag > 9.5) reasons.push("Moderately dim galaxy");
    } else {
      if (mag > 11.5) reasons.push("Dim target");
      else if (mag > 10.5) reasons.push("Moderately dim target");
    }
  } else {
    reasons.push("Unknown magnitude");
  }

  const moonBad = moonIsProblematic(moon);
  if (moonBad) reasons.push(typeStr.includes("galaxy") ? "Bright moon (galaxy contrast hit)" : "Bright moon (contrast hit)");

  // HARD exclusions (realistic filter)
  const tooLow = window.maxAlt < 20;
  const tooShort = durationMin < 30;
  const huge = sizeArcmin !== null && sizeArcmin > 240;
  const galaxyTooDim = typeStr.includes("galaxy") && mag !== null && mag > 10.5;
  const tooDim = !typeStr.includes("galaxy") && mag !== null && mag > 11.5;

  if (tooLow || tooShort || huge || galaxyTooDim || tooDim) {
    return { suitability: "hard", reasons };
  }

  // GREAT conditions (recommended)
  const goodAlt = window.maxAlt >= 35;
  const goodWindow = durationMin >= 75;
  const notTiny = sizeArcmin !== null && sizeArcmin >= 6; // require known size for "great"
  const notDim =
    mag !== null &&
    (typeStr.includes("galaxy") ? mag <= 9.5 : mag <= 10.5);

  if (goodAlt && goodWindow && notTiny && notDim && !moonBad) {
    return { suitability: "great", reasons };
  }

  return { suitability: "ok", reasons };
}

export function sortForDwarfMini<T extends { suitability: Suitability; window: { maxAlt: number; start: Date; end: Date } }>(
  items: T[]
): T[] {
  const rank = (s: Suitability) => (s === "great" ? 2 : s === "ok" ? 1 : 0);

  return [...items].sort((a, b) => {
    const r = rank(b.suitability) - rank(a.suitability);
    if (r !== 0) return r;

    const alt = b.window.maxAlt - a.window.maxAlt;
    if (alt !== 0) return alt;

    const durB = b.window.end.getTime() - b.window.start.getTime();
    const durA = a.window.end.getTime() - a.window.start.getTime();
    return durB - durA;
  });
}