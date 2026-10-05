import type { PublicClubDetailReadModel } from "@/features/clubs/model/publicClubDetail";
export type { PublicClubDetailReadModel, PublicClubDetailMember, PublicClubDetailRace, PublicClubDetailLeagueParticipation, PublicClubDetailAnnouncement, PublicClubDetailBadge } from "@/features/clubs/model/publicClubDetail";
export { getFallbackPublicClubDetail } from "@/features/clubs/model/publicClubDetail";
export { getPublicClubDetail } from "@/features/clubs/data/publicClubDetail";
export { getPublicClubPreview } from "@/features/clubs/data/publicClubPreview";
import type { PublicClubCatalogItem } from "@/features/clubs/model/publicClubCatalog";
export type { PublicClubCatalogItem } from "@/features/clubs/model/publicClubCatalog";
export { getPublicClubsCatalog } from "@/features/clubs/data/publicClubCatalog";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import { getSupabasePublicClient } from "@/lib/supabase";
import {
  getPublicAthleteMetadata,
} from "@/features/athletes/data/publicAthleteMetadata";
import {
  selectPrimaryClubByAthlete,
  type AthleteClubMembershipCandidate,
} from "@/features/athletes/model/primaryClub";
import {
  buildCanonicalClubIdBySource,
  canonicalClubId,
} from "@/features/clubs/model/clubIdentity";
import { aggregateAthleteDirectoryPerformance } from "@/features/athletes/model/directoryPerformance";
import { countryName } from "@/shared/domain/countries";
import { PUBLIC_READ_BATCH_SIZE, readPublicBatches } from "@/shared/data/readPublicBatches";

export type PublicAthleteCatalogItem = {
  id: string;
  name: string;
  club: string;
  clubs?: Array<{ clubId: string; slug: string; name: string }>;
  region: string;
  ageCategory: string | null;
  finishes: number;
  gender: "M" | "F" | "U";
  avatar: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  podiums: number;
  wins: number;
  totalDistanceKm: number;
  totalElevationM: number;
};

const fallbackClubs: PublicClubCatalogItem[] = [
  {
    id: "pd-velebit",
    clubId: "pd-velebit",
    iconKey: "mountain",
    colorKey: "primary",
    logoImageUrl: null,
    coverImageUrl: null,
    privacyLevel: "public",
    requiresApproval: false,
    name: "PD Velebit Zagreb",
    region: "Central Croatia",
    city: "Zagreb",
    country: "Croatia",
    members: 48,
    races: 124,
    totalDistanceKm: 6941,
    totalElevationM: 182400,
    podiums: 31,
    wins: 12,
    desc: "Croatia's alpine and trail running club with a strong mountain racing calendar.",
  },
  {
    id: "tk-zagreb",
    clubId: "tk-zagreb",
    iconKey: "flag",
    colorKey: "amber",
    logoImageUrl: null,
    coverImageUrl: null,
    privacyLevel: "public",
    requiresApproval: false,
    name: "TK Zagreb Marathon",
    region: "Central Croatia",
    city: "Zagreb",
    country: "Croatia",
    members: 234,
    races: 96,
    totalDistanceKm: 5120,
    totalElevationM: 120050,
    podiums: 24,
    wins: 8,
    desc: "City-based club with strong road-to-trail crossover runners.",
  },
  {
    id: "pd-mosor",
    clubId: "pd-mosor",
    iconKey: "wind",
    colorKey: "blue",
    logoImageUrl: null,
    coverImageUrl: null,
    privacyLevel: "public",
    requiresApproval: false,
    name: "PD Mosor",
    region: "Dalmatia",
    city: "Split",
    country: "Croatia",
    members: 64,
    races: 88,
    totalDistanceKm: 4712,
    totalElevationM: 141800,
    podiums: 21,
    wins: 7,
    desc: "Split mountain club with coastal and ridge-focused trail teams.",
  },
  {
    id: "ak-slavonija",
    clubId: "ak-slavonija",
    iconKey: "tree",
    colorKey: "green",
    logoImageUrl: null,
    coverImageUrl: null,
    privacyLevel: "public",
    requiresApproval: false,
    name: "AK Slavonija",
    region: "Slavonia",
    city: "Osijek",
    country: "Croatia",
    members: 54,
    races: 67,
    totalDistanceKm: 3984,
    totalElevationM: 98200,
    podiums: 16,
    wins: 5,
    desc: "Eastern Croatia endurance club active in ultra and league racing.",
  },
];

