export const SIBENIK_TRAIL_LEAGUE_SLUG = "sibenska-trail-liga";
export const SIBENIK_TRAIL_LEAGUE_SOURCE_SLUG = "s-i-trail-liga";
export const SIBENIK_TRAIL_LEAGUE_LOCAL_NAME = "Šibenska Trail Liga";
export const SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME = "Šibenik Trail League";

export const SIBENIK_TRAIL_LEAGUE_SLUG_ALIASES = [
  SIBENIK_TRAIL_LEAGUE_SLUG,
  SIBENIK_TRAIL_LEAGUE_SOURCE_SLUG,
  "si-trail-liga",
] as const;

function normalizeLeagueIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isSibenikTrailLeagueIdentity(value: string | null | undefined) {
  const normalized = normalizeLeagueIdentity(value);
  return normalized === "sibenska trail liga"
    || normalized === "sibenik trail league"
    || normalized.startsWith("sibenska trail liga ")
    || normalized.startsWith("sibenik trail league ")
    || normalized === "s i trail liga"
    || normalized === "si trail liga"
    || normalized.startsWith("si trail liga ");
}

export function getSibenikTrailLeagueDisplayName(
  name: string,
  _slug?: string | null,
) {
  return isSibenikTrailLeagueIdentity(name)
    ? SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME
    : name;
}

export function getSibenikTrailLeagueLocalName(
  name: string,
  _slug?: string | null,
) {
  return isSibenikTrailLeagueIdentity(name)
    ? SIBENIK_TRAIL_LEAGUE_LOCAL_NAME
    : null;
}

export function getSibenikTrailLeagueEnglishCopy(
  copy: string,
  name: string,
  slug?: string | null,
) {
  if (!isSibenikTrailLeagueIdentity(slug) && !isSibenikTrailLeagueIdentity(name)) return copy;
  return copy.replace(
    /(?:Šibenska|Sibenska) Trail Liga|(?:Ši|Si) Trail Liga/giu,
    SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME,
  );
}
