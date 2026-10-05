import type { PublicLeagueRoundItem } from "@/lib/league-read-models";
import { isSibenikTrailLeague } from "@/features/leagues/public/data/sibenikTrailLeague";
import type { AppLocale } from "@/shared/i18n/locales";

export function localizedLeagueName(
  name: string,
  slug: string,
  locale: AppLocale,
) {
  if (locale === "hr" && isSibenikTrailLeague(slug)) return "Šibenska Trail Liga";
  return name;
}

export function localizedLeagueLocation(value: string, locale: AppLocale) {
  if (locale !== "hr") return value;
  return value.replace(/\bCroatia\b/g, "Hrvatska");
}

function localizedLeagueDatePart(
  value: string,
  localeTag: string,
  tbaLabel: string,
  includeDay: boolean,
) {
  const normalized = value.trim();
  if (/^(?:TBA|Date TBA)$/i.test(normalized)) return tbaLabel;

  const parsed = includeDay
    ? normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/)
    : normalized.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!parsed) return normalized;

  const date = includeDay
    ? new Date(`${parsed[1]} ${parsed[2]}, ${parsed[3]} 00:00:00`)
    : new Date(`${parsed[1]} 1, ${parsed[2]} 00:00:00`);
  if (Number.isNaN(date.getTime())) return normalized;

  return new Intl.DateTimeFormat(localeTag, includeDay
    ? { day: "numeric", month: "short", year: "numeric" }
    : { month: "short", year: "numeric" }
  ).format(date);
}

export function localizedLeagueCatalogDateLabel(
  value: string,
  localeTag: string,
  tbaLabel: string,
) {
  return localizedLeagueDatePart(value, localeTag, tbaLabel, true);
}

export function localizedLeagueCatalogSeasonLabel(
  value: string,
  localeTag: string,
  tbaLabel: string,
) {
  const parts = value.split(/\s+(?:-|–)\s+/);
  if (parts.length !== 2) return value;
  const separator = localeTag.toLowerCase().startsWith("hr") ? " – " : " - ";
  return parts
    .map((part) => localizedLeagueDatePart(part, localeTag, tbaLabel, false))
    .join(separator);
}

export function localizedLeagueDataLabel(value: string, locale: AppLocale) {
  if (locale !== "hr") return value;

  const labels: Record<string, string> = {
    Overall: "Ukupno",
    Short: "Kratka ruta",
    Long: "Duga ruta",
    "Short route": "Kratka ruta",
    "Long route": "Duga ruta",
    "Short Route Cup": "Kup kratke rute",
    "Long Route Cup": "Kup duge rute",
    "Club Championship": "Klupsko prvenstvo",
    Male: "Muškarci",
    Female: "Žene",
    "Male U16": "Dječaci U16",
    "Female U16": "Djevojke U16",
    "Senior 65+": "Seniori 65+",
    "Under 18": "Do 18",
    "Broad age range": "Širok dobni raspon",
    "Not specified": "Nije navedeno",
    Medium: "Srednja",
    "Extra long": "Ekstra duga",
    Marathon: "Maraton",
    "Ultra marathon": "Ultramaraton",
    Independent: "Nezavisni",
  };

  const exact = labels[value];
  if (exact) return exact;

  const routes = value.match(/^(\d+) routes$/i);
  if (routes) return `${routes[1]} rute`;

  return value
    .replace(/^Race (\d+)/i, "Utrka $1")
    .replace(/^Round (\d+)/i, "Kolo $1")
    .replace(/(\d+) routes/gi, "$1 rute");
}

function roundDate(round: PublicLeagueRoundItem | undefined) {
  if (!round?.dateIso) return null;
  const parsed = new Date(`${round.dateIso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function localizedLeagueSeasonLabel(
  rounds: PublicLeagueRoundItem[],
  localeTag: string,
  tbaLabel: string,
) {
  const separator = localeTag.toLowerCase().startsWith("hr") ? " – " : " - ";
  if (!rounds.length) return `${tbaLabel}${separator}${tbaLabel}`;
  const sorted = [...rounds].sort((left, right) => left.roundNumber - right.roundNumber);
  const first = roundDate(sorted[0]);
  const last = roundDate(sorted.at(-1));
  const formatter = new Intl.DateTimeFormat(localeTag, {
    month: "short",
    year: "numeric",
  });
  const format = (date: Date | null) => date ? formatter.format(date) : tbaLabel;
  return `${format(first)}${separator}${format(last)}`;
}
