import { NextResponse } from "next/server";

type ReqBody = {
  items: { id: string; titles: string[] }[];
};

const WIKI_API = "https://en.wikipedia.org/w/api.php";

function apiUrl(params: Record<string, string>) {
  const qs = new URLSearchParams({
    format: "json",
    origin: "*",
    ...params,
  });
  return `${WIKI_API}?${qs.toString()}`;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ShootTonight (local dev)",
      Accept: "application/json",
    },
    next: { revalidate: 60 * 60 * 24 }, // 24h
  });

  if (!res.ok) return null;
  return (await res.json()) as any;
}

function buildPageUrl(pageid: number | null) {
  return pageid ? `https://en.wikipedia.org/?curid=${pageid}` : null;
}

/**
 * Score an image filename for relevance.
 * Higher score = more likely to be a good astro photo of the object.
 * We return null if score is too low (better no image than wrong image).
 */
function scoreImage(fileTitle: string, candidates: string[]) {
  const t = fileTitle.toLowerCase();

  // Hard rejects
  if (!t.startsWith("file:")) return -999;
  if (t.endsWith(".svg")) return -999;

  const banned = [
    "commons-logo",
    "wikimedia",
    "question_book",
    "nuvola",
    "icon",
    "logo",
    "symbol",
    "flag",
  ];
  if (banned.some((w) => t.includes(w))) return -999;

  // File extensions we’ll accept
  const okExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff"];
  if (!okExt.some((e) => t.endsWith(e))) return -999;

  let score = 0;

  // Penalize likely-non-photo imagery
  const badWords = ["map", "diagram", "chart", "scheme", "constellation", "finder", "location"];
  for (const w of badWords) if (t.includes(w)) score -= 40;

  // Boost if filename contains candidate tokens
  for (const cand of candidates) {
    const raw = cand.toLowerCase().trim();
    if (!raw) continue;

    const compact = raw.replace(/\s+/g, ""); // "ngc4631"
    if (t.includes(compact)) score += 90;

    // common pattern in file names: "ngc_4631"
    const m = cand.toUpperCase().match(/^(NGC|IC)\s?(\d+)$/);
    if (m) {
      const underscored = `${m[1].toLowerCase()}_${m[2]}`;
      if (t.includes(underscored)) score += 90;
      const spaced = `${m[1].toLowerCase()} ${m[2]}`;
      if (t.includes(spaced)) score += 50;
    }

    // direct contains check
    if (t.includes(raw)) score += 40;
  }

  // Slight boost for astro-photo words
  const goodWords = ["galaxy", "nebula", "cluster", "spiral", "dust", "star"];
  for (const w of goodWords) if (t.includes(w)) score += 8;

  return score;
}

async function getPageThumb(title: string) {
  const data = await fetchJson(
    apiUrl({
      action: "query",
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "240",
      titles: title,
    })
  );

  const pages = data?.query?.pages;
  if (!pages) return null;

  const page: any = Object.values(pages)[0];
  const src: string | null = page?.thumbnail?.source ?? null;
  const pageid: number | null = page?.pageid ?? null;

  if (!src) return null;
  return { src, pageUrl: buildPageUrl(pageid), pageid };
}

async function getPageImagesList(title: string) {
  const data = await fetchJson(
    apiUrl({
      action: "query",
      redirects: "1",
      prop: "images",
      imlimit: "max",
      titles: title,
    })
  );

  const pages = data?.query?.pages;
  if (!pages) return null;

  const page: any = Object.values(pages)[0];
  const pageid: number | null = page?.pageid ?? null;
  const images: any[] = page?.images ?? [];

  return { pageid, images };
}

async function getThumbForFile(fileTitle: string) {
  const data = await fetchJson(
    apiUrl({
      action: "query",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "240",
      titles: fileTitle,
    })
  );

  const pages = data?.query?.pages;
  if (!pages) return null;

  const filePage: any = Object.values(pages)[0];
  const info = filePage?.imageinfo?.[0];

  const src: string | null = info?.thumburl ?? info?.url ?? null;
  if (!src) return null;

  return src;
}

/**
 * 1) Try page thumbnail
 * 2) Fallback: choose best image from page's image list (scored)
 * 3) Return null if we can't find a confident match
 */
async function fetchThumbForTitle(title: string, candidates: string[]) {
  // 1) page thumb
  const thumb = await getPageThumb(title);
  if (thumb) return { src: thumb.src, pageUrl: thumb.pageUrl };

  // 2) fallback to best image on page
  const list = await getPageImagesList(title);
  if (!list) return null;

  const { pageid, images } = list;
  if (!images.length) return null;

  const fileTitles = images
    .map((x) => String(x?.title ?? ""))
    .filter((t) => t.toLowerCase().startsWith("file:"));

  let bestFile: string | null = null;
  let bestScore = -999;

  for (const ft of fileTitles) {
    const s = scoreImage(ft, candidates);
    if (s > bestScore) {
      bestScore = s;
      bestFile = ft;
    }
  }

  // Confidence threshold: wrong image is worse than none
  if (!bestFile || bestScore < 25) return null;

  const src = await getThumbForFile(bestFile);
  if (!src) return null;

  return { src, pageUrl: buildPageUrl(pageid) };
}

export async function POST(req: Request) {
  console.log("[wiki-thumb] called");

  const body = (await req.json()) as ReqBody;
  console.log("[wiki-thumb] body sample:", body?.items?.[0]);

  const results: Record<string, { src: string | null; pageUrl: string | null }> = {};

  await Promise.all(
    (body.items ?? []).map(async (it) => {
      const id = String(it.id);
      const titles = (it.titles ?? []).map((t) => String(t).trim()).filter(Boolean);

      try {
        let found: { src: string; pageUrl: string | null } | null = null;

        // pass the full candidate list into the scorer
        for (const t of titles) {
          found = await fetchThumbForTitle(t, titles);
          if (found) break;
        }

        results[id] = found ? found : { src: null, pageUrl: null };
      } catch {
        results[id] = { src: null, pageUrl: null };
      }
    })
  );

  return NextResponse.json(results);
}