import type { LatLng } from "./geo";
import type { AstroObject } from "@/data/objects";

export type VisibilityWindow = {
  start: Date;
  end: Date;
  best: Date;
  maxAlt: number;
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}
function radToDeg(r: number) {
  return (r * 180) / Math.PI;
}
function normalizeDeg0to360(d: number) {
  return ((d % 360) + 360) % 360;
}

/**
 * Convert JS Date -> Julian Date
 */
function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Greenwich Mean Sidereal Time (degrees)
 * Good enough for an MVP visibility planner.
 */
function gmstDeg(date: Date): number {
  const JD = julianDate(date);
  const T = (JD - 2451545.0) / 36525.0;

  const gmst =
    280.46061837 +
    360.98564736629 * (JD - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;

  return normalizeDeg0to360(gmst);
}

/**
 * Convert RA/Dec -> Alt/Az for a given observer and time.
 * Returns azimuth in degrees (0..360, 0=N, 90=E) and altitude in degrees.
 */
function raDecToAltAz(
  raHours: number,
  decDeg: number,
  obs: LatLng,
  date: Date
): { az: number; alt: number } {
  const raDeg = raHours * 15; // hours -> degrees

  const latRad = degToRad(obs.lat);
  const decRad = degToRad(decDeg);

  const lstDeg = normalizeDeg0to360(gmstDeg(date) + obs.lng); // lng east+, west-
  let haDeg = normalizeDeg0to360(lstDeg - raDeg);
  if (haDeg > 180) haDeg -= 360; // map to (-180..180) for trig stability
  const haRad = degToRad(haDeg);

  const sinAlt =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);

  const altRad = Math.asin(sinAlt);
  const altDeg = radToDeg(altRad);

  const cosAlt = Math.cos(altRad);

  // Avoid division edge cases near zenith
  if (Math.abs(cosAlt) < 1e-12) {
    return { az: 0, alt: altDeg };
  }

  const sinAz = (-Math.cos(decRad) * Math.sin(haRad)) / cosAlt;
  const cosAz =
    (Math.sin(decRad) - Math.sin(altRad) * Math.sin(latRad)) /
    (cosAlt * Math.cos(latRad));

  const azRad = Math.atan2(sinAz, cosAz);
  const azDeg = normalizeDeg0to360(radToDeg(azRad));

  return { az: azDeg, alt: altDeg };
}

function tonightEndLocal(now: Date): Date {
  // "Tonight" ends at 6:00am local time
  const end = new Date(now);
  end.setHours(6, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}

export function getVisibilityTonight(
  obj: AstroObject,
  location: LatLng,
  minAlt: number,
  azMin?: number,
  azMax?: number
): VisibilityWindow | null {
  const now = new Date();
  const end = tonightEndLocal(now);
  const stepMinutes = 5;

  const visible: { t: Date; alt: number }[] = [];

  for (
    let t = new Date(now);
    t <= end;
    t = new Date(t.getTime() + stepMinutes * 60000)
  ) {
    const { az, alt } = raDecToAltAz(obj.ra, obj.dec, location, t);

    if (alt < minAlt) continue;

    // Home-only: apply deck az window
    if (azMin !== undefined && azMax !== undefined) {
      if (az < azMin || az > azMax) continue;
    }

    visible.push({ t, alt });
  }

  if (visible.length === 0) return null;

  const start = visible[0].t;
  const endTime = visible[visible.length - 1].t;

  let best = start;
  let maxAlt = -90;

  for (const v of visible) {
    if (v.alt > maxAlt) {
      maxAlt = v.alt;
      best = v.t;
    }
  }

  return { start, end: endTime, best, maxAlt };
}