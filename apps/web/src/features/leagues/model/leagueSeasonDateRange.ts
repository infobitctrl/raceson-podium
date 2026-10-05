import { isValid, parseISO } from "date-fns";

type LeagueSeasonRoundDate = {
  roundNumber: number;
  dateIso?: string | null;
};

function formatMonthYear(
  dateIso: string | null | undefined,
  localeTag = "en-GB",
  fallbackLabel = "TBA",
) {
  if (!dateIso) return fallbackLabel;
  const parsed = parseISO(dateIso);
  return isValid(parsed)
    ? new Intl.DateTimeFormat(localeTag, { month: "short", year: "numeric" }).format(parsed)
    : fallbackLabel;
}

export function formatLeagueSeasonDateRange(
  startDateIso: string | null | undefined,
  endDateIso: string | null | undefined,
  localeTag = "en-GB",
  fallbackLabel = "TBA",
) {
  const separator = localeTag.toLowerCase().startsWith("hr") ? " – " : " - ";
  return `${formatMonthYear(startDateIso, localeTag, fallbackLabel)}${separator}${formatMonthYear(endDateIso, localeTag, fallbackLabel)}`;
}

export function buildLeagueSeasonDateRange(
  rounds: LeagueSeasonRoundDate[],
  plannedRoundCount?: number,
  localeTag = "en-GB",
  fallbackLabel = "TBA",
) {
  const lastRoundNumber = plannedRoundCount && plannedRoundCount > 0
    ? Math.floor(plannedRoundCount)
    : Math.max(0, ...rounds.map((round) => round.roundNumber));
  const startDateIso = rounds.find((round) => round.roundNumber === 1)?.dateIso;
  const endDateIso = lastRoundNumber > 0
    ? rounds.find((round) => round.roundNumber === lastRoundNumber)?.dateIso
    : null;

  return formatLeagueSeasonDateRange(startDateIso, endDateIso, localeTag, fallbackLabel);
}
