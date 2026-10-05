import {
  selectLatestPublishedResults,
  type PublishedResultPublicationSource,
} from "@/shared/results/latestPublishedResults";

export type ClubMembershipSummarySource = {
  clubId: string;
  athleteProfileId: string;
  status: string;
  membershipOrigin?: string;
};

export type ClubResultEventSource = {
  id: string;
  athleteProfileId: string;
  representedClubId: string | null;
  eventCategoryId: string;
  resultRunId: string;
  resultStatus: string;
  finishTimeMs: number | null;
};

export type ClubEventCategorySource = {
  id: string;
  eventEditionId: string;
};

export type ClubEventEditionSource = {
  id: string;
  name: string;
  startDate: string;
};

export type ClubParticipationSummary = {
  members: number;
  events: number;
  recentEvents: string[];
};

export function buildClubParticipationSummaries(input: {
  clubIds: string[];
  memberships: ClubMembershipSummarySource[];
  resultRows: ClubResultEventSource[];
  publications: PublishedResultPublicationSource[];
  categories: ClubEventCategorySource[];
  editions: ClubEventEditionSource[];
}) {
  const requestedClubIds = new Set(input.clubIds);
  const memberIdsByClub = new Map<string, Set<string>>();
  const eventEditionIdsByClub = new Map<string, Set<string>>();
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const editionById = new Map(input.editions.map((edition) => [edition.id, edition]));

  for (const membership of input.memberships) {
    if (
      membership.status !== "active"
      || membership.membershipOrigin === "represented"
      || !requestedClubIds.has(membership.clubId)
    ) continue;
    const memberIds = memberIdsByClub.get(membership.clubId) ?? new Set<string>();
    memberIds.add(membership.athleteProfileId);
    memberIdsByClub.set(membership.clubId, memberIds);
  }

  const publishedResults = selectLatestPublishedResults({
    resultRows: input.resultRows.filter((row) => (
      row.resultStatus === "official" || row.resultStatus === "corrected"
    )),
    publications: input.publications,
  });

  for (const result of publishedResults) {
    if (
      !result.representedClubId
      || !requestedClubIds.has(result.representedClubId)
      || result.finishTimeMs == null
      || result.finishTimeMs <= 0
    ) continue;
    const memberIds = memberIdsByClub.get(result.representedClubId) ?? new Set<string>();
    memberIds.add(result.athleteProfileId);
    memberIdsByClub.set(result.representedClubId, memberIds);
    const category = categoryById.get(result.eventCategoryId);
    if (!category || !editionById.has(category.eventEditionId)) continue;
    const eventEditionIds = eventEditionIdsByClub.get(result.representedClubId) ?? new Set<string>();
    eventEditionIds.add(category.eventEditionId);
    eventEditionIdsByClub.set(result.representedClubId, eventEditionIds);
  }

  return new Map(input.clubIds.map((clubId): [string, ClubParticipationSummary] => {
    const eventEditionIds = eventEditionIdsByClub.get(clubId) ?? new Set<string>();
    const recentEvents = Array.from(eventEditionIds)
      .map((eventEditionId) => editionById.get(eventEditionId))
      .filter((edition): edition is ClubEventEditionSource => Boolean(edition))
      .sort((left, right) => (
        right.startDate.localeCompare(left.startDate) || left.name.localeCompare(right.name)
      ))
      .slice(0, 2)
      .map((edition) => edition.name);

    return [clubId, {
      members: memberIdsByClub.get(clubId)?.size ?? 0,
      events: eventEditionIds.size,
      recentEvents,
    }];
  }));
}
