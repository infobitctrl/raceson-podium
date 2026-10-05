type EventCompletionEvidence = {
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  hasPublishedResults?: boolean;
  timeZone?: string | null;
};

/** Completion evidence shared by public catalogs and organizer operations. */
export function eventHasFinished(input: EventCompletionEvidence, _now = new Date()) {
  const status = (input.status ?? "").trim().toLowerCase();
  if (status === "in_progress" || status === "live") return false;
  if (
    input.hasPublishedResults
    || status.includes("complete")
    || status.includes("result")
    || status.includes("finish")
    || status === "archived"
  ) {
    return true;
  }
  // Dates describe the schedule, not an organizer's decision to finish a race.
  return false;
}
