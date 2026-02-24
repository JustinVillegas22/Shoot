import OpenAI from "openai";
import { NextResponse } from "next/server";

type AstroObjectLite = {
  id: string;
  name: string;
  type?: string;
  constellation?: string;
};

type MoodPick = {
  query: string; // "SONG ARTIST"
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
- The recommendation must be specific to THIS object.
- If the extract includes a distinctive detail (nickname, galaxy type, age, size, distance, discoverer, structure), you MUST reference one of those details in the reason.
- If no extract exists, use constellation + object type creatively.
- Pick a real song likely on YouTube.
- Do NOT choose generic "space ambient" unless it truly fits.
- Return JSON that matches the schema exactly.
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

function youtubeAppUrl(query: string) {
  return "vnd.youtube://results?search_query=" + encodeURIComponent(query);
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

    const ytWeb = youtubeUrl(pick.query);
    const ytApp = youtubeAppUrl(pick.query);

    return NextResponse.json({
      song: pick.song,
      artist: pick.artist,
      reason: pick.reason,
      query: pick.query,

      // new
      youtubeUrl: ytWeb,
      youtubeAppUrl: ytApp,

      // legacy fields kept (so nothing else breaks)
      artworkUrl: null,
      appleMusicUrl: null,
    });
  } catch (e: any) {
    console.error("mood-track error:", e);
    return NextResponse.json(
      { error: "Failed to generate mood track", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}