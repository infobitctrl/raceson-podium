export type AthleteResultOutcome =
  | "finished"
  | "dns"
  | "dnf"
  | "dsq"
  | "withdrawn"
  | "stopped"
  | "evacuated"
  | "missing"
  | "unknown";

const knownOutcomes = new Set<AthleteResultOutcome>([
  "finished",
  "dns",
  "dnf",
  "dsq",
  "withdrawn",
  "stopped",
  "evacuated",
  "missing",
]);

export function normalizeAthleteResultOutcome(
  participationStatus: string | null | undefined,
  finishTimeMs: number | null | undefined,
): AthleteResultOutcome {
  const normalizedStatus = participationStatus?.trim().toLowerCase();

  if (normalizedStatus === "not_started" || normalizedStatus === "checked_in") {
    return "dns";
  }

  if (normalizedStatus && knownOutcomes.has(normalizedStatus as AthleteResultOutcome)) {
    return normalizedStatus as AthleteResultOutcome;
  }

  return finishTimeMs != null && finishTimeMs > 0 ? "finished" : "unknown";
}

export function summarizeAthletePerformance(
  results: Array<{
    status: AthleteResultOutcome;
    finishTimeMs: number | null;
    place: number;
  }>,
) {
  const races = results.filter((result) => result.status !== "dns");
  const finishes = results.filter(
    (result) => result.status === "finished" && result.finishTimeMs != null && result.finishTimeMs > 0,
  );
  const totalFinishTimeMs = finishes.reduce((sum, result) => sum + (result.finishTimeMs ?? 0), 0);

  return {
    totalParticipations: results.length,
    totalRaces: races.length,
    totalFinishes: finishes.length,
    podiums: finishes.filter((result) => result.place > 0 && result.place <= 3).length,
    wins: finishes.filter((result) => result.place === 1).length,
    averageFinishMs: finishes.length ? Math.round(totalFinishTimeMs / finishes.length) : null,
  };
}
