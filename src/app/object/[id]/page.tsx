"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getObjectById } from "@/data/objects";
import { HOME, DECK } from "@/config/observing";
import { getVisibilityTonight } from "@/lib/visibility";

type Mode = "home" | "away" | "unknown";

type MoodTrack = {
  song: string;
  artist: string;
  reason: string;
  artworkUrl?: string | null;
  youtubeUrl?: string | null;
};

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

  const messierMatch = idRaw.match(/^M(\d+)$/i) || name.match(/^M(\d+)$/i);
  if (messierMatch) titles.push(`Messier ${messierMatch[1]}`);

  const ngcMatch =
    idRaw.match(/^(NGC|IC)\s?(\d+)$/i) || name.match(/^(NGC|IC)\s?(\d+)$/i);
  if (ngcMatch) titles.push(`${ngcMatch[1].toUpperCase()} ${ngcMatch[2]}`);

  if (name && !/^(NGC|IC|M)\s?\d+/i.test(name)) titles.push(name);

  if (ngcMatch)
    titles.push(`${ngcMatch[1].toUpperCase()} ${ngcMatch[2]} galaxy`);

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

  const windowVis = useMemo(() => {
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
  const [wikiStatus, setWikiStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  const [mood, setMood] = useState<MoodTrack | null>(null);
  const [moodStatus, setMoodStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!obj) return;

      setMoodStatus("loading");
      setMood(null);

      try {
        const cacheKey = `shootTonight.moodTrack.v4.${obj.id}`;
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as MoodTrack;
          if (!cancelled) {
            setMood(cached);
            setMoodStatus("ready");
          }
          return;
        }

        const res = await fetch("/api/mood-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            obj: {
              id: obj.id,
              name: obj.name,
              type: obj.type,
              constellation: obj.constellation,
            },
            context: {
              wikiExtract: wiki?.extract ?? null,
            },
          }),
        });

        if (!res.ok) throw new Error("mood failed");

        const data = (await res.json()) as MoodTrack;

        localStorage.setItem(cacheKey, JSON.stringify(data));

        if (!cancelled) {
          setMood(data);
          setMoodStatus("ready");
        }
      } catch {
        if (!cancelled) setMoodStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [obj?.id, wiki?.extract]);

  const card =
    "rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur";
  const sectionTitle = "text-sm font-semibold tracking-wide text-white/90";
  const helper = "mt-2 text-sm text-white/70";
  const subtle = "text-xs text-white/50";

  if (!obj) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-neutral-900">
        <div className="mx-auto max-w-3xl p-6 font-sans text-white">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
          >
            <span aria-hidden>←</span> Back
          </Link>
          <p className="mt-6 text-white/70">Object not found.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-neutral-900">
      <div className="mx-auto max-w-3xl p-6 font-sans text-white">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
          >
            <span aria-hidden>←</span> Back
          </Link>

          <div className="text-right">
            <div className={subtle}>
              Mode: <span className="text-white/70">{mode}</span>
            </div>
            <div className={subtle}>
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="mt-6">
          <h1 className="text-3xl font-semibold tracking-tight">{obj.name}</h1>
          <p className="mt-1 text-sm text-white/70">
            {obj.type} <span className="text-white/30">•</span>{" "}
            {obj.constellation} <span className="text-white/30">•</span> {obj.id}
          </p>
        </header>

        {/* Image */}
        <section className={`mt-6 ${card}`}>
          <div className="flex items-center justify-between">
            <h2 className={sectionTitle}>Image</h2>
            {wikiStatus === "ready" && wiki?.matchedTitle ? (
              <span className={subtle}>Matched: {wiki.matchedTitle}</span>
            ) : null}
          </div>

          {wikiStatus === "loading" && <p className={helper}>Loading image…</p>}

          {wikiStatus === "error" && (
            <p className={helper}>Couldn’t load an image right now.</p>
          )}

          {wikiStatus === "ready" && wiki?.imageSrc ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
              <img
                src={wiki.imageSrc}
                alt={`${obj.name} (Wikipedia image)`}
                className="h-auto w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : wikiStatus === "ready" ? (
            <p className={helper}>No image available.</p>
          ) : null}

          {wikiStatus === "ready" && wiki?.pageUrl ? (
            <p className="mt-3 text-xs text-white/50">
              Source:{" "}
              <a
                className="underline decoration-white/30 underline-offset-4 hover:decoration-white/70"
                href={wiki.pageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Wikipedia
              </a>
            </p>
          ) : null}
        </section>

        {/* Tonight */}
        <section className={`mt-4 ${card}`}>
          <h2 className={sectionTitle}>Tonight</h2>

          {!windowVis ? (
            <p className={helper}>Not visible tonight.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className={subtle}>Visible</div>
                <div className="mt-1 text-sm">
                  {mounted ? formatTime(windowVis.start) : "—"} –{" "}
                  {mounted ? formatTime(windowVis.end) : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className={subtle}>Best</div>
                <div className="mt-1 text-sm">
                  {mounted ? formatTime(windowVis.best) : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className={subtle}>Max alt</div>
                <div className="mt-1 text-sm">{Math.round(windowVis.maxAlt)}°</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className={subtle}>Notes</div>
                <div className="mt-1 text-sm text-white/70">
                  {mode === "home" ? "Deck limits on" : "Deck limits off"}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Mood Track */}
        <section className={`mt-4 ${card}`}>
          <div className="flex items-center justify-between">
            <h2 className={sectionTitle}>Mood Track</h2>
            {moodStatus === "ready" && mood?.youtubeUrl ? (
              <a
                href={mood.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/70 underline decoration-white/30 underline-offset-4 hover:text-white"
              >
                Open on YouTube
              </a>
            ) : null}
          </div>

          {moodStatus === "loading" && (
            <p className={helper}>Finding your vibe…</p>
          )}
          {moodStatus === "error" && (
            <p className={helper}>Couldn’t load a mood track.</p>
          )}

          {moodStatus === "ready" && mood ? (
            <div className="mt-4 flex gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {mood.artworkUrl ? (
                  <img
                    src={mood.artworkUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {mood.song}
                </div>
                <div className="truncate text-sm text-white/70">
                  {mood.artist}
                </div>
                <p className="mt-2 text-sm text-white/75">{mood.reason}</p>
              </div>
            </div>
          ) : null}
        </section>

        {/* About */}
        <section className={`mt-4 ${card}`}>
          <h2 className={sectionTitle}>About</h2>

          {wikiStatus === "loading" && (
            <p className={helper}>Loading background…</p>
          )}

          {wikiStatus === "error" && (
            <p className={helper}>
              Couldn’t load Wikipedia background right now.
            </p>
          )}

          {wikiStatus === "ready" && wiki?.extract ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-white/75">
                {wiki.extract}
              </p>
              {wiki.pageUrl ? (
                <p className="mt-3 text-xs text-white/50">
                  Read more on{" "}
                  <a
                    className="underline decoration-white/30 underline-offset-4 hover:decoration-white/70"
                    href={wiki.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Wikipedia
                  </a>
                  .
                </p>
              ) : null}
            </>
          ) : wikiStatus === "ready" ? (
            <p className={helper}>No background available.</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}