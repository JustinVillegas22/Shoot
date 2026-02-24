"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { HOME, DECK } from "@/config/observing";
import { OBJECTS } from "@/data/objects";
import { isWithinRadius, type LatLng } from "@/lib/geo";
import { getBrowserLocation } from "@/lib/geolocation";
import { getMoonNow } from "@/lib/moon";
import { getVisibilityTonight } from "@/lib/visibility";
import {
  rateDwarfMiniTarget,
  sortForDwarfMini,
  type Suitability,
} from "@/lib/dwarfMini";
import { getSunTimes } from "@/lib/sun";
import { buildWikiTitleCandidates } from "@/lib/wikiTitles";

/* ----------------------------------------------------- */
/* Types */
/* ----------------------------------------------------- */

type Mode = "home" | "away" | "unknown";
type Status = "locating" | "ready" | "error";

type VisibleObject = {
  obj: (typeof OBJECTS)[number];
  window: NonNullable<ReturnType<typeof getVisibilityTonight>>;
  suitability: Suitability;
  reasons: string[];
};

type Thumb = { src: string | null; pageUrl: string | null };

/* ----------------------------------------------------- */
/* Shared styles */
/* ----------------------------------------------------- */

const card =
  "rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur";

const sectionTitle =
  "text-sm font-semibold tracking-wide text-white/90";

const helper = "mt-2 text-sm text-white/70";
const subtle = "text-xs text-white/50";

/* ----------------------------------------------------- */
/* Utils */
/* ----------------------------------------------------- */

function clampToNight<T extends { start: Date; end: Date; best: Date }>(
  w: T,
  sun: { sunset: Date | null; sunrise: Date | null } | null
): T | null {
  if (!sun?.sunset || !sun?.sunrise) return w;

  if (w.end <= sun.sunset) return null;
  if (w.start >= sun.sunrise) return null;

  const start = w.start < sun.sunset ? sun.sunset : w.start;
  const end = w.end > sun.sunrise ? sun.sunrise : w.end;

  if (end <= start) return null;

  const best = w.best < start ? start : w.best > end ? end : w.best;

  return { ...w, start, end, best };
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ----------------------------------------------------- */
/* Wiki thumbnails */
/* ----------------------------------------------------- */

function useWikiThumbnails(
  items: { id: string; titles: string[] }[]
) {
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!items.length) return;

      const cacheKey = "shootTonight.wikiThumbs.v8";

      const cachedRaw = localStorage.getItem(cacheKey);
      const cached: Record<string, Thumb> = cachedRaw
        ? JSON.parse(cachedRaw)
        : {};

      const missing = items.filter(
        (it) => cached[String(it.id)] === undefined
      );

      if (!cancelled) setThumbs(cached);
      if (!missing.length) return;

      const results = await Promise.all(
        missing.map(async (it) => {
          try {
            const res = await fetch("/api/wiki-object", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titles: it.titles }),
            });

            if (!res.ok)
              return [it.id, { src: null, pageUrl: null }] as const;

            const data = (await res.json()) as {
              pageUrl: string | null;
              thumbSrc: string | null;
              imageSrc: string | null;
            };

            const src =
              data.thumbSrc ?? data.imageSrc ?? null;

            return [
              it.id,
              { src, pageUrl: data.pageUrl ?? null },
            ] as const;
          } catch {
            return [it.id, { src: null, pageUrl: null }] as const;
          }
        })
      );

      const fresh = Object.fromEntries(results);
      const merged = { ...cached, ...fresh };

      localStorage.setItem(cacheKey, JSON.stringify(merged));

      if (!cancelled) setThumbs(merged);
    })();

    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(items)]);

  return thumbs;
}

/* ----------------------------------------------------- */
/* Hooks */
/* ----------------------------------------------------- */

