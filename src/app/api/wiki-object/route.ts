import { NextResponse } from "next/server";

type ReqBody = {
  titles: string[];
};

type WikiPayload = {
  extract: string | null;
  pageUrl: string | null;
  imageSrc: string | null;
  thumbSrc: string | null;
  matchedTitle: string | null;
};

function toLargeImageUrl(url: string | null): string | null {
  if (!url) return null;

  // If it's already not a thumb URL, just return as-is.
  if (!url.includes("/thumb/")) return url;

  // Wikimedia thumbs typically end with ".../<WIDTH>px-Filename.ext"
  // Bump to a nicer hero size for detail pages.
  return url.replace(/\/(\d+)px-([^/]+)$/, "/640px-$2");
}

async function fetchSummary(title: string): Promise<any | null> {
  const u = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  const res = await fetch(u, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ShootTonight/1.0 (personal project)",
    },
    next: { revalidate: 60 * 60 * 24 }, // 24 hours
  });

  if (!res.ok) return null;
  return res.json();
}

export async function POST(req: Request) {
  let body: ReqBody;

  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const titles = Array.isArray(body.titles) ? body.titles.filter(Boolean) : [];

  if (!titles.length) {
    const empty: WikiPayload = {
      extract: null,
      pageUrl: null,
      imageSrc: null,
      thumbSrc: null,
      matchedTitle: null,
    };
    return NextResponse.json(empty);
  }

  for (const title of titles) {
    const data = await fetchSummary(title);
    if (!data) continue;

    const extract: string | null = typeof data.extract === "string" ? data.extract : null;

    const pageUrl: string | null =
      data?.content_urls?.desktop?.page && typeof data.content_urls.desktop.page === "string"
        ? data.content_urls.desktop.page
        : null;

    // Prefer originalimage if present, else thumbnail
    const originalSrc: string | null =
      data?.originalimage?.source && typeof data.originalimage.source === "string" ? data.originalimage.source : null;

    const thumbSrc: string | null =
      data?.thumbnail?.source && typeof data.thumbnail.source === "string" ? data.thumbnail.source : null;

    const imageSrc = toLargeImageUrl(originalSrc ?? thumbSrc);

    const payload: WikiPayload = {
      extract,
      pageUrl,
      imageSrc,
      thumbSrc,
      matchedTitle: title,
    };

    return NextResponse.json(payload);
  }

  const none: WikiPayload = {
    extract: null,
    pageUrl: null,
    imageSrc: null,
    thumbSrc: null,
    matchedTitle: null,
  };

  return NextResponse.json(none);
}