import type {
  EventCardStatus,
  PublicResultsDirectoryEvent,
  PublicResultsDirectoryRaceStatus,
} from "@/lib/portal-read-models";

export type ResultsDirectoryEventKind =
  | "upcoming"
  | "live"
  | "today"
  | "pending"
  | "closed"
  | "finished";

export type FinishedResultsDirectoryEventKind = "finished" | "pending" | "closed";
export type FinishedResultsDirectoryEvent = PublicResultsDirectoryEvent & {
  resultsKind: FinishedResultsDirectoryEventKind;
};

export function isFinishedResultsDirectoryEventKind(
  kind: ResultsDirectoryEventKind,
): kind is FinishedResultsDirectoryEventKind {
  return kind === "finished" || kind === "pending" || kind === "closed";
}

function isSameCalendarDay(left: Date | null, right: Date) {
  if (!left) return false;
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
}

export function deriveResultsDirectoryEventKind(input: {
  eventStatus: EventCardStatus;
  eventDate: Date | null;
  today: Date;
  raceStatuses: PublicResultsDirectoryRaceStatus[];
  registeredRunnerCount?: number;
  finisherCount?: number;
  publishedRaceCount?: number;
}): ResultsDirectoryEventKind {
  const hasLiveRace = input.raceStatuses.some((status) => status === "live");
  const hasPublishedRace = (input.publishedRaceCount ?? 0) > 0 || input.raceStatuses.some((status) => (
    status === "official" || status === "provisional" || status === "published"
  ));
  const hasPendingRace = input.raceStatuses.some((status) => status === "pending");

  // Result and organizer lifecycle state are stronger than the scheduled date.
  // This matters for rehearsals, postponed races, and events that an organizer
  // explicitly finishes before or after their original calendar day.
  if (hasLiveRace) return "live";
  if (input.eventStatus === "live" && !hasPublishedRace) return "live";
  if (input.eventStatus === "finished" || hasPublishedRace || hasPendingRace) {
    if (hasPublishedRace) return "finished";
    // Zero registrations alone must not hide imported results or finish evidence.
    // Unknown counts are not evidence that a planned race never took place.
    if (input.registeredRunnerCount === 0 && input.finisherCount === 0) return "closed";
    return "pending";
  }
  if (isSameCalendarDay(input.eventDate, input.today)) return "today";
  // The read model accounts for the event's end date and timezone. A past start
  // date alone does not finish a multi-day event.
  return "upcoming";
}

export function getFinishedResultsDirectoryEvents(
  events: readonly PublicResultsDirectoryEvent[],
  today: Date,
): FinishedResultsDirectoryEvent[] {
  return events.flatMap((event) => {
    const resultsKind = deriveResultsDirectoryEventKind({
      eventStatus: event.status,
      eventDate: event.startDateIso ? new Date(`${event.startDateIso}T00:00:00`) : null,
      today,
      raceStatuses: event.races.map((race) => race.resultsStatus),
      registeredRunnerCount: event.registeredRunnerCount,
      finisherCount: event.finisherCount,
      publishedRaceCount: event.publishedRaceCount,
    });
    return isFinishedResultsDirectoryEventKind(resultsKind) ? [{ ...event, resultsKind }] : [];
  });
}
