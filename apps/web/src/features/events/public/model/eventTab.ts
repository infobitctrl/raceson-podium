export const eventTabs = [
  "Info",
  "Race info",
  "Rules",
  "Gallery",
  "Registrations",
  "Live",
  "Results",
  "Statistics",
  "Community",
] as const;

export type EventTab = (typeof eventTabs)[number];

export function coerceEventTab(value: string | null): EventTab | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "info"
    || normalized === "overview"
  ) {
    return "Info";
  }
  if (normalized === "rules" || normalized === "regulations") return "Rules";
  if (normalized === "race-info" || normalized === "race info" || normalized === "races") return "Race info";
  if (normalized === "gallery" || normalized === "photos" || normalized === "media") return "Gallery";
  if (normalized === "registrations" || normalized === "registration") return "Registrations";
  if (
    normalized === "live"
    || normalized === "race-day"
    || normalized === "race_day"
    || normalized === "raceday"
  ) return "Live";
  if (normalized === "results") return "Results";
  if (normalized === "statistics" || normalized === "stats" || normalized === "insights") return "Statistics";
  if (normalized === "community") return "Community";
  return null;
}
