import OpenAI from "openai";
import { NextResponse } from "next/server";

type AstroObjectLite = {
  id: string;
  name: string;
  type?: string;
  constellation?: string;
};

type MoodPick = {
  query: string;
  song: string;
  artist: string;
  reason: string;
};

async function pickWithOpenAI(
  obj: AstroObjectLite,
  wikiExtract: string | null
): Promise<MoodPick> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string" },
      song: { type: "string" },
      artist: { type: "string" },
      reason: { type: "string" },
    },
    required: ["query", "song", "artist", "reason"],
  } as const;

  const prompt = `
You are a music supervisor for an astrophotography app. Pick ONE song that fits the mood of photographing THIS specific object tonight.

Object:
- Name: ${obj.name}
- Type: ${obj.type ?? "unknown"}
- Constellation: ${obj.constellation ?? "unknown"}

Wikipedia extract:
${wikiExtract ?? "(none)"}

Hard requirements:
- The recommendation MUST feel tailored to ${obj.name} (not generic “space song”).
- If the extract contains a distinctive detail (nickname, structure, age, distance, discoverer, galaxy type, notable feature), you MUST reference one in the reason.
- The reason MUST be exactly one sentence, vivid, and mention "${obj.name}".
- Pick a real song that is likely to exist (any era/genre is OK).

Creativity + anti-cliché rules:
- Avoid the obvious “space staples” unless they are uniquely perfect. Do NOT pick any of these:
  - Space Oddity (David Bowie)
  - Rocket Man (Elton John)
  - Starman (David Bowie)
  - Fly Me to the Moon (Sinatra)
  - Man on the Moon (R.E.M.)
  - Across the Universe (The Beatles)
- Prefer one of these angles (choose ONE and commit):
  1) sound/texture (bright, hazy, chaotic, crystalline, ominous)
  2) structure/metaphor (rings, whirlpool, cluster, shadow, collision)
  3) place/era (constellation myth vibe, retro sci-fi, swampy Louisiana night drive, etc.)
  4) unexpected genre match (punk, doom, zydeco, gospel, ambient, metal, reggaeton—anything)
- Aim for “delightfully weird but defensible.” Deep cuts are welcome.

Output JSON that matches the schema exactly.
`;

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "mood_pick",
        strict: true,
        schema,
      },
    },
  });

  return JSON.parse(resp.output_text) as MoodPick;
}

function youtubeUrl(query: string) {
  return (
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(query)
  );
}

// iTunes Search API used ONLY to get artwork (free, no key)
async function itunesArtwork(query: string) {
  const url =
    "https://itunes.apple.com/search?" +
    new URLSearchParams({
      term: query,
      entity: "song",
      limit: "1",
    }).toString();

  const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } }); // cache 1 day
  if (!res.ok) return { artworkUrl: null as string | null };

  const data = (await res.json()) as any;
  const t = Array.isArray(data?.results) ? data.results[0] : null;
  if (!t) return { artworkUrl: null as string | null };

  // bump to bigger art if possible
  const art =
    (t.artworkUrl100 ?? t.artworkUrl60 ?? null) as string | null;

  const artworkUrl = art
    ? art.replace("100x100bb", "300x300bb")
    : null;

  return { artworkUrl };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as {
      obj?: AstroObjectLite;
      context?: { wikiExtract?: string | null };
    };

    const obj = body?.obj;
    if (!obj?.id || !obj?.name) {
      return NextResponse.json({ error: "Missing obj" }, { status: 400 });
    }

    const pick = await pickWithOpenAI(obj, body.context?.wikiExtract ?? null);

    // Always build our own search query for links
    const ytQuery = `${pick.song} ${pick.artist}`.trim();

    // Artwork lookup (best-effort)
    const art = await itunesArtwork(ytQuery);

    return NextResponse.json({
      song: pick.song,
      artist: pick.artist,
      reason: pick.reason,

      // YouTube is the destination
      query: ytQuery,
      youtubeUrl: youtubeUrl(ytQuery),

      // Artwork is back
      artworkUrl: art.artworkUrl,
    });
  } catch (e: any) {
    console.error("mood-track error:", e);
    return NextResponse.json(
      { error: "Failed to generate mood track", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}