import OpenAI from "openai";
import { NextResponse } from "next/server";

type AstroObjectLite = {
  id: string;
  name: string;
  type?: string;
  constellation?: string;
};

type MoodPick = {
  query: string; // "SONG ARTIST" for iTunes search
  song: string;
  artist: string;
  reason: string; // exactly 1 sentence, mention object name
};

async function pickWithOpenAI(
  obj: AstroObjectLite,
  wikiExtract: string | null
): Promise<MoodPick> {
  // Instantiate OpenAI INSIDE the function so the module can be imported during build
  // even if OPENAI_API_KEY isn't present yet.
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
- The recommendation must be specific to THIS object.
- If the extract includes a distinctive detail (nickname, galaxy type, age, size, distance, discoverer, structure), you MUST reference one of those details in the reason.
- If no extract exists, use constellation + object type creatively.
- Pick a real song likely on Apple Music.
- Do NOT choose generic "space ambient" unless it truly fits.
- Respond EXACTLY in this format:

SONG: <song title>
ARTIST: <artist name>
QUERY: <song title + artist>
REASON: <exactly one sentence that mentions ${obj.name} and one specific detail from the extract if available>
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

async function itunesSearch(query: string) {
  const url =
    "https://itunes.apple.com/search?" +
    new URLSearchParams({
      term: query,
      entity: "song",
      limit: "5",
    }).toString();

  const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } }); // cache 1 day
  if (!res.ok) return null;

  const data = (await res.json()) as any;
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;

  const t = results[0];

  return {
    artworkUrl: (t.artworkUrl100 ?? t.artworkUrl60 ?? null) as string | null,
    appleMusicUrl: (t.trackViewUrl ?? null) as string | null,
    resolvedTrackName: (t.trackName ?? null) as string | null,
    resolvedArtistName: (t.artistName ?? null) as string | null,
  };
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
    const itunes = await itunesSearch(pick.query);

    const webUrl = itunes?.appleMusicUrl ?? null;

    let appUrl: string | null = null;
    if (webUrl && webUrl.includes("music.apple.com")) {
      appUrl = webUrl.replace(/^https?:\/\//, "music://");
    }

    return NextResponse.json({
      song: pick.song,
      artist: pick.artist,
      reason: pick.reason,
      artworkUrl: itunes?.artworkUrl ?? null,
      appleMusicUrl: appUrl ?? webUrl,
      query: pick.query,
      resolvedTrackName: itunes?.resolvedTrackName ?? null,
      resolvedArtistName: itunes?.resolvedArtistName ?? null,
    });
  } catch (e: any) {
    console.error("mood-track error:", e);
    return NextResponse.json(
      { error: "Failed to generate mood track", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}