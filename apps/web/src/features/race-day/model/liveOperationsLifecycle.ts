import type { OrganizerManagedEvent } from "@/lib/organizer-management";
import { eventResultsAreFinal, selectFieldOperationsEvents } from "./fieldOperationsEvents";

type EventLifecycle = {
  status?: string;
  categories?: Array<{ status?: string; categoryType?: string }>;
};

const CLOSED_EVENT_STATUSES = new Set(["completed", "archived", "cancelled", "canceled"]);
const CLOSED_RACE_STATUSES = new Set(["completed", "closed", "cancelled", "canceled"]);

// Finishing timing and publishing final results are separate workflow stages.
// A result-editing unlock must never reopen live race operations.
export function eventLiveOperationsAreClosed(event: EventLifecycle) {
  if (CLOSED_EVENT_STATUSES.has(event.status ?? "")) return true;
  const races = (event.categories ?? []).filter((race) => race.categoryType !== "informative_age");
  return races.length > 0 && races.every((race) => CLOSED_RACE_STATUSES.has(race.status ?? ""));
}

export function selectLiveRaceOperationsEvents(events: OrganizerManagedEvent[], now = new Date()) {
  return selectFieldOperationsEvents(events, null, false, now)
    .filter((event) => !eventLiveOperationsAreClosed(event) && !eventResultsAreFinal(event));
}
