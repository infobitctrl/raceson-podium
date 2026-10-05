import { getSupabasePublicClient } from "@/lib/supabase";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import type { PublicClubCatalogItem } from "@/features/clubs/model/publicClubCatalog";
import { aggregateClubMemberResults } from "@/features/clubs/model/memberResults";
import {
  buildCanonicalClubIdBySource, canonicalClubId, selectCurrentClubMemberships,
  type CurrentClubMembershipSource,
} from "@/features/clubs/model/clubIdentity";
import { countryName } from "@/shared/domain/countries";
import { readPublicBatches } from "@/shared/data/readPublicBatches";

function isMissingMergedClubColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  return (code === "42703" || code === "PGRST204")
    && Boolean(message?.includes("merged_into_club_id"));
}

export async function getPublicClubsCatalog(): Promise<PublicClubCatalogItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Public club data is unavailable.");

  const pageSize = 250;
  const clubs = [];
  const mergedClubs: Array<{ id: string; merged_into_club_id: string }> = [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from("clubs")
      .select("id,slug,name,icon_key,color_key,logo_image_url,cover_image_url,privacy_level,requires_approval,region,city,country_code,description")
      .eq("status", "active")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    clubs.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }

  if (!clubs.length) return [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from("clubs")
      .select("id,merged_into_club_id")
      .not("merged_into_club_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error && !isMissingMergedClubColumn(error)) throw error;
    if (error) break;
    mergedClubs.push(...((page ?? []) as Array<{ id: string; merged_into_club_id: string }>));
    if (!page || page.length < pageSize) break;
  }

  const clubIds = clubs.map((club) => club.id);
  const activeClubIds = new Set(clubIds);
  const canonicalClubIdBySource = buildCanonicalClubIdBySource([
    ...clubs.map((club) => ({ id: club.id, merged_into_club_id: null })),
    ...mergedClubs,
  ]);
  const clubFamilyIds = Array.from(new Set([
    ...clubIds,
    ...mergedClubs
      .filter((club) => activeClubIds.has(canonicalClubId(club.id, canonicalClubIdBySource)))
      .map((club) => club.id),
  ]));
  // Attach both reads immediately so a rejected result request is handled
  // even while membership pages are still loading.
  const [rawMemberships, memberResults] = await Promise.all([
    readPublicBatches(clubFamilyIds, async (batchIds) => {
      const rows: CurrentClubMembershipSource[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("club_memberships")
          .select("club_id,athlete_profile_id,status,membership_origin,is_primary,joined_at")
          .in("club_id", batchIds)
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    }),
    getCurrentPublishedResultRows({ representedClubIds: clubFamilyIds }),
  ]);

  const memberships = selectCurrentClubMemberships(
    rawMemberships,
    canonicalClubIdBySource,
    { includeRepresented: true },
  );

  const memberIdsByClub = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const memberIds = memberIdsByClub.get(membership.club_id) ?? new Set<string>();
    memberIds.add(membership.athlete_profile_id);
    memberIdsByClub.set(membership.club_id, memberIds);
  }
  const categoryIds = Array.from(new Set(memberResults.map((row) => row.eventCategoryId)));
  const resultCategories = await readPublicBatches(categoryIds, async (batchIds) => {
    const { data, error } = await supabase
      .from("event_categories")
      .select("id,event_edition_id,name,distance_km,elevation_gain_m")
      .in("id", batchIds);
    if (error) throw error;
    return data ?? [];
  });
  const editionIds = Array.from(new Set(resultCategories.map((category) => category.event_edition_id)));
  const resultEditions = await readPublicBatches(editionIds, async (batchIds) => {
    const { data, error } = await supabase
      .from("event_editions")
      .select("id,slug,name,start_date")
      .in("id", batchIds);
    if (error) throw error;
    return data ?? [];
  });
  const catalogMemberResults = memberResults.map((row) => ({
    id: row.resultRowId,
    resultRunId: row.resultRunId,
    registrationId: row.resultRowId,
    athleteProfileId: row.athleteProfileId,
    eventCategoryId: row.eventCategoryId,
    representedClubId: row.representedClubId,
    resultStatus: row.resultStatus,
    participationStatus: row.participationStatus,
    finishTimeMs: row.finishTimeMs,
    rankOverall: row.rankOverall,
    rankGender: row.rankGender,
    createdAt: row.resultCreatedAt,
  }));
  const catalogCategories = (resultCategories ?? []).map((category) => ({
    id: category.id,
    eventEditionId: category.event_edition_id,
    name: category.name,
    distanceKm: Number(category.distance_km ?? 0),
    elevationGainM: Number(category.elevation_gain_m ?? 0),
  }));
  const catalogEditions = (resultEditions ?? []).map((edition) => ({
    id: edition.id,
    slug: edition.slug,
    name: edition.name,
    startDate: edition.start_date,
  }));
  const categoryById = new Map(catalogCategories.map((category) => [category.id, category]));
  const editionById = new Map(catalogEditions.map((edition) => [edition.id, edition]));
  const resultsByClubId = new Map<string, typeof catalogMemberResults>();
  for (const result of catalogMemberResults) {
    if (!result.representedClubId) continue;
    const resolvedClubId = canonicalClubId(result.representedClubId, canonicalClubIdBySource);
    if (!activeClubIds.has(resolvedClubId)) continue;
    const clubResults = resultsByClubId.get(resolvedClubId) ?? [];
    clubResults.push(result);
    resultsByClubId.set(resolvedClubId, clubResults);
  }
  const aggregatesByClubId = new Map(clubIds.map((clubId) => {
    const clubResults = resultsByClubId.get(clubId) ?? [];
    const participantIds = Array.from(new Set(clubResults.map((result) => result.athleteProfileId)));
    // The shared aggregator builds lookup maps. Give it only this club's
    // records, not the complete category/edition catalogue for every club.
    const categories = Array.from(new Set(clubResults.map((result) => result.eventCategoryId)))
      .flatMap((id) => categoryById.get(id) ? [categoryById.get(id)!] : []);
    const editions = Array.from(new Set(categories.map((category) => category.eventEditionId)))
      .flatMap((id) => editionById.get(id) ? [editionById.get(id)!] : []);
    const { members, aggregate } = aggregateClubMemberResults({
      members: participantIds.map((athleteProfileId) => ({
        athleteProfileId,
        athleteSlug: "",
        name: "",
        role: "Participant",
      })),
      resultRows: clubResults,
      categories,
      editions,
    });
    return [clubId, {
      aggregate,
      finisherIds: members
        .filter((member) => member.races > 0)
        .map((member) => member.athleteProfileId),
    }] as const;
  }));

  return clubs
    .filter((club) => {
      const privacyLevel = typeof club.privacy_level === "string" ? club.privacy_level : "public";
      return privacyLevel !== "invite_only";
    })
    .map((club) => {
      const resultSummary = aggregatesByClubId.get(club.id);
      const visibleMemberIds = new Set([
        ...(memberIdsByClub.get(club.id) ?? []),
        ...(resultSummary?.finisherIds ?? []),
      ]);

      return {
        id: club.slug,
        clubId: club.id,
        iconKey: typeof club.icon_key === "string" ? club.icon_key : "mountain",
        colorKey: typeof club.color_key === "string" ? club.color_key : "primary",
        logoImageUrl: typeof club.logo_image_url === "string" ? club.logo_image_url : null,
        coverImageUrl: typeof club.cover_image_url === "string" ? club.cover_image_url : null,
        privacyLevel:
          typeof club.privacy_level === "string" && (
            club.privacy_level === "public" ||
            club.privacy_level === "private" ||
            club.privacy_level === "invite_only"
          )
            ? club.privacy_level
            : "public",
        requiresApproval: Boolean(club.requires_approval),
        name: club.name,
        region:
          typeof club.region === "string" && club.region.trim().length
            ? club.region
            : countryName(club.country_code),
        city: typeof club.city === "string" ? club.city.trim() : "",
        country: countryName(club.country_code),
        members: visibleMemberIds.size,
        races: resultSummary?.aggregate.races ?? 0,
        totalDistanceKm: Number(resultSummary?.aggregate.distanceKm ?? 0),
        totalElevationM: Number(resultSummary?.aggregate.elevationGainM ?? 0),
        podiums: resultSummary?.aggregate.podiums ?? 0,
        wins: resultSummary?.aggregate.wins ?? 0,
        desc: typeof club.description === "string" ? club.description.trim() : "",
      };
    });
}