const fallbackClubDetails: Record<string, PublicClubDetailReadModel> = {
  "pd-velebit": {
    clubId: "pd-velebit",
    slug: "pd-velebit",
    createdByAthleteProfileId: null,
    name: "PD Velebit Zagreb",
    presidentName: "Marko Juric",
    iconKey: "mountain",
    colorKey: "primary",
    logoImageUrl: null,
    coverImageUrl: null,
    foundedYear: null,
    mainSport: null,
    clubType: null,
    officiallyRegistered: false,
    websiteUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    contactEmail: null,
    contactPhone: null,
    trainingDays: ["Tue", "Thu", "Sat"],
    hasRegularTraining: true,
    trainingLocation: "Jarun Lake, Zagreb",
    trainingNote: "Approximate evening group schedule. Contact the club for current meetup details.",
    privacyLevel: "public",
    requiresApproval: false,
    region: "Croatia",
    city: "Zagreb",
    members: 48,
    totalRaces: 124,
    totalDistanceKm: 6840,
    totalElevationM: 412000,
    podiums: 2,
    wins: 1,
    desc: "One of Croatia's most active trail running clubs, based in Zagreb. We organize group trainings, participate in leagues, and promote the trail running community across the Balkans.",
    badges: [
      { label: "100+ Race Entries", tier: "silver" },
    ],
    membersList: [
      { athleteProfileId: "marko-juric", athleteSlug: "marko-juric", name: "Marko Juric", role: "Captain", races: 47, distanceKm: 4200, elevationGainM: 250000, podiums: 1, wins: 0, results: [] },
      { athleteProfileId: "luka-peric", athleteSlug: "luka-peric", name: "Luka Peric", role: "Member", races: 33, distanceKm: 2640, elevationGainM: 162000, podiums: 1, wins: 1, results: [] },
    ],
    recentRaces: [
      { event: "Paklenica Sky Race 2025", date: "Sep 21, 2025", participants: 2, bestPlace: 1, bestRunner: "Luka Peric" },
    ],
    topFinishers: [
      { athleteProfileId: "luka-peric", athleteSlug: "luka-peric", name: "Luka Peric", role: "Member", races: 1, distanceKm: 42, elevationGainM: 1800, podiums: 1, wins: 1, results: [] },
      { athleteProfileId: "marko-juric", athleteSlug: "marko-juric", name: "Marko Juric", role: "Captain", races: 1, distanceKm: 42, elevationGainM: 1800, podiums: 0, wins: 0, results: [] },
    ],
    announcements: [
      { title: "Saturday Velebit Recon", date: "Recent", desc: "Group recon run for the 42K route this Saturday. Meet at 05:30 at the marina." },
    ],
  },
};

function countryLabel(countryCode: string | null | undefined) {
  return countryName(countryCode);
}

function isMissingMergedClubColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703"
    || candidate.code === "PGRST204"
    || (typeof candidate.message === "string" && candidate.message.includes("merged_into_club_id"));
}

function initials(displayName: string) {
  const parts = displayName.split(/\s+/).filter(Boolean).slice(0, 2);
  const value = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return value || "TR";
}

function normalizeGender(value: string | null | undefined): "M" | "F" | "U" {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.startsWith("m")) return "M";
  if (normalized.startsWith("f") || normalized.startsWith("w")) return "F";
  return "U";
}

const emptyPublicAthletesCatalog: PublicAthleteCatalogItem[] = [];
const emptyPublicClubsCatalog: PublicClubCatalogItem[] = [];

