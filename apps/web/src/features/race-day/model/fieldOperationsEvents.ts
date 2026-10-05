import { type OrganizerManagedEvent } from "@/lib/organizer-management";
import { getEventResultsProgress } from "@/features/events/model/eventResultsLifecycle";
import { eventHasFinished } from "@/features/events/model/eventCompletion";

const CLOSED_OPERATION_STATUSES = new Set([
  "archived",
  "cancelled",
  "canceled",
]);

export function eventResultsAreFinal(event: OrganizerManagedEvent) {
  const progress = getEventResultsProgress(event);
  if (!progress.isFinalized || progress.closedWithoutResultsCount === 0) return progress.isFinalized;
  if (["completed", "archived"].includes(event.status)) return true;
  // A no-results exemption resolves result administration, not other races'
  // lifecycle. Their imported publications may predate the current finish.
  const races = (event.categories ?? []).filter((race) => race.categoryType === "competitive");
  return races.length > 0 && races.every((race) => ["completed", "closed"].includes(race.status));
}

function eventIsClosedForFieldOperations(event: OrganizerManagedEvent, now: Date) {
  if (CLOSED_OPERATION_STATUSES.has(event.status) || eventResultsAreFinal(event)) return true;

  // Unknown counts are not evidence of an empty event. Keep registered races,
  // live races and provisional/partial publications available for the crew.
  if (event.totalRegistrations !== 0) return false;
  const races = event.categories ?? [];
  if (races.some((race) => (
    race.registrationCount > 0
    || race.status === "in_progress"
    || race.latestPublicationState
  ))) return false;

  return eventHasFinished({
    status: event.status,
    startDate: event.startDate,
    endDate: event.endDate,
    timeZone: event.timezone,
  }, now);
}

function eventDateValue(event: OrganizerManagedEvent) {
  const value = Date.parse(event.startDate);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function compareOperationalEvents(
  first: OrganizerManagedEvent,
  second: OrganizerManagedEvent,
) {
  const statusDifference = Number(second.status === "in_progress")
    - Number(first.status === "in_progress");
  if (statusDifference) return statusDifference;

  const dateDifference = eventDateValue(first) - eventDateValue(second);
  if (dateDifference) return dateDifference;

  return first.name.localeCompare(second.name);
}

export function selectFieldOperationsEvents(
  events: OrganizerManagedEvent[],
  requestedEventId?: string | null,
  includeRequestedFinalized = false,
  now = new Date(),
) {
  const realEvents = events.filter((event) => !event.isPractice);
  const operationalEvents = realEvents
    .filter((event) => !eventIsClosedForFieldOperations(event, now))
    .sort(compareOperationalEvents);
  const requestedEvent = requestedEventId
    ? realEvents.find((event) => event.id === requestedEventId)
    : null;

  if (
    !requestedEvent
    || operationalEvents.some((event) => event.id === requestedEvent.id)
    || (!includeRequestedFinalized && eventIsClosedForFieldOperations(requestedEvent, now))
  ) {
    return operationalEvents;
  }

  return [requestedEvent, ...operationalEvents];
}
