"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Mode = "home" | "away" | "unknown";

type MoonNow = {
  altitude: number;
  azimuth: number;
  illumination: number; // 0..1
};

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

// Fallback coords if nothing is provided in the URL.
// (Use whatever default you want; these are New Orleans-ish.)
const FALLBACK_LAT = 29.9729;
const FALLBACK_LNG = -90.0857;

export default function MoonPage() {
  const mounted = useMounted();

  const [mode, setMode] = useState<Mode>("unknown");
  const [lat, setLat] = useState<number>(FALLBACK_LAT);
  const [lng, setLng] = useState<number>(FALLBACK_LNG);

  const [moon, setMoon] = useState<MoonNow | null>(null);
  const [moonErr, setMoonErr] = useState<string | null>(null);

  // Read URL params ONLY in the browser
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);

      const nextMode = (params.get("mode") as Mode) ?? "unknown";
      const nextLatRaw = params.get("lat");
      const nextLngRaw = params.get("lng");

      const nextLat = Number(nextLatRaw ?? FALLBACK_LAT);
      const nextLng = Number(nextLngRaw ?? FALLBACK_LNG);

      setMode(nextMode);
      setLat(Number.isFinite(nextLat) ? nextLat : FALLBACK_LAT);
      setLng(Number.isFinite(nextLng) ? nextLng : FALLBACK_LNG);
    } catch {
      // If parsing fails, keep defaults
    }
  }, []);

  // Load moon logic ONLY in the browser
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mod = await import("@/lib/moon");
        const nextMoon = mod.getMoonNow({ lat, lng }) as MoonNow;

        if (!cancelled) {
          setMoon(nextMoon);
          setMoonErr(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMoon(null);
          setMoonErr(String(e?.message ?? e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  const isAboveHorizon = (moon?.altitude ?? -999) > 0;
  const asOf = mounted ? formatTime(new Date()) : "—";

  const altText = useMemo(() => (moon ? `${moon.altitude.toFixed(1)}°` : "—"), [moon]);
  const azText = useMemo(() => (moon ? `${moon.azimuth.toFixed(1)}°` : "—"), [moon]);
  const illumText = useMemo(() => (moon ? `${Math.round(moon.illumination * 100)}%` : "—"), [moon]);

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-bold">Moon</h1>
      <p className="text-sm text-neutral-600">Earth’s Moon</p>

      <p className="mt-2 text-xs text-neutral-500">
        Mode: {mode} • Location: {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>

      {/* Image */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">Image</h2>

        <div className="mt-3 overflow-hidden rounded-lg border bg-neutral-50">
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/640px-FullMoon2010.jpg"
            alt="Moon (Wikimedia Commons)"
            className="h-auto w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          Source:{" "}
          <a
            className="underline"
            href="https://commons.wikimedia.org/wiki/File:FullMoon2010.jpg"
            target="_blank"
            rel="noreferrer"
          >
            Wikimedia Commons
          </a>
        </p>
      </section>

      {/* Tonight */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">Tonight</h2>

        {moonErr ? (
          <p className="mt-2 text-sm text-red-700">
            Couldn’t load moon data: <span className="font-mono">{moonErr}</span>
          </p>
        ) : !moon ? (
          <p className="mt-2 text-sm text-neutral-600">Loading moon position…</p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              Status:{" "}
              {isAboveHorizon ? (
                <span className="font-semibold text-green-700">Above horizon</span>
              ) : (
                <span className="font-semibold text-neutral-500">Below horizon</span>
              )}
            </p>

            <p className="mt-2 text-sm text-neutral-700">
              As of {asOf}
              {" • "}
              Alt: <span className="font-mono">{altText}</span>
              {" • "}
              Az: <span className="font-mono">{azText}</span>
              {" • "}
              Illumination: <span className="font-mono">{illumText}</span>
            </p>
          </>
        )}
      </section>

      {/* About */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">About</h2>

        <p className="mt-2 text-sm text-neutral-700">
          The Moon is Earth’s only natural satellite and the brightest object in the night sky. It has been observed
          since prehistory, but early telescopic observers like Galileo (1609) were the first to document surface
          features in detail. For imaging, the Moon is a high-contrast target—great for quick sessions, but it can also
          wash out faint deep-sky objects when it’s bright or nearby.
        </p>

        <p className="mt-2 text-xs text-neutral-500">
          If you want the Wikipedia version later, we can pull the first paragraph from the “Moon” page just like the
          object pages.
        </p>
      </section>
    </main>
  );
}