import { Body, Equator, Horizon, MoonPhase, Observer } from "astronomy-engine";
import type { LatLng } from "@/lib/geo";

export type MoonNow = {
  altitude: number; // degrees
  azimuth: number; // degrees
  illumination: number; // 0..1
  phaseAngle: number; // 0..360 (0=new, 180=full)
  phaseName: string; // human-friendly label
};

function normalizeAngle360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function moonPhaseNameFromAngle(phaseAngleDeg: number): string {
  const a = normalizeAngle360(phaseAngleDeg);

  // 8-phase buckets centered on the canonical angles
  // 0=new, 90=first quarter, 180=full, 270=last quarter
  if (a < 22.5 || a >= 337.5) return "New Moon";
  if (a < 67.5) return "Waxing Crescent";
  if (a < 112.5) return "First Quarter";
  if (a < 157.5) return "Waxing Gibbous";
  if (a < 202.5) return "Full Moon";
  if (a < 247.5) return "Waning Gibbous";
  if (a < 292.5) return "Last Quarter";
  return "Waning Crescent";
}

export function getMoonNow(loc: LatLng, date = new Date()): MoonNow {
  const observer = new Observer(loc.lat, loc.lng, 0);

  // Get equatorial coords of the Moon
  const eq = Equator(Body.Moon, date, observer, true, true);

  // Convert to horizon coords (alt/az)
  const hor = Horizon(date, observer, eq.ra, eq.dec, "normal");

  // Phase angle (degrees) where 0=new, 180=full
  const rawPhaseAngle = MoonPhase(date);
  const phaseAngle = normalizeAngle360(rawPhaseAngle);

  // Phase angle → illumination fraction (0..1)
  const illumination = (1 - Math.cos((phaseAngle * Math.PI) / 180)) / 2;

  return {
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    illumination,
    phaseAngle,
    phaseName: moonPhaseNameFromAngle(phaseAngle),
  };
}