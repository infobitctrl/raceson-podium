import { type OrganizerManagedEvent } from "@/lib/organizer-management";

const FINAL_RESULT_STATES = new Set(["official", "corrected"]);

export function resultPublicationIsFinal(state: string | null | undefined) {
  return FINAL_RESULT_STATES.has(state ?? "");
}

export function getEventResultsProgress(event: OrganizerManagedEvent) {
  const competitiveRaces = (event.categories ?? []).filter(
    (category) => category.categoryType === "competitive",
  );
  const finalCount = competitiveRaces.filter((category) =>
    resultPublicationIsFinal(category.latestPublicationState),
  ).length;
  const provisionalCount = competitiveRaces.filter(
    (category) => category.latestPublicationState === "provisional",
  ).length;
  const closedWithoutResultsCount = competitiveRaces.filter((category) =>
    category.status === "completed" && category.finishedWithoutResults === true
    && !category.latestPublicationState,
  ).length;

  return {
    raceCount: competitiveRaces.length,
    finalCount,
    provisionalCount,
    closedWithoutResultsCount,
    pendingCount: competitiveRaces.length - finalCount - closedWithoutResultsCount,
    isFinalized: competitiveRaces.length > 0
      && finalCount + closedWithoutResultsCount === competitiveRaces.length,
  };
}

export function getOrganizerEventStatusLabel(
  eventStatus: string,
  progress: Omit<ReturnType<typeof getEventResultsProgress>, "closedWithoutResultsCount">
    & { closedWithoutResultsCount?: number },
) {
  if (eventStatus !== "completed") return eventStatus.replaceAll("_", " ");
  if (progress.isFinalized) return progress.closedWithoutResultsCount ? "Completed" : "Final results published";
  if (progress.finalCount > 0 || progress.provisionalCount > 0) return "Results pending";
  return "Completed";
}
