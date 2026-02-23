"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { HOME } from "@/config/observing";
import { getMoonNow } from "@/lib/moon";

type Mode = "home" | "away" | "unknown";

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export default function MoonPage() {
  const mounted = useMounted();
  const searchParams = useSearchParams();

  const mode = (searchParams.get("mode") as Mode) ?? "unknown";
  const lat = Number(searchParams.get("lat") ?? HOME.lat);
  const lng = Number(searchParams.get("lng") ?? HOME.lng);

  const moon = useMemo(() => getMoonNow({ lat, lng }), [lat, lng]);
  const isAboveHorizon = moon.altitude > 0;

  // hydration-safe "as of" time display
  const asOf = mounted ? formatTime(new Date()) : "—";

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
          Alt: <span className="font-mono">{moon.altitude.toFixed(1)}°</span>
          {" • "}
          Az: <span className="font-mono">{moon.azimuth.toFixed(1)}°</span>
          {" • "}
          Illumination: <span className="font-mono">{Math.round(moon.illumination * 100)}%</span>
        </p>
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