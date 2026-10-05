import {
  selectLatestPublishedResults,
  type PublishedResultPublicationSource,
} from "@/shared/results/latestPublishedResults";

export type ClubMemberSource = {
  athleteProfileId: string;
  athleteSlug: string;
  name: string;
  role: string;
};

export type ClubResultRowSource = {
  id: string;
  registrationId: string;
  athleteProfileId: string;
  eventCategoryId: string;
  representedClubId?: string | null;
  resultRunId: string;
  resultStatus: string;
  participationStatus: string | null;
  finishTimeMs: number | null;
  rankOverall: number | null;
  rankGender: number | null;
  createdAt: string;
};

export type ClubCategorySource = {
  id: string;
  eventEditionId: string;
  name: string;
  distanceKm: number;
  elevationGainM: number;
};

export type ClubEditionSource = {
  id: string;
  slug: string;
  name: string;
  startDate: string;
};

export type ClubMemberRaceResult = {
  id: string;
  eventSlug: string;
  event: string;
  category: string;
  date: string;
  distanceKm: number;
  elevationGainM: number;
  finishTimeMs: number | null;
  rankOverall: number | null;
  rankGender: number | null;
  status: string;
  publicationStatus: string;
  isFinish: boolean;
};

export type ClubResultPublicationSource = PublishedResultPublicationSource;

export type ClubMemberResultSummary = ClubMemberSource & {
  races: number;
  distanceKm: number;
  elevationGainM: number;
  podiums: number;
  wins: number;
  results: ClubMemberRaceResult[];
};

export type ClubMemberAggregate = {
  races: number;
  distanceKm: number;
  elevationGainM: number;
  podiums: number;
  wins: number;
};

function resultPriority(result: ClubResultRowSource) {
  return result.resultStatus === "corrected" ? 2 : result.resultStatus === "official" ? 1 : 0;
}

function addDistance(left: number, right: number) {
  return Math.round((left + right) * 1000) / 1000;
}

export function isValidRaceRank(rank: number | null) {
  return rank != null && Number.isInteger(rank) && rank > 0;
}

export function selectLatestPublishedClubResults(input: {
  resultRows: ClubResultRowSource[];
  publications: ClubResultPublicationSource[];
}) {
  return selectLatestPublishedResults(input);
}

export function dedupePublishedClubResults(resultRows: ClubResultRowSource[]) {
  const latestByRegistration = new Map<string, ClubResultRowSource>();

  for (const result of resultRows) {
    if (result.resultStatus !== "official" && result.resultStatus !== "corrected") continue;
    const current = latestByRegistration.get(result.registrationId);
    if (!current) {
      latestByRegistration.set(result.registrationId, result);
      continue;
    }

    const priorityDelta = resultPriority(result) - resultPriority(current);
    if (priorityDelta > 0 || (priorityDelta === 0 && result.createdAt > current.createdAt)) {
      latestByRegistration.set(result.registrationId, result);
    }
  }

  return Array.from(latestByRegistration.values());
}

export function aggregateClubMemberResults(input: {
  members: ClubMemberSource[];
  resultRows: ClubResultRowSource[];
  categories: ClubCategorySource[];
  editions: ClubEditionSource[];
}) {
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const editionById = new Map(input.editions.map((edition) => [edition.id, edition]));
  const resultsByAthlete = new Map<string, ClubMemberRaceResult[]>();

  for (const row of dedupePublishedClubResults(input.resultRows)) {
    const category = categoryById.get(row.eventCategoryId);
    const edition = category ? editionById.get(category.eventEditionId) : null;
    if (!category || !edition) continue;

    const current = resultsByAthlete.get(row.athleteProfileId) ?? [];
    const isFinish = !["dns", "dnf", "dsq", "withdrawn", "missing"].includes(row.participationStatus ?? "")
      && (row.participationStatus === "finished" || (row.finishTimeMs ?? 0) > 0 || isValidRaceRank(row.rankOverall));
    const isPublishedNonFinish = ["dns", "dnf", "dsq", "withdrawn"].includes(row.participationStatus ?? "");
    if (!isFinish && !isPublishedNonFinish) continue;
    current.push({
      id: row.id,
      eventSlug: edition.slug,
      event: edition.name,
      category: category.name,
      date: edition.startDate,
      distanceKm: category.distanceKm,
      elevationGainM: category.elevationGainM,
      finishTimeMs: row.finishTimeMs,
      rankOverall: row.rankOverall,
      rankGender: row.rankGender,
      status: row.participationStatus ?? row.resultStatus,
      publicationStatus: row.resultStatus,
      isFinish,
    });
    resultsByAthlete.set(row.athleteProfileId, current);
  }

  const members = input.members.map((member): ClubMemberResultSummary => {
    const results = (resultsByAthlete.get(member.athleteProfileId) ?? [])
      .sort((left, right) => right.date.localeCompare(left.date));

    const finishes = results.filter((result) => result.isFinish);
    return {
      ...member,
      races: finishes.length,
      distanceKm: finishes.reduce((sum, result) => addDistance(sum, result.distanceKm), 0),
      elevationGainM: finishes.reduce((sum, result) => sum + result.elevationGainM, 0),
      podiums: finishes.filter((result) => isValidRaceRank(result.rankGender) && result.rankGender! <= 3).length,
      wins: finishes.filter((result) => result.rankGender === 1).length,
      results,
    };
  });

  const aggregate = members.reduce<ClubMemberAggregate>((summary, member) => ({
    races: summary.races + member.races,
    distanceKm: addDistance(summary.distanceKm, member.distanceKm),
    elevationGainM: summary.elevationGainM + member.elevationGainM,
    podiums: summary.podiums + member.podiums,
    wins: summary.wins + member.wins,
  }), {
    races: 0,
    distanceKm: 0,
    elevationGainM: 0,
    podiums: 0,
    wins: 0,
  });

  return { members, aggregate };
}
