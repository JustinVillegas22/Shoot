"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { HOME, DECK } from "@/config/observing";
import { OBJECTS } from "@/data/objects";
import { isWithinRadius, type LatLng } from "@/lib/geo";
import { getBrowserLocation } from "@/lib/geolocation";
import { getMoonNow } from "@/lib/moon";
import { getVisibilityTonight } from "@/lib/visibility";
import { rateDwarfMiniTarget, sortForDwarfMini, type Suitability } from "@/lib/dwarfMini";
import { getSunTimes } from "@/lib/sun";
import { buildWikiTitleCandidates } from "@/lib/wikiTitles";

type Mode = "home" | "away" | "unknown";
type Status = "locating" | "ready" | "error";

type VisibleObject = {
  obj: (typeof OBJECTS)[number];
  window: NonNullable<ReturnType<typeof getVisibilityTonight>>;
  suitability: Suitability;
  reasons: string[];
};

type Thumb = { src: string | null; pageUrl: string | null };

function clampToNight<T extends { start: Date; end: Date; best: Date }>(
  w: T,
  sun: { sunset: Date | null; sunrise: Date | null } | null
): T | null {
  if (!sun?.sunset || !sun?.sunrise) return w;

  // If the window doesn't overlap night at all, drop it
  if (w.end <= sun.sunset) return null;
  if (w.start >= sun.sunrise) return null;

  const start = w.start < sun.sunset ? sun.sunset : w.start;
  const end = w.end > sun.sunrise ? sun.sunrise : w.end;

  if (end <= start) return null;

  // Keep best as-is, but clamp into [start,end]
  const best = w.best < start ? start : w.best > end ? end : w.best;

  return { ...w, start, end, best };
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MoonPhaseThumb(props: { phaseAngle: number | null | undefined; size?: number }) {
  const size = props.size ?? 64;
  const r = size / 2;

  const uid = useId();
const clipId = `moon-clip-${uid}`;

  if (props.phaseAngle == null) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">—</div>
    );
  }

  // Normalize 0..360 where:
  // 0=new, 90=first quarter, 180=full, 270=last quarter
  const a = ((props.phaseAngle % 360) + 360) % 360;

  // Convert phase angle to illuminated fraction (0..1).
  // cos(0)=1 => new => 0 illuminated; cos(180)=-1 => full => 1 illuminated
  const illum = (1 - Math.cos((a * Math.PI) / 180)) / 2;

  const waxing = a < 180; // 0..180 waxing, 180..360 waning
  // Terminator "offset" controls crescent vs gibbous.
  // Range [-1..1] where 0 is half-moon. This is a decent visual approximation.
  const k = (illum - 0.5) * 2; // -1 (new-ish) .. +1 (full-ish)

  // Ellipse width factor: small near quarters, big near new/full.
  // Keep within safe bounds so it renders nicely.
  const ellipseRx = Math.max(0.08, Math.min(0.98, Math.abs(k))) * r;

  // For waxing, bright on right; for waning, bright on left.
  const dir = waxing ? 1 : -1;

  // Move ellipse center left/right to shape the terminator.
  // For crescent (illum < 0.5), ellipse center moves toward the lit side.
  // For gibbous (illum > 0.5), ellipse center moves away from the lit side.
  const cx = r + dir * (r * (1 - Math.abs(k)) * 0.85);

  // When illum < 0.5, lit area is a crescent: intersection of circle and ellipse.
  // When illum > 0.5, lit area is circle minus "shadow" crescent: union-ish effect.
  // We approximate with two layers: base dark disk + clipped bright shape.
  const isGibbousOrFull = illum >= 0.5;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Moon phase">
      <defs>
        <clipPath id={clipId}>
  <circle cx={r} cy={r} r={r - 1} />
