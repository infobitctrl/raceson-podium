export type LeagueRoundStatus =
  | "completed"
  | "in_progress"
  | "registration_open"
  | "registration_closed"
  | "upcoming";

const completedEventStatuses = new Set(["completed", "finished"]);

export function deriveLeagueRoundStatus(
  eventStatus: string | null | undefined,
  storedRoundStatus?: string | null,
  evidence: {
    startDate?: string | null;
    endDate?: string | null;
    timeZone?: string | null;
    hasPublishedResults?: boolean;
    now?: Date;
  } = {},
): LeagueRoundStatus {
  const normalizedEventStatus = (eventStatus ?? "").trim().toLowerCase();
  const normalizedRoundStatus = (storedRoundStatus ?? "").trim().toLowerCase();
  if (normalizedEventStatus === "in_progress") return "in_progress";
  if (
    evidence.hasPublishedResults
    || completedEventStatuses.has(normalizedEventStatus)
    || normalizedEventStatus.includes("finish")
  ) {
    return "completed";
  }
  if (normalizedEventStatus === "registration_open") return "registration_open";
  if (normalizedEventStatus === "registration_closed") {
    return normalizedRoundStatus === "completed" || normalizedRoundStatus.includes("finish")
      ? "completed"
      : "registration_closed";
  }

  const eventDefersToRoundStatus = !normalizedEventStatus || normalizedEventStatus === "archived";
  if (eventDefersToRoundStatus && (normalizedRoundStatus === "completed" || normalizedRoundStatus.includes("finish"))) {
    return "completed";
  }
  if (eventDefersToRoundStatus && normalizedRoundStatus === "in_progress") return "in_progress";
  if (eventDefersToRoundStatus && normalizedRoundStatus === "registration_open") return "registration_open";
  if (eventDefersToRoundStatus && normalizedRoundStatus === "registration_closed") return "registration_closed";
  return "upcoming";
}
