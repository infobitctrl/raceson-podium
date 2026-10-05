import { normalizeAthleteResultOutcome } from "@/features/athletes/model/athletePerformance";
import {
  selectLatestPublishedResults,
  type PublishedResultPublicationSource,
} from "@/shared/results/latestPublishedResults";

export type PublicRankingResultSource = {
  athleteProfileId: string;
  eventCategoryId: string;
  resultRunId: string;
  resultStatus: string;
  finishTimeMs: number | null;
};

export type PublicRankingPerformance = {
  races: number;
  totalDistanceKm: number;
  totalTimeMs: number;
  maxDistance: number;
};

export function aggregatePublicRankingPerformance(input: {
  resultRows: PublicRankingResultSource[];
  publications: PublishedResultPublicationSource[];
  distanceKmByCategoryId: ReadonlyMap<string, number>;
}) {
  const publishedResults = selectLatestPublishedResults({
    resultRows: input.resultRows.filter(
      (row) => row.resultStatus === "official" || row.resultStatus === "corrected",
    ),
    publications: input.publications,
  });
  const aggregateByAthlete = new Map<string, PublicRankingPerformance>();

  for (const row of publishedResults) {
    const finishTimeMs = row.finishTimeMs;
    if (normalizeAthleteResultOutcome(null, finishTimeMs) !== "finished" || finishTimeMs == null) continue;

    const current = aggregateByAthlete.get(row.athleteProfileId) ?? {
      races: 0,
      totalDistanceKm: 0,
      totalTimeMs: 0,
      maxDistance: 0,
    };
    const distanceKm = input.distanceKmByCategoryId.get(row.eventCategoryId) ?? 0;
    current.races += 1;
    current.totalDistanceKm += distanceKm;
    current.totalTimeMs += finishTimeMs;
    current.maxDistance = Math.max(current.maxDistance, distanceKm);
    aggregateByAthlete.set(row.athleteProfileId, current);
  }

  return aggregateByAthlete;
}