</clipPath>
      </defs>

      {/* base disk */}
      <circle cx={r} cy={r} r={r - 1} fill="rgb(38 38 38)" />

      {/* lighting */}
      <g clipPath={`url(#${clipId})`}>
        {isGibbousOrFull ? (
          <>
            {/* full bright disk */}
            <circle cx={r} cy={r} r={r - 1} fill="rgb(245 245 245)" />
            {/* subtract shadow via dark ellipse */}
            <ellipse cx={cx} cy={r} rx={ellipseRx} ry={r - 1} fill="rgb(38 38 38)" />
          </>
        ) : (
          <>
            {/* crescent via bright ellipse */}
            <ellipse cx={cx} cy={r} rx={ellipseRx} ry={r - 1} fill="rgb(245 245 245)" />
          </>
        )}
      </g>

      {/* subtle rim */}
      <circle cx={r} cy={r} r={r - 1} fill="none" stroke="rgb(120 113 108)" strokeOpacity="0.35" />
    </svg>
  );
}

function normalizeKey(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Manual overrides for objects whose common names don’t reliably map to a good Wikipedia page thumbnail.
 * IMPORTANT: Put the canonical catalog page first.
 */
const TITLE_ALIASES: Record<string, string[]> = {
  "whale galaxy": ["NGC 4631", "NGC4631"],
};

function buildTitleCandidates(obj: { id: any; name: any }) {
  const idRaw = String(obj.id ?? "").trim();
  const name = String(obj.name ?? "").trim();

  const titles: string[] = [];

  // aliases first
  const aliasKey = normalizeKey(name);
  if (aliasKey && TITLE_ALIASES[aliasKey]) titles.push(...TITLE_ALIASES[aliasKey]);

  // then normal candidates
  if (name) titles.push(name);
  if (idRaw) titles.push(idRaw);

  // add spaced versions if needed
  const m1 = idRaw.toUpperCase().match(/^(NGC|IC)\s?(\d+)$/);
  if (m1) titles.push(`${m1[1]} ${m1[2]}`);

  const m2 = name.toUpperCase().match(/^(NGC|IC)\s?(\d+)$/);
  if (m2) titles.push(`${m2[1]} ${m2[2]}`);

  // messier helper
  const m3 = idRaw.toUpperCase().match(/^M(\d+)$/);
  if (m3) titles.push(`Messier ${m3[1]}`);

  // de-dupe in order
  return Array.from(new Set(titles));
}

/**
 * Fetch thumbnails (cached in localStorage).
 * This calls your Next API route /api/wiki-thumb
 */
function useWikiThumbnails(items: { id: string; titles: string[] }[]) {
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!items.length) return;

      const cacheKey = "shootTonight.wikiThumbs.v8"; // bump
      const cachedRaw = localStorage.getItem(cacheKey);
      const cached: Record<string, Thumb> = cachedRaw ? JSON.parse(cachedRaw) : {};

      const missing = items.filter((it) => cached[String(it.id)] === undefined);

      if (!cancelled) setThumbs(cached);
      if (!missing.length) return;

      // fetch in parallel, but gently
      const results = await Promise.all(
        missing.map(async (it) => {
          try {
            const res = await fetch("/api/wiki-object", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titles: it.titles }),
            });

            if (!res.ok) return [it.id, { src: null, pageUrl: null }] as const;

            const data = (await res.json()) as {
              pageUrl: string | null;
              thumbSrc: string | null;
              imageSrc: string | null;
            };

            // prefer thumbSrc, fallback to imageSrc
            const src = data.thumbSrc ?? data.imageSrc ?? null;

            return [it.id, { src, pageUrl: data.pageUrl ?? null }] as const;
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



/** Local hook: owns location + mode choice. */
function useObservingContext() {
  const [status, setStatus] = useState<Status>("locating");
  const [error, setError] = useState<string | null>(null);

  const [current, setCurrent] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<Mode>("unknown");
  const [needsChoice, setNeedsChoice] = useState(false);

  const isHome = useMemo(() => {
    if (!current) return false;
    return isWithinRadius(current, { lat: HOME.lat, lng: HOME.lng }, HOME.radiusMeters);
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

        const saved = (typeof window !== "undefined"
  ? (localStorage.getItem("shootTonight.mode") as Mode | null)
  : null);

const home = isWithinRadius(loc, { lat: HOME.lat, lng: HOME.lng }, HOME.radiusMeters);

if (home) {
  // If you're actually at home, force home mode
  setMode("home");
  setNeedsChoice(false);
} else if (saved === "home" || saved === "away") {
  // If you're away, honor the user's saved choice
  setMode(saved);
  setNeedsChoice(false);
} else {
  // No saved choice yet
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

  return { status, error, current, mode, needsChoice, isHome, chooseHome, chooseAway };
}

/** Local hook: compute moon once. */
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

/** Local hook: computes visible objects for tonight + DWARF Mini filtering + sorting. */
function useVisibleObjects(args: {
  current: LatLng | null;
  status: Status;
  mode: Mode;
  moon: { altitude: number; azimuth: number; illumination: number } | null;
  sunTimes: { sunset: Date | null; sunrise: Date | null } | null;
}) {
  const { current, status, mode, moon, sunTimes } = args;

  return useMemo<VisibleObject[]>(() => {
    if (!current || status !== "ready") return [];

    const useDeck = mode === "home";
    const out: VisibleObject[] = [];

    for (const obj of OBJECTS) {
  const visibilityRaw = getVisibilityTonight(
    obj,
    current,
    DECK.minAltitude,
    useDeck ? DECK.azimuthStart : undefined,
    useDeck ? DECK.azimuthEnd : undefined
  );

  if (!visibilityRaw) continue;

  const visibility = clampToNight(visibilityRaw, sunTimes);

  if (!visibility) continue;


      const rating = rateDwarfMiniTarget({ obj, window: visibility, moon });

      // Only list realistic targets
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

/** --- Sections --- */

function LocationSection(props: {
  status: Status;
  error: string | null;
  current: LatLng | null;
  mode: Mode;
  needsChoice: boolean;
  isHome: boolean;
  sunTimes: { sunset: Date | null; sunrise: Date | null } | null;
  onChooseHome: () => void;
  onChooseAway: () => void;
}) {
  const { status, error, current, mode, needsChoice, isHome, sunTimes, onChooseHome, onChooseAway } = props;

  return (
    <section className="mt-6 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">Location</h2>

      {status === "locating" && <p className="mt-2">Finding your location…</p>}

      {status === "error" && <p className="mt-2 text-red-600">{error ?? "Location error."}</p>}

      {status === "ready" && current && (
        <>
          <p className="mt-2 text-sm">
            Current: <span className="font-mono">{current.lat.toFixed(6)}</span>,{" "}
            <span className="font-mono">{current.lng.toFixed(6)}</span>
          </p>

          {sunTimes && (
            <p className="mt-2 text-sm text-neutral-700">
              Sunset: <span className="font-mono">{sunTimes.sunset ? formatTime(sunTimes.sunset) : "—"}</span>
              {" • "}
              Sunrise: <span className="font-mono">{sunTimes.sunrise ? formatTime(sunTimes.sunrise) : "—"}</span>
            </p>
          )}

          {mode === "home" && (
            <p className="mt-2">
              Mode: <b>Home</b> (deck constraints active)
            </p>
          )}

          {needsChoice && (
            <>
              <p className="mt-2">
                You don’t appear to be at home. Are you shooting from home anyway, or from where you are now?
              </p>

              <div className="mt-3 flex gap-3">
                <button className="rounded-lg border px-3 py-2 hover:bg-neutral-50" onClick={onChooseHome}>
                  Use Home (deck view)
                </button>

                <button className="rounded-lg border px-3 py-2 hover:bg-neutral-50" onClick={onChooseAway}>
                  Use Current Location (full sky)
                </button>
              </div>
            </>
          )}

          {!needsChoice && mode === "away" && (
            <p className="mt-2">
              Mode: <b>Away</b> (full sky assumed)
            </p>
          )}

          <p className="mt-2 text-sm text-neutral-600">
            Home check: {isHome ? "within radius ✅" : "outside radius"}
          </p>
        </>
      )}
    </section>
  );
}

function AvailableTonightSection(props: {
  visibleObjects: VisibleObject[];
  current: LatLng | null;
  mode: Mode;
  status: Status;
  needsChoice: boolean;
  moon: { altitude: number; azimuth: number; illumination: number } | null;
}) {
  const { visibleObjects, current, mode, status, needsChoice, moon } = props;

  const canShowResults = status === "ready" && current && !needsChoice;

  // Build thumbnail requests (only when we can show results)
  const thumbItems = useMemo(() => {
    if (!canShowResults) return [];
    return visibleObjects.map(({ obj }) => ({
      id: String(obj.id),
      titles: buildWikiTitleCandidates({ id: String(obj.id), name: String(obj.name), messierId: obj.messierId }),
    }));
  }, [canShowResults, visibleObjects]);

  const thumbs = useWikiThumbnails(thumbItems);

  return (
    <section className="mt-6 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">Available Tonight</h2>

 
{/* Moon panel first (photo card style, clickable) */}
<Link
  href={`/moon?mode=${mode}&lat=${current?.lat ?? ""}&lng=${current?.lng ?? ""}`}
  className="mt-2 block rounded-lg border p-3 hover:bg-neutral-50"
>
  <div className="flex gap-3">
    {/* Thumbnail */}
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-neutral-50">
      {status === "ready" && moon ? (
  <img
    src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/128px-FullMoon2010.jpg"
    alt="Moon"
    className="h-full w-full object-cover"
    loading="lazy"
    referrerPolicy="no-referrer"
  />
) : (
  <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
    —
  </div>
)}
    </div>

    {/* Text */}
    <div className="flex-1 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold">
        <span className="truncate">Moon</span>
      </div>

      {status !== "ready" || !moon ? (
        <p className="mt-1 text-sm text-neutral-600">Waiting on location…</p>
      ) : (
        <>
          <div className="text-sm text-neutral-600">
            Illumination:{" "}
            <span className="font-mono">{Math.round(moon.illumination * 100)}%</span>
          </div>

          <div className="mt-1 text-xs text-neutral-500">
            Alt: <span className="font-mono">{moon.altitude.toFixed(1)}°</span> • Az:{" "}
            <span className="font-mono">{moon.azimuth.toFixed(1)}°</span>
          </div>
        </>
      )}
    </div>
  </div>
</Link>
      {!canShowResults && (
        <p className="mt-3 text-sm text-neutral-600">
          {status !== "ready" ? "Waiting on location…" : "Choose a shooting mode to see targets…"}
        </p>
      )}

      {canShowResults && visibleObjects.length === 0 && (
        <p className="mt-3 text-sm text-neutral-600">No realistic DWARF Mini targets meet your constraints tonight.</p>
      )}

      {canShowResults && (
        <div className="mt-3 grid gap-3">
          {visibleObjects.map(({ obj, window, suitability }) => {
            const img = thumbs[String(obj.id)];

            return (
              <Link
                key={obj.id}
                href={`/object/${obj.id}?mode=${mode}&lat=${current?.lat ?? ""}&lng=${current?.lng ?? ""}`}
                className="block w-full max-w-full overflow-hidden rounded-lg border p-3 hover:bg-neutral-50"
              >
                <div className="flex gap-3">
                  {/* Thumbnail */}
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-neutral-50">
                    {img?.src ? (
                      <img
                        src={img.src}
                        alt={`${obj.name} thumbnail`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">—</div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold">
                      <span className="truncate">{obj.name}</span>

                      {suitability === "great" && (
                        <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-xs">
                          Very Visible Tonight
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-neutral-600">
                      {obj.type} • {obj.constellation}
                    </div>

                    <div className="mt-1 text-xs text-neutral-500">
                      Visible: {formatTime(window.start)} – {formatTime(window.end)}
                      {" • "}Best: {formatTime(window.best)}
                      {" • "}Max alt: {Math.round(window.maxAlt)}°
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** --- Page --- */

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
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <h1 className="text-2xl font-bold">Shoot Tonight</h1>

      <p className="mt-1 text-sm text-neutral-600">
        Finds targets you can actually capture tonight — tailored to your deck when you’re home.
      </p>

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
    </main>
  );
}