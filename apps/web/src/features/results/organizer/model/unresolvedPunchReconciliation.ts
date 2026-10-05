import type { OrganizerRaceDayState } from "@/lib/organizer-management";

type ExpectedAthlete = OrganizerRaceDayState["expectedAthletes"][number];
type UnresolvedPunch = OrganizerRaceDayState["unresolvedPunches"][number];

export type UnresolvedPunchCandidate = ExpectedAthlete & {
  likelyBibCorrection: boolean;
};

function normalizedBib(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleUpperCase();
}

function differsByOneOmittedCharacter(enteredBib: string, candidateBib: string) {
  if (!enteredBib || candidateBib.length !== enteredBib.length + 1) return false;
  return Array.from(candidateBib).some((_, index) => (
    candidateBib.slice(0, index) + candidateBib.slice(index + 1) === enteredBib
  ));
}

function numericBibDistance(enteredBib: string, candidateBib: string) {
  const entered = Number(enteredBib);
  const candidate = Number(candidateBib);
  return Number.isFinite(entered) && Number.isFinite(candidate)
    ? Math.abs(candidate - entered)
    : Number.POSITIVE_INFINITY;
}

export function selectUnresolvedPunchCandidates(
  expectedAthletes: ExpectedAthlete[],
  punch: Pick<UnresolvedPunch, "bibNumber" | "checkpointId" | "eventCategoryId">,
): UnresolvedPunchCandidate[] {
  const enteredBib = normalizedBib(punch.bibNumber);

  return expectedAthletes
    .filter((athlete) => (
      athlete.eventCategoryId === punch.eventCategoryId
      && Boolean(athlete.bibNumber)
      && athlete.checkpointPasses.every((pass) => pass.checkpointId !== punch.checkpointId)
    ))
    .map((athlete) => {
      const candidateBib = normalizedBib(athlete.bibNumber);
      return {
        ...athlete,
        likelyBibCorrection: differsByOneOmittedCharacter(enteredBib, candidateBib),
      };
    })
    .sort((left, right) => {
      if (left.likelyBibCorrection !== right.likelyBibCorrection) {
        return left.likelyBibCorrection ? -1 : 1;
      }
      const distance = numericBibDistance(enteredBib, normalizedBib(left.bibNumber))
        - numericBibDistance(enteredBib, normalizedBib(right.bibNumber));
      if (distance) return distance;
      return normalizedBib(left.bibNumber).localeCompare(normalizedBib(right.bibNumber), undefined, {
        numeric: true,
      });
    });
}
