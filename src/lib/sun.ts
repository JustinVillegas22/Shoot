// src/lib/sun.ts
import * as Astronomy from "astronomy-engine";
import type { LatLng } from "@/lib/geo";

export type SunTimes = {
  sunset: Date | null;
  sunrise: Date | null;
};

/**
 * Returns sunset for the current evening and sunrise for the next morning.
 * Values may be null at extreme latitudes.
 */
export function getSunTimes(
  current: LatLng,
  now = new Date()
): SunTimes {
  const observer = new Astronomy.Observer(current.lat, current.lng, 0);

  const todayNoon = new Date(now);
  todayNoon.setHours(12, 0, 0, 0);

  const tomorrowNoon = new Date(todayNoon);
  tomorrowNoon.setDate(todayNoon.getDate() + 1);

  const sunsetTime = Astronomy.SearchRiseSet(
    Astronomy.Body.Sun,
    observer,
    -1,
    todayNoon,
    1
  );

  const sunriseTime = Astronomy.SearchRiseSet(
    Astronomy.Body.Sun,
    observer,
    +1,
    tomorrowNoon,
    1
  );

  return {
    sunset: sunsetTime ? sunsetTime.date : null,
    sunrise: sunriseTime ? sunriseTime.date : null,
  };
}