export function getFallbackPublicAthletesCatalog(): PublicAthleteCatalogItem[] {
  return emptyPublicAthletesCatalog;
}

export function getFallbackPublicClubsCatalog(): PublicClubCatalogItem[] {
  return emptyPublicClubsCatalog;
}

export async function getPublicAthletesCatalog(): Promise<PublicAthleteCatalogItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Public athlete directory service is unavailable");

  try {
    const pageSize = 250;
    const filterBatchSize = PUBLIC_READ_BATCH_SIZE;
    const athletesPromise = (async () => {
      const rows: Array<{
        id: string;
        slug: string;
        display_name: string;
        gender: string | null;
        country_code: string | null;
      }> = [];

      for (let from = 0; ; from += pageSize) {
        const { data: page, error } = await supabase
          .from("public_athlete_profiles")
          .select("id,slug,display_name,gender,country_code")
          .eq("status", "active")
          .order("display_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        rows.push(...(page ?? []));
        if (!page || page.length < pageSize) break;
      }

      return rows;
    })();
    const ageCategoriesPromise = getPublicAthleteMetadata().catch((error) => {
      console.warn("Unable to load public athlete age categories", error);
      return [];
    });
    const [athletes, ageCategoryRows] = await Promise.all([
      athletesPromise,
      ageCategoriesPromise,
    ]);

    if (!athletes.length) {
      return emptyPublicAthletesCatalog;
    }

    const athleteIds = athletes.map((athlete) => athlete.id);
    const ageCategoryByAthlete = new Map<string, string | null>(
      ageCategoryRows.map((row): [string, string | null] => [row.athleteProfileId, row.ageCategoryLabel]),
    );
    const avatarUrlByAthlete = new Map<string, string | null>(
      ageCategoryRows.map((row): [string, string | null] => [row.athleteProfileId, row.avatarUrl]),
    );
    const coverImageUrlByAthlete = new Map<string, string | null>(
      ageCategoryRows.map((row): [string, string | null] => [row.athleteProfileId, row.coverImageUrl]),
    );
    const [memberships, resultRows] = await Promise.all([
      readPublicBatches(athleteIds, async (pageAthleteIds): Promise<AthleteClubMembershipCandidate[]> => {
        const membershipResult = await supabase
          .from("club_memberships")
          .select("athlete_profile_id,club_id,is_primary,membership_origin,joined_at")
          .in("athlete_profile_id", pageAthleteIds)
          .eq("status", "active");

        if (membershipResult.error) throw membershipResult.error;

        return membershipResult.data ?? [];
      }),
      getCurrentPublishedResultRows({ athleteProfileIds: athleteIds }),
    ]);
    const categoryIds = Array.from(new Set(resultRows.map((row) => row.eventCategoryId)));
    const categories = await readPublicBatches(categoryIds, async (batchIds) => {
      const categoryResult = await supabase
        .from("event_categories")
        .select("id,distance_km,elevation_gain_m")
        .in("id", batchIds);

      if (categoryResult.error) throw categoryResult.error;
      return categoryResult.data ?? [];
    });

    const clubIds = Array.from(new Set(memberships.map((membership) => membership.club_id).filter(Boolean)));
    const clubIdentityRows: Array<{
      id: string;
      slug: string;
      name: string;
      status: string;
      merged_into_club_id: string | null;
    }> = [];
    const loadedClubIds = new Set<string>();
    let pendingClubIds = clubIds;

    while (pendingClubIds.length) {
      const queryClubIds = pendingClubIds.slice(0, filterBatchSize);
      pendingClubIds = pendingClubIds.slice(filterBatchSize);
      const clubIdentityResult = await supabase
        .from("clubs")
        .select("id,slug,name,status,merged_into_club_id")
        .in("id", queryClubIds);
      const compatibleClubResult = clubIdentityResult.error && isMissingMergedClubColumn(clubIdentityResult.error)
        ? await supabase.from("clubs").select("id,slug,name,status").in("id", queryClubIds)
        : null;
      if (compatibleClubResult?.error) throw compatibleClubResult.error;
      if (clubIdentityResult.error && !isMissingMergedClubColumn(clubIdentityResult.error)) {
        throw clubIdentityResult.error;
      }

      const loadedRows = compatibleClubResult
        ? (compatibleClubResult.data ?? []).map((club) => ({ ...club, merged_into_club_id: null }))
        : (clubIdentityResult.data ?? []);
      for (const club of loadedRows) {
        if (loadedClubIds.has(club.id)) continue;
        loadedClubIds.add(club.id);
        clubIdentityRows.push(club);
      }
      pendingClubIds = Array.from(new Set([
        ...pendingClubIds,
        ...loadedRows
          .map((club) => club.merged_into_club_id)
          .filter((clubId): clubId is string => Boolean(clubId) && !loadedClubIds.has(clubId)),
      ]));
    }

    const canonicalClubIdBySource = buildCanonicalClubIdBySource(clubIdentityRows);
    const activeClubIds = new Set(
      clubIdentityRows.filter((club) => club.status === "active").map((club) => club.id),
    );
    const currentMemberships = memberships
      .map((membership) => ({
        ...membership,
        club_id: canonicalClubId(membership.club_id, canonicalClubIdBySource),
      }))
      .filter((membership) => activeClubIds.has(membership.club_id));
    const primaryClubByAthlete = selectPrimaryClubByAthlete(currentMemberships);
    const clubById = new Map(clubIdentityRows.map(club => [club.id, club]));
    const clubsByAthlete = new Map<string, Map<string, { clubId: string; slug: string; name: string }>>();
    for (const membership of currentMemberships) {
      const club = clubById.get(membership.club_id);
      if (!club) continue;
      const athleteClubs = clubsByAthlete.get(membership.athlete_profile_id) ?? new Map();
      athleteClubs.set(club.id, { clubId: club.id, slug: club.slug, name: club.name });
      clubsByAthlete.set(membership.athlete_profile_id, athleteClubs);
    }

    const clubNameById = new Map(
      clubIdentityRows
        .filter((club) => club.status === "active")
        .map((club) => [club.id, club.name]),
    );
    const statsByAthlete = aggregateAthleteDirectoryPerformance({
      resultRows,
      courseMetricsByCategoryId: new Map(categories.map((category) => [category.id, {
        distanceKm: Number(category.distance_km ?? 0),
        elevationGainM: Number(category.elevation_gain_m ?? 0),
      }])),
    });

    return athletes.map((athlete) => {
      const stats = statsByAthlete.get(athlete.id) ?? {
        finishes: 0,
        podiums: 0,
        wins: 0,
        totalDistanceKm: 0,
        totalElevationM: 0,
      };
      const clubId = primaryClubByAthlete.get(athlete.id);

      return {
        id: athlete.slug,
        name: athlete.display_name,
        club: clubId ? clubNameById.get(clubId) ?? "Independent" : "Independent",
        clubs: Array.from(clubsByAthlete.get(athlete.id)?.values() ?? [])
          .sort((left, right) => left.name.localeCompare(right.name) || left.clubId.localeCompare(right.clubId)),
        region: countryLabel(athlete.country_code),
        ageCategory: ageCategoryByAthlete.get(athlete.id) ?? null,
        finishes: stats.finishes,
        gender: normalizeGender(athlete.gender),
        avatar: initials(athlete.display_name),
        avatarUrl: avatarUrlByAthlete.get(athlete.id) ?? null,
        coverImageUrl: coverImageUrlByAthlete.get(athlete.id) ?? null,
        podiums: stats.podiums,
        wins: stats.wins,
        totalDistanceKm: stats.totalDistanceKm,
        totalElevationM: stats.totalElevationM,
      };
    });
  } catch (error) {
    console.warn("Unable to load public athletes catalog", error);
    throw error;
  }
}