function useObservingContext() {
  const [status, setStatus] = useState<Status>("locating");
  const [error, setError] = useState<string | null>(null);

  const [current, setCurrent] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<Mode>("unknown");
  const [needsChoice, setNeedsChoice] = useState(false);

  const isHome = useMemo(() => {
    if (!current) return false;

    return isWithinRadius(
      current,
      { lat: HOME.lat, lng: HOME.lng },
      HOME.radiusMeters
    );
  }, [current]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStatus("locating");
      setError(null);

      try {
        const loc = await getBrowserLocation();

        if (cancelled) return;

        setCurrent(loc);

        const saved =
          typeof window !== "undefined"
            ? (localStorage.getItem(
                "shootTonight.mode"
              ) as Mode | null)
            : null;

        const home = isWithinRadius(
          loc,
          { lat: HOME.lat, lng: HOME.lng },
          HOME.radiusMeters
        );

        if (home) {
          setMode("home");
          setNeedsChoice(false);
        } else if (saved === "home" || saved === "away") {
          setMode(saved);
          setNeedsChoice(false);
        } else {
          setMode("unknown");
          setNeedsChoice(true);
        }

        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;

        setStatus("error");
        setError(e?.message ?? "Could not get location.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const chooseHome = () => {
    localStorage.setItem("shootTonight.mode", "home");
    setMode("home");
    setNeedsChoice(false);
  };

  const chooseAway = () => {
    localStorage.setItem("shootTonight.mode", "away");
    setMode("away");
    setNeedsChoice(false);
  };

  return {
    status,
    error,
    current,
    mode,
    needsChoice,
    isHome,
    chooseHome,
    chooseAway,
  };
}

function useMoon(current: LatLng | null, status: Status) {
  return useMemo(() => {
    if (!current || status !== "ready") return null;

    return getMoonNow(current);
  }, [current, status]);
}

function useSunTimes(current: LatLng | null, status: Status) {
  return useMemo(() => {
    if (!current || status !== "ready") return null;

    return getSunTimes(current);
  }, [current, status]);
}

function useVisibleObjects(args: {
  current: LatLng | null;
  status: Status;
  mode: Mode;
  moon: {
    altitude: number;
    azimuth: number;
    illumination: number;
  } | null;
  sunTimes: {
    sunset: Date | null;
    sunrise: Date | null;
  } | null;
}) {
  const { current, status, mode, moon, sunTimes } = args;

  return useMemo<VisibleObject[]>(() => {
    if (!current || status !== "ready") return [];

    const useDeck = mode === "home";
    const out: VisibleObject[] = [];

    for (const obj of OBJECTS) {
      const raw = getVisibilityTonight(
        obj,
        current,
        DECK.minAltitude,
        useDeck ? DECK.azimuthStart : undefined,
        useDeck ? DECK.azimuthEnd : undefined
      );

      if (!raw) continue;

      const visibility = clampToNight(raw, sunTimes);

      if (!visibility) continue;

      const rating = rateDwarfMiniTarget({
        obj,
        window: visibility,
        moon,
      });

      if (rating.suitability === "hard") continue;

      out.push({
        obj,
        window: visibility,
        suitability: rating.suitability,
        reasons: rating.reasons,
      });
    }

    return sortForDwarfMini(out);
  }, [current, status, mode, moon]);
}

/* ----------------------------------------------------- */
/* Sections */
/* ----------------------------------------------------- */

function LocationSection(props: any) {
  const {
    status,
    error,
    current,
    mode,
    needsChoice,
    isHome,
    sunTimes,
    onChooseHome,
    onChooseAway,
  } = props;

  return (
    <section className={`mt-6 ${card}`}>
      <h2 className={sectionTitle}>Location</h2>

      {status === "locating" && <p className={helper}>Finding your location…</p>}

      {status === "error" && (
        <p className="mt-2 text-sm text-red-300">
          {error ?? "Location error."}
        </p>
      )}

      {status === "ready" && current && (
        <>
          <p className="mt-3 text-sm">
            <span className="text-white/60">Current:</span>{" "}
            <span className="font-mono">
              {current.lat.toFixed(6)}, {current.lng.toFixed(6)}
            </span>
          </p>

          {sunTimes && (
            <p className="mt-2 text-sm text-white/70">
              Sunset:{" "}
              <span className="font-mono">
                {sunTimes.sunset
                  ? formatTime(sunTimes.sunset)
                  : "—"}
              </span>{" "}
              • Sunrise:{" "}
              <span className="font-mono">
                {sunTimes.sunrise
                  ? formatTime(sunTimes.sunrise)
                  : "—"}
              </span>
            </p>
          )}

          {needsChoice && (
            <>
              <p className="mt-3 text-sm text-white/75">
                Are you shooting from home or your current location?
              </p>

              <div className="mt-3 flex gap-3">
                <button
                  onClick={onChooseHome}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  Use Home
                </button>

                <button
                  onClick={onChooseAway}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  Use Current
                </button>
              </div>
            </>
          )}

          {!needsChoice && (
            <p className="mt-2 text-sm text-white/70">
              Mode:{" "}
              <span className="font-semibold text-white">
                {mode === "home" ? "Home" : "Away"}
              </span>
            </p>
          )}

          <p className="mt-2 text-xs text-white/50">
            Home check: {isHome ? "within radius" : "outside radius"}
          </p>
        </>
      )}
    </section>
  );
}

function AvailableTonightSection(props: any) {
  const {
    visibleObjects,
    current,
    mode,
    status,
    needsChoice,
    moon,
  } = props;

  const canShow =
    status === "ready" && current && !needsChoice;

  const thumbItems = useMemo(() => {
    if (!canShow) return [];

    return visibleObjects.map(({ obj }: any) => ({
      id: String(obj.id),
      titles: buildWikiTitleCandidates({
        id: String(obj.id),
        name: String(obj.name),
      }),
    }));
  }, [canShow, visibleObjects]);

  const thumbs = useWikiThumbnails(thumbItems);

  return (
    <section className={`mt-6 ${card}`}>
      <h2 className={sectionTitle}>Available Tonight</h2>

      {!canShow && (
        <p className={helper}>
          {status !== "ready"
            ? "Waiting on location…"
            : "Choose a shooting mode to see targets…"}
        </p>
      )}

      {canShow && visibleObjects.length === 0 && (
        <p className={helper}>
          No realistic targets tonight.
        </p>
      )}

      {canShow && (
        <div className="mt-4 grid gap-3">
          {visibleObjects.map(
            ({ obj, window, suitability }: any) => {
              const img = thumbs[String(obj.id)];

              return (
                <Link
                  key={obj.id}
                  href={`/object/${obj.id}?mode=${mode}&lat=${current?.lat ?? ""}&lng=${current?.lng ?? ""}`}
                  className="block overflow-hidden rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10"
                >
                  <div className="flex gap-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                      {img?.src ? (
                        <img
                          src={img.src}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-white/40">
                          —
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <span className="truncate">
                          {obj.name}
                        </span>

                        {suitability === "great" && (
                          <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-white/80">
                            Very Visible
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-white/70">
                        {obj.type} • {obj.constellation}
                      </div>

                      <div className="mt-1 text-xs text-white/50">
                        {formatTime(window.start)} –{" "}
                        {formatTime(window.end)} • Best:{" "}
                        {formatTime(window.best)} •{" "}
                        {Math.round(window.maxAlt)}°
                      </div>
                    </div>
                  </div>
                </Link>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------- */
/* Page */
/* ----------------------------------------------------- */

export default function Page() {
  const observing = useObservingContext();
  const moon = useMoon(observing.current, observing.status);
  const sunTimes = useSunTimes(observing.current, observing.status);

  const visibleObjects = useVisibleObjects({
    current: observing.current,
    status: observing.status,
    mode: observing.mode,
    moon,
    sunTimes,
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-neutral-900">
      <div className="mx-auto max-w-3xl p-6 font-sans text-white">
        <header className="mt-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Shoot Tonight
          </h1>

          <p className="mt-1 text-sm text-white/70">
            Finds targets you can actually capture tonight — tailored to your deck.
          </p>
        </header>

        <LocationSection
          status={observing.status}
          error={observing.error}
          current={observing.current}
          mode={observing.mode}
          needsChoice={observing.needsChoice}
          isHome={observing.isHome}
          sunTimes={sunTimes}
          onChooseHome={observing.chooseHome}
          onChooseAway={observing.chooseAway}
        />

        <AvailableTonightSection
          visibleObjects={visibleObjects}
          current={observing.current}
          mode={observing.mode}
          status={observing.status}
          needsChoice={observing.needsChoice}
          moon={moon}
        />
      </div>
    </main>
  );
}