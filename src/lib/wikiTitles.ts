export function buildWikiTitleCandidates(obj: { id: string; name: string; messierId?: string }) {
  const idRaw = String(obj.id ?? "").trim();
  const name = String(obj.name ?? "").trim();
  const mRaw = String(obj.messierId ?? "").trim();

  const titles: string[] = [];

  // Prefer Messier page first if available (fixes NGC3992/M109)
  const mMatch = mRaw.match(/^M(\d+)$/i);
  if (mMatch) titles.push(`Messier ${mMatch[1]}`);

  // Also infer Messier from id/name if needed
  const m2 = idRaw.match(/^M(\d+)$/i) || name.match(/^M(\d+)$/i);
  if (m2) titles.push(`Messier ${m2[1]}`);

  // NGC/IC canonical
  const ngc =
    idRaw.match(/^(NGC|IC)\s?(\d+)$/i) || name.match(/^(NGC|IC)\s?(\d+)$/i);
  if (ngc) titles.push(`${ngc[1].toUpperCase()} ${ngc[2]}`);

  // Common name
  if (name) titles.push(name);

  // Raw id (avoid Caldwell-only)
  if (idRaw && !/^C\d+$/i.test(idRaw)) titles.push(idRaw);

  return Array.from(new Set(titles));
}
