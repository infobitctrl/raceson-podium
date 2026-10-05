import { normalizeAthleteResultOutcome } from "./athletePerformance";

export type AthleteDirectoryResultSource = {
  athleteProfileId: string;
  eventCategoryId: string;
  participationStatus: string | null;
  finishTimeMs: number | null;
  rankOverall: number | null;
};

export type AthleteDirectoryCourseMetrics = {
  distanceKm: number;
  elevationGainM: number;
};

export type AthleteDirectoryPerformance = {
  finishes: number;
  podiums: number;
  wins: number;
  totalDistanceKm: number;
  totalElevationM: number;
};

function positiveMetric(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function aggregateAthleteDirectoryPerformance(input: {
  resultRows: AthleteDirectoryResultSource[];
  courseMetricsByCategoryId: ReadonlyMap<string, AthleteDirectoryCourseMetrics>;
}) {
  const performanceByAthlete = new Map<string, AthleteDirectoryPerformance>();

  for (const row of input.resultRows) {
    if (normalizeAthleteResultOutcome(row.participationStatus, row.finishTimeMs) !== "finished") continue;

    const current = performanceByAthlete.get(row.athleteProfileId) ?? {
      finishes: 0,
      podiums: 0,
      wins: 0,
      totalDistanceKm: 0,
      totalElevationM: 0,
    };
    const courseMetrics = input.courseMetricsByCategoryId.get(row.eventCategoryId);

    current.finishes += 1;
    current.totalDistanceKm += positiveMetric(courseMetrics?.distanceKm);
    current.totalElevationM += positiveMetric(courseMetrics?.elevationGainM);
    if ((row.rankOverall ?? 0) > 0 && (row.rankOverall ?? 0) <= 3) current.podiums += 1;
    if (row.rankOverall === 1) current.wins += 1;
    performanceByAthlete.set(row.athleteProfileId, current);
  }

  for (const performance of performanceByAthlete.values()) {
    performance.totalDistanceKm = Math.round(performance.totalDistanceKm * 100) / 100;
    performance.totalElevationM = Math.round(performance.totalElevationM);
  }

  return performanceByAthlete;
}
