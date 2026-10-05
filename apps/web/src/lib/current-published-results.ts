import { apiRequest } from "@/lib/api";
import { readPublicBatches } from "@/shared/data/readPublicBatches";

export type CurrentPublishedResultRow = {
  leagueClassificationIds?: string[];
  publicationId: string;
  publicationState: "official" | "corrected";
  publishedAt: string;
  resultRowId: string;
  resultRunId: string;
  athleteProfileId: string;
  eventCategoryId: string;
  resultStatus: "official" | "corrected";
  participationStatus: string | null;
  bib: string | null;
  finishTimeMs: number | null;
  gapMs: number | null;
  rankOverall: number | null;
  rankGender: number | null;
  rankAgeCategory: number | null;
  clubPoints: number | null;
  representedClubId: string | null;
  resultCreatedAt: string;
};

export type CurrentPublishedResultFilter =
  | { athleteProfileIds: string[] }
  | { representedClubIds: string[] }
  | { eventCategoryIds: string[] };

type CurrentPublishedResultPage = {
  rows: CurrentPublishedResultRow[];
  nextOffset: number | null;
};

const MAX_RESULT_PAGES_PER_BATCH = 201;

function filterEntries(filter: CurrentPublishedResultFilter) {
  if ("athleteProfileIds" in filter) {
    return ["athleteProfileIds", filter.athleteProfileIds] as const;
  }
  if ("representedClubIds" in filter) {
    return ["representedClubIds", filter.representedClubIds] as const;
  }
  return ["eventCategoryIds", filter.eventCategoryIds] as const;
}

export async function getCurrentPublishedResultRows(
  filter: CurrentPublishedResultFilter,
  leagueSeasonId?: string,
): Promise<CurrentPublishedResultRow[]> {
  const [filterKey, rawIds] = filterEntries(filter);
  const ids = Array.from(new Set(rawIds));
  if (!ids.length) return [];

  return readPublicBatches(ids, async (batchIds) => {
    const rows: CurrentPublishedResultRow[] = [];
    let offset = 0;

    for (let pageNumber = 0; pageNumber < MAX_RESULT_PAGES_PER_BATCH; pageNumber += 1) {
      const page = await apiRequest<CurrentPublishedResultPage>({
        path: "/v1/public/results/current",
        method: "POST",
        accessToken: null,
        body: {
          ...(leagueSeasonId ? { leagueSeasonId } : {}),
          [filterKey]: batchIds,
          offset,
        },
      });
      rows.push(...page.rows);
      if (page.nextOffset == null) break;
      if (page.nextOffset <= offset) {
        throw new Error("Current published result pagination did not advance.");
      }
      offset = page.nextOffset;

      if (pageNumber === MAX_RESULT_PAGES_PER_BATCH - 1) {
        throw new Error("Current published result query exceeded the supported page limit.");
      }
    }
    return rows;
  });
}
