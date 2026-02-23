"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getObjectById } from "@/data/objects";
import { HOME, DECK } from "@/config/observing";
import { getVisibilityTonight } from "@/lib/visibility";

type Mode = "home" | "away" | "unknown";

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function buildWikiTitleCandidates(obj: { id: string; name: string }) {
  const idRaw = String(obj.id ?? "").trim();
  const name = String(obj.name ?? "").trim();

  const titles: string[] = [];

  // 1) Prefer Messier format
  const messierMatch = idRaw.match(/^M(\d+)$/i) || name.match(/^M(\d+)$/i);
  if (messierMatch) titles.push(`Messier ${messierMatch[1]}`);

  // 2) Prefer full NGC / IC pages
  const ngcMatch =
    idRaw.match(/^(NGC|IC)\s?(\d+)$/i) || name.match(/^(NGC|IC)\s?(\d+)$/i);
  if (ngcMatch) titles.push(`${ngcMatch[1].toUpperCase()} ${ngcMatch[2]}`);

  // 3) Try common name
  if (name && !/^(NGC|IC|M)\s?\d+/i.test(name)) titles.push(name);

  // 4) NGC + galaxy disambiguation
  if (ngcMatch) titles.push(`${ngcMatch[1].toUpperCase()} ${ngcMatch[2]} galaxy`);

  // 5) LAST RESORT: raw id (avoid Caldwell alone)
  if (idRaw && !/^C\d+$/i.test(idRaw)) titles.push(idRaw);

  return Array.from(new Set(titles));
}

type WikiObjectInfo = {
  extract: string | null;
  pageUrl: string | null;
  imageSrc: string | null;
  thumbSrc: string | null;
  matchedTitle: string | null;
};

export default function ObjectPage() {
  const mounted = useMounted();

  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const id = params?.id;
  const obj = id ? getObjectById(id) : undefined;

  const mode = (searchParams.get("mode") as Mode) ?? "unknown";
  const lat = Number(searchParams.get("lat") ?? HOME.lat);
  const lng = Number(searchParams.get("lng") ?? HOME.lng);

  const useDeck = mode === "home";

  const window = useMemo(() => {
    if (!obj) return null;

    return getVisibilityTonight(
      obj,
      { lat, lng },
      DECK.minAltitude,
      useDeck ? DECK.azimuthStart : undefined,
      useDeck ? DECK.azimuthEnd : undefined
    );
  }, [obj, lat, lng, useDeck]);

  const [wiki, setWiki] = useState<WikiObjectInfo | null>(null);
  const [wikiStatus, setWikiStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!obj) return;

      setWikiStatus("loading");
      setWiki(null);

      try {
        const titles = buildWikiTitleCandidates({
          id: String(obj.id),
          name: String(obj.name),
        });

        const res = await fetch("/api/wiki-object", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titles }),
        });

        if (!res.ok) throw new Error("Wiki fetch failed");

        const data = (await res.json()) as WikiObjectInfo;

        if (cancelled) return;
        setWiki(data);
        setWikiStatus("ready");
      } catch {
        if (cancelled) return;
        setWikiStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [obj?.id]);

  if (!obj) {
    return (
      <main className="mx-auto max-w-3xl p-6 font-sans">
        <Link href="/" className="text-sm underline">
          ← Back
        </Link>
        <p className="mt-4">Object not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{obj.name}</h1>
      <p className="text-sm text-neutral-600">
        {obj.type} • {obj.constellation} • {obj.id}
      </p>

      <p className="mt-2 text-xs text-neutral-500">
        Mode: {mode} • Location: {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>

      {/* Image */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">Image</h2>

        {wikiStatus === "loading" && <p className="mt-2 text-sm text-neutral-600">Loading image…</p>}

        {wikiStatus === "error" && (
          <p className="mt-2 text-sm text-neutral-600">Couldn’t load an image right now.</p>
        )}

        {wikiStatus === "ready" && wiki?.imageSrc ? (
          <div className="mt-3 overflow-hidden rounded-lg border bg-neutral-50">
            <img
              src={wiki.imageSrc}
              alt={`${obj.name} (Wikipedia image)`}
              className="h-auto w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : wikiStatus === "ready" ? (
          <p className="mt-2 text-sm text-neutral-600">No image available.</p>
        ) : null}

        {wikiStatus === "ready" && wiki?.pageUrl ? (
          <p className="mt-2 text-xs text-neutral-500">
            Source:{" "}
            <a className="underline" href={wiki.pageUrl} target="_blank" rel="noreferrer">
              Wikipedia
            </a>
          </p>
        ) : null}
      </section>

      {/* Tonight */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">Tonight</h2>

        {!window ? (
          <p className="text-sm">Not visible tonight.</p>
        ) : (
          <p className="text-sm">
            Visible: {mounted ? formatTime(window.start) : "—"} – {mounted ? formatTime(window.end) : "—"}
            {" • "}
            Best: {mounted ? formatTime(window.best) : "—"}
            {" • "}
            Max alt: {Math.round(window.maxAlt)}°
          </p>
        )}
      </section>

      {/* About */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="font-semibold">About</h2>

        {wikiStatus === "loading" && <p className="mt-2 text-sm text-neutral-600">Loading background…</p>}

        {wikiStatus === "error" && (
          <p className="mt-2 text-sm text-neutral-600">Couldn’t load Wikipedia background right now.</p>
        )}

        {wikiStatus === "ready" && wiki?.extract ? (
          <>
            <p className="mt-2 text-sm text-neutral-700">{wiki.extract}</p>
            {wiki.pageUrl ? (
              <p className="mt-2 text-xs text-neutral-500">
                Read more on{" "}
                <a className="underline" href={wiki.pageUrl} target="_blank" rel="noreferrer">
                  Wikipedia
                </a>
                .
              </p>
            ) : null}
          </>
        ) : wikiStatus === "ready" ? (
          <p className="mt-2 text-sm text-neutral-600">No background available.</p>
        ) : null}
      </section>
    </main>
  );
}