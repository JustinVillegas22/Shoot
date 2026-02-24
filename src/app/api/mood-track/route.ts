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
Pick ONE song that fits the mood of photographing this specific deep-sky object tonight.

Object:
- Name: ${obj.name}
- Type: ${obj.type ?? "unknown"}
- Constellation: ${obj.constellation ?? "unknown"}

Wikipedia extract:
${wikiExtract ?? "(none)"}

Rules:
- Be specific to THIS object.
- Reference one real detail if possible.
- Pick a real song.
- Return valid JSON only that matches the schema.
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