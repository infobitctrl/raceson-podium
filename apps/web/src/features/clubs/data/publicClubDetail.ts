import { format } from "date-fns";
import { getSupabasePublicClient } from "@/lib/supabase";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import { getPublicAthleteMetadata, type PublicAthleteMetadata } from "@/features/athletes/data/publicAthleteMetadata";
import { loadPublicEventPreviewMedia } from "@/features/events/public/data/publicEventPreviewMedia";
import { resolveLeagueImageUrl } from "@/features/leagues/model/leagueMedia";
import { countryName as countryLabel } from "@/shared/domain/countries";
import { readPublicBatches } from "@/shared/data/readPublicBatches";
import { selectCurrentClubMemberships } from "../model/clubIdentity";
import { aggregateClubMemberResults, isValidRaceRank } from "../model/memberResults";
import { getFallbackPublicClubDetail, type PublicClubDetailReadModel, type PublicClubDetailMember, type PublicClubDetailRace, type PublicClubDetailLeagueParticipation, type PublicClubDetailBadge } from "../model/publicClubDetail";
import { resolvePublicClub, readPublicClubFamily } from "./publicClubIdentity";
import { readClubPages } from "./readClubPages";

export async function getPublicClubDetail(slug: string): Promise<PublicClubDetailReadModel | null> {
  const fallback = getFallbackPublicClubDetail(slug);
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Public club data is unavailable.");
  const identity = await resolvePublicClub(supabase, slug);
  if (!identity) return null;
  const { club } = identity;
  const { clubFamilyIds, canonicalClubIdBySource } = await readPublicClubFamily(supabase, club.id, identity.supportsMerges);

  const [rawMemberships, announcementResult, leagueStandings, resultRows, athleteMetadata] = await Promise.all([
    readPublicBatches(clubFamilyIds, ids => readClubPages(async (from, to) => supabase
      .from("club_memberships")
      .select("club_id,athlete_profile_id,membership_role,status,is_primary,membership_origin,joined_at")
      .in("club_id", ids).eq("status", "active").order("id", { ascending: true }).range(from, to))),
    supabase
      .from("club_posts")
      .select("title,body,created_at")
      .eq("club_id", club.id)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(3),
    readPublicBatches(clubFamilyIds, ids => readClubPages(async (from, to) => supabase
      .from("league_club_standings")
      .select("league_season_id,club_id,points_total,scored_rounds,rank_overall")
      .in("club_id", ids).order("id", { ascending: true }).range(from, to))),
    getCurrentPublishedResultRows({ representedClubIds: clubFamilyIds }),
    getPublicAthleteMetadata().catch(() => []),
  ]);

  if (announcementResult.error) throw announcementResult.error;

  const memberships = selectCurrentClubMemberships(
    rawMemberships,
    canonicalClubIdBySource,
    { includeRepresented: true },
  ).filter((membership) => membership.club_id === club.id);
  const announcements = announcementResult.data ?? [];
  const athleteIds = Array.from(
    new Set([
      ...memberships.map((membership) => membership.athlete_profile_id),
      ...resultRows.map((resultRow) => resultRow.athleteProfileId),
      club.created_by_athlete_profile_id,
    ].filter(Boolean)),
  );

  const categoryIds = Array.from(new Set(resultRows.map((row) => row.eventCategoryId)));
  const leagueSeasonIds = Array.from(new Set(leagueStandings.map((standing) => standing.league_season_id)));
  const [athletes, categories, leagueSeasons] = await Promise.all([
    readPublicBatches(athleteIds, async ids => {
      const { data, error } = await supabase.from("public_athlete_profiles").select("id,slug,display_name").in("id", ids);
      if (error) throw error;
      return data ?? [];
    }),
    readPublicBatches(categoryIds, async ids => {
      const { data, error } = await supabase.from("event_categories").select("id,event_edition_id,name,distance_km,elevation_gain_m").in("id", ids);
      if (error) throw error;
      return data ?? [];
    }),
    readPublicBatches(leagueSeasonIds, async ids => {
      const { data, error } = await supabase.from("league_seasons").select("id,league_id,year,name,status").in("id", ids);
      if (error) throw error;
      return data ?? [];
    }),
  ]);
  const editionIds = Array.from(new Set(categories.map(category => category.event_edition_id)));
  const leagueIds = Array.from(new Set(leagueSeasons.map(season => season.league_id)));
  const [editions, leagues] = await Promise.all([
    readPublicBatches(editionIds, async ids => {
      // Pass the cover to the preview loader below so large legacy data URLs
      // are read once and covered events do not need a track-image lookup.
      const { data, error } = await supabase.from("event_editions").select("id,slug,name,start_date,cover_image_url").in("id", ids);
      if (error) throw error;
      return data ?? [];
    }),
    readPublicBatches(leagueIds, async ids => {
      const { data, error } = await supabase.from("leagues").select("id,slug,name,description,status").in("id", ids);
      if (error) throw error;
      return data ?? [];
    }),
  ]);
  const eventPreviewMediaBySlug = await loadPublicEventPreviewMedia(supabase, editions);

  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const athleteMetadataById = new Map<string, PublicAthleteMetadata>(
    athleteMetadata.map((metadata): [string, PublicAthleteMetadata] => [metadata.athleteProfileId, metadata]),
  );
  const mappedResultRows = resultRows.map((row) => ({
    id: row.resultRowId,
    resultRunId: row.resultRunId,
    registrationId: row.resultRowId,
    athleteProfileId: row.athleteProfileId,
    eventCategoryId: row.eventCategoryId,
    resultStatus: row.resultStatus,
    participationStatus: row.participationStatus,
    finishTimeMs: row.finishTimeMs,
    rankOverall: row.rankOverall,
    rankGender: row.rankGender,
    createdAt: row.resultCreatedAt,
  }));
  const mappedCategories = categories.map((category) => ({
    id: category.id,
    eventEditionId: category.event_edition_id,
    name: category.name,
    distanceKm: Number(category.distance_km ?? 0),
    elevationGainM: Number(category.elevation_gain_m ?? 0),
  }));
  const mappedEditions = editions.map((edition) => ({
    id: edition.id,
    slug: edition.slug,
    name: edition.name,
    startDate: edition.start_date,
  }));
  const { members: membersList } = aggregateClubMemberResults({
    members: memberships.map((membership) => {
      const athlete = athleteById.get(membership.athlete_profile_id);
      const isCaptain = membership.athlete_profile_id === club.created_by_athlete_profile_id;
      return {
        athleteProfileId: membership.athlete_profile_id,
        athleteSlug: athlete?.slug ?? "athletes",
        name: athlete?.display_name ?? "Club Member",
        role: isCaptain ? "Captain" : membership.membership_role === "member" ? "Member" : membership.membership_role,
      };
    }),
    resultRows: mappedResultRows,
    categories: mappedCategories,
    editions: mappedEditions,
  });
  const participantIds = Array.from(new Set(mappedResultRows.map((row) => row.athleteProfileId)));
  const { members: participants, aggregate } = aggregateClubMemberResults({
    members: participantIds.map((athleteProfileId) => {
      const athlete = athleteById.get(athleteProfileId);
      return {
        athleteProfileId,
        athleteSlug: athlete?.slug ?? "athletes",
        name: athlete?.display_name ?? "Club Participant",
        role: "Participant",
      };
    }),
    resultRows: mappedResultRows,
    categories: mappedCategories,
    editions: mappedEditions,
  });

  const racesByEdition = new Map<
    string,
    PublicClubDetailRace
  >();
  for (const member of participants) {
    for (const result of member.results) {
      if (!result.isFinish) continue;
      const existing = racesByEdition.get(result.eventSlug);
      const resultPlace = isValidRaceRank(result.rankGender) ? result.rankGender : null;
      const keepsExistingBest = existing?.bestPlace != null
        && (resultPlace == null || existing.bestPlace <= resultPlace);
      const previewMedia = eventPreviewMediaBySlug.get(result.eventSlug);
      racesByEdition.set(result.eventSlug, {
        eventSlug: result.eventSlug,
        event: result.event,
        date: result.date,
        coverImageUrl: previewMedia?.coverImageUrl ?? null,
        linkedTrackImageUrl: previewMedia?.linkedTrackImageUrl ?? null,
        participants: (existing?.participants ?? 0) + 1,
        bestPlace: keepsExistingBest ? existing.bestPlace : resultPlace,
        bestRunner: keepsExistingBest ? existing.bestRunner : member.name,
      });
    }
  }

  const visibleMembersByAthleteId = new Map(
    participants
      .filter((participant) => participant.races > 0)
      .map((participant) => [participant.athleteProfileId, participant]),
  );
  for (const member of membersList) {
    visibleMembersByAthleteId.set(member.athleteProfileId, member);
  }
  const enrichMember = (member: PublicClubDetailMember): PublicClubDetailMember => ({
    ...member,
    avatarUrl: athleteMetadataById.get(member.athleteProfileId)?.avatarUrl ?? null,
    ageCategory: athleteMetadataById.get(member.athleteProfileId)?.ageCategoryLabel ?? null,
  });
  const visibleMembers = Array.from(visibleMembersByAthleteId.values()).map(enrichMember);

  const storedPresidentName = (club as { president_name?: string | null }).president_name;
  const derivedPresidentName = typeof storedPresidentName === "string"
    ? storedPresidentName.trim()
    : "";

  const activeMemberCount = visibleMembers.length;
  const leagueSeasonById = new Map(leagueSeasons.map((season) => [season.id, season]));
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const leagueParticipations: PublicClubDetailLeagueParticipation[] = leagueStandings
    .map((standing) => {
      const season = leagueSeasonById.get(standing.league_season_id);
      const league = season ? leagueById.get(season.league_id) : null;
      if (!season || !league) return null;
      return {
        leagueSlug: league.slug,
        leagueName: league.name,
        seasonName: season.name,
        seasonYear: season.year,
        imageUrl: resolveLeagueImageUrl(league.description),
        rank: standing.rank_overall,
        points: Number(standing.points_total ?? 0),
        scoredRounds: standing.scored_rounds,
      } satisfies PublicClubDetailLeagueParticipation;
    })
    .filter((participation): participation is PublicClubDetailLeagueParticipation => participation !== null)
    .sort((left, right) => right.seasonYear - left.seasonYear || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER));
  const badges: PublicClubDetailBadge[] = [];
  if (aggregate.wins > 0) badges.push({ label: `${aggregate.wins} Race Win${aggregate.wins === 1 ? "" : "s"}`, tier: "gold" });
  if (aggregate.podiums > 0) badges.push({ label: `${aggregate.podiums} Podium${aggregate.podiums === 1 ? "" : "s"}`, tier: "silver" });

  return {
    clubId: club.id,
    slug: club.slug,
    createdByAthleteProfileId: club.created_by_athlete_profile_id ?? null,
    name: club.name,
    presidentName: derivedPresidentName,
    iconKey: typeof club.icon_key === "string" ? club.icon_key : fallback.iconKey,
    colorKey: typeof club.color_key === "string" ? club.color_key : fallback.colorKey,
    logoImageUrl: typeof club.logo_image_url === "string" ? club.logo_image_url : fallback.logoImageUrl,
    coverImageUrl: typeof club.cover_image_url === "string" ? club.cover_image_url : fallback.coverImageUrl,
    foundedYear: typeof club.founded_year === "number" ? club.founded_year : fallback.foundedYear,
    mainSport: typeof club.main_sport === "string" && club.main_sport.trim() ? club.main_sport.trim() : fallback.mainSport,
    clubType: typeof club.club_type === "string" && club.club_type.trim() ? club.club_type.trim() : fallback.clubType,
    officiallyRegistered: typeof club.officially_registered === "boolean" ? club.officially_registered : fallback.officiallyRegistered,
    websiteUrl: typeof club.website_url === "string" && club.website_url.trim() ? club.website_url.trim() : fallback.websiteUrl,
    instagramUrl: typeof club.instagram_url === "string" && club.instagram_url.trim() ? club.instagram_url.trim() : fallback.instagramUrl,
    facebookUrl: typeof club.facebook_url === "string" && club.facebook_url.trim() ? club.facebook_url.trim() : fallback.facebookUrl,
    contactEmail: typeof club.contact_email === "string" && club.contact_email.trim() ? club.contact_email.trim() : fallback.contactEmail,
    contactPhone: typeof club.contact_phone === "string" && club.contact_phone.trim() ? club.contact_phone.trim() : fallback.contactPhone,
    trainingDays: Array.isArray((club as { training_days?: unknown }).training_days)
      ? (club as { training_days?: unknown[] }).training_days.filter((day): day is string => typeof day === "string")
      : fallback.trainingDays,
    hasRegularTraining:
      typeof (club as { has_regular_training?: unknown }).has_regular_training === "boolean"
        ? Boolean((club as { has_regular_training?: unknown }).has_regular_training)
        : fallback.hasRegularTraining,
    trainingLocation:
      typeof (club as { training_location?: unknown }).training_location === "string"
        ? (club as { training_location?: string }).training_location ?? null
        : fallback.trainingLocation,
    trainingNote:
      typeof (club as { training_note?: unknown }).training_note === "string"
        ? (club as { training_note?: string }).training_note ?? null
        : fallback.trainingNote,
    privacyLevel:
      typeof club.privacy_level === "string" && (
        club.privacy_level === "public" ||
        club.privacy_level === "private" ||
        club.privacy_level === "invite_only"
      )
        ? club.privacy_level
        : fallback.privacyLevel,
    requiresApproval:
      typeof club.requires_approval === "boolean"
        ? club.requires_approval
        : fallback.requiresApproval,
    region:
      typeof club.region === "string" && club.region.trim().length
        ? club.region
        : countryLabel(club.country_code),
    city: club.city ?? fallback.city,
    members: activeMemberCount,
    totalRaces: aggregate.races,
    totalDistanceKm: aggregate.distanceKm,
    totalElevationM: aggregate.elevationGainM,
    podiums: aggregate.podiums,
    wins: aggregate.wins,
    desc: club.description ?? fallback.desc,
    badges,
    membersList: visibleMembers,
    recentRaces: Array.from(racesByEdition.values()).sort((left, right) => right.date.localeCompare(left.date)),
    leagueParticipations,
    topFinishers: participants
      .filter((participant) => participant.races > 0)
      .sort((left, right) => (
        right.wins - left.wins
        || right.podiums - left.podiums
        || right.races - left.races
        || right.distanceKm - left.distanceKm
        || left.name.localeCompare(right.name)
      ))
      .slice(0, 3)
      .map(enrichMember),
    announcements: announcements.map((announcement) => ({
      title: announcement.title,
      date: format(new Date(announcement.created_at), "MMM d, yyyy"),
      desc: announcement.body,
    })),
  };
}
