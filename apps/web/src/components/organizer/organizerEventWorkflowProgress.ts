export type OrganizerEventWorkflowGroup =
  | "overview"
  | "setup"
  | "courses"
  | "registrations"
  | "race-day"
  | "temporary-results"
  | "official-results"
  | "finished";

export function resolveOrganizerEventWorkflowProgress({
  eventStatus,
  finalResultCount = 0,
  provisionalResultCount = 0,
  closedWithoutResultsCount = 0,
  raceCount = 0,
}: {
  eventStatus: string;
  finalResultCount?: number;
  provisionalResultCount?: number;
  closedWithoutResultsCount?: number;
  raceCount?: number;
}): OrganizerEventWorkflowGroup {
  if (eventStatus === "completed" || eventStatus === "archived") {
    if (raceCount > 0 && finalResultCount + closedWithoutResultsCount === raceCount) return "finished";
    if (finalResultCount > 0 || provisionalResultCount > 0) return "official-results";
    return "temporary-results";
  }
  if (eventStatus === "in_progress" || eventStatus === "registration_closed") {
    return "race-day";
  }
  if (["published", "registration_open"].includes(eventStatus)) {
    if (raceCount === 0) return "courses";
    return "registrations";
  }
  if (eventStatus === "draft") return "setup";
  return "overview";
}
