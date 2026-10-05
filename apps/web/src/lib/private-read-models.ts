import { format, formatDistanceToNowStrict, isAfter, isBefore, startOfDay } from "date-fns";
import { apiRequest } from "@/lib/api";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { resolveCurrentUserAccountContext } from "@/lib/auth";
import { buildClubParticipationSummaries } from "@/features/clubs/model/clubParticipationSummary";
import {
  buildCanonicalClubIdBySource,
  canonicalClubId,
  selectCurrentClubMemberships,
} from "@/features/clubs/model/clubIdentity";
import { getTrackGalleryPreviewImageUrl } from "@/shared/media/eventPreviewImage";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import { countryName } from "@/shared/domain/countries";

export type AthleteRegistrationItem = {
  id: string;
  categoryId: string;
  categorySlug: string;
  eventSlug: string;
  event: string;
  eventImageUrl?: string | null;
  linkedTrackImageUrl?: string | null;
  category: string;
  date: string;
  location: string;
  status:
    | "confirmed"
    | "pending"
    | "waitlisted"
    | "offered"
    | "completed"
    | "dns"
    | "cancelled"
    | "expired";
  registrationStatus?: string;
  paymentStatus?: string;
  canPay?: boolean;
  bib: number | null;
  paid: boolean;
  place: number | null;
  paymentEvidenceCount: number;
};

export type AthleteRegistrationsReadModel = {
  displayName: string;
  upcoming: AthleteRegistrationItem[];
  past: AthleteRegistrationItem[];
};

export type AthleteClubMembershipItem = {
  clubId: string;
  clubSlug: string;
  name: string;
  location: string;
  memberSince: string;
  role: string;
  members: number;
  events: number;
  ranking: number | null;
  recentEvents: string[];
  recentEventPreviews?: Array<{
    eventSlug: string;
    name: string;
    eventImageUrl: string | null;
    linkedTrackImageUrl: string | null;
  }>;
  canEdit: boolean;
  isPrimary: boolean;
  roleKey: string;
  permissions: string[];
};

export type AthleteSuggestedClubItem = {
  clubSlug: string;
  name: string;
  location: string;
  members: number;
  events: number;
  specialty: string;
};

export type AthleteClubsReadModel = {
  memberships: AthleteClubMembershipItem[];
  suggested: AthleteSuggestedClubItem[];
};

export type AthleteRegistrationClubOption = {
  clubId: string;
  clubSlug: string;
  name: string;
  isPrimary: boolean;
  role: string;
};

export type AthleteDashboardReadModel = {
  displayName: string;
  nextRaceLabel: string;
  publicProfileSlug: string;
  upcomingRegistrations: Array<{
    event: string;
    category: string;
    date: string;
    status: "confirmed" | "pending";
    bib: number | null;
  }>;
  recentResults: Array<{
    event: string;
    place: number;
    time: string;
    points: number;
  }>;
  stats: {
    upcomingCount: number;
    seasonRaces: number;
    leagueRankLabel: string;
  };
};

export type OrganizerDashboardReadModel = {
  organizationName: string;
  activeEvents: number;
  totalRegistrations: number;
  checkedIn: number;
  publishedResults: number;
  ownedTracks: number;
  ownedLeagueSeasons: number;
  eventsPendingPublish: number;
  tracksPendingPublish: number;
  leagueSeasonsPendingPublish: number;
  upcomingEvents: Array<{
    id: string;
    slug: string;
    name: string;
    date: string;
    registrations: number;
    capacity: number;
    checkedIn: number;
    status: "prep" | "live" | "completed";
    isPublic: boolean;
    publishedAt: string | null;
    coverImageUrl?: string | null;
    linkedTrackImageUrl?: string | null;
  }>;
  finishedEvents: Array<{
    id: string;
    slug: string;
    name: string;
    date: string;
    registrations: number;
    capacity: number;
    checkedIn: number;
    status: "prep" | "live" | "completed";
    isPublic: boolean;
    publishedAt: string | null;
    coverImageUrl?: string | null;
    linkedTrackImageUrl?: string | null;
  }>;
  recentActivity: Array<{
    text: string;
    time: string;
  }>;
  staff: Array<{
    name: string;
    role: string;
  }>;
};

const fallbackAthleteRegistrations: AthleteRegistrationsReadModel = {
  displayName: "",
  upcoming: [],
  past: [],
};

const fallbackAthleteClubs: AthleteClubsReadModel = {
  memberships: [],
  suggested: [],
};

const fallbackAthleteDashboard: AthleteDashboardReadModel = {
  displayName: "",
  nextRaceLabel: "No upcoming race yet",
  publicProfileSlug: "",
  upcomingRegistrations: [],
  recentResults: [],
  stats: {
    upcomingCount: 0,
    seasonRaces: 0,
    leagueRankLabel: "TBA",
  },
};

const fallbackOrganizerDashboard: OrganizerDashboardReadModel = {
  organizationName: "Organization",
  activeEvents: 0,
  totalRegistrations: 0,
  checkedIn: 0,
  publishedResults: 0,
  ownedTracks: 0,
  ownedLeagueSeasons: 0,
  eventsPendingPublish: 0,
  tracksPendingPublish: 0,
  leagueSeasonsPendingPublish: 0,
  upcomingEvents: [],
  finishedEvents: [],
  recentActivity: [],
  staff: [],
};

export function getFallbackAthleteRegistrationsReadModel() {
  return fallbackAthleteRegistrations;
}

export function getFallbackAthleteClubsReadModel() {
  return fallbackAthleteClubs;
}

export function getFallbackAthleteDashboardReadModel() {
  return fallbackAthleteDashboard;
}

export function getFallbackOrganizerDashboardReadModel() {
  return fallbackOrganizerDashboard;
}

function countryLabel(countryCode: string | null | undefined) {
  return countryName(countryCode, "Region");
}

function clubRoleLabel(roleKey: string) {
  return roleKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Member";
}

const allClubManagementPermissions = [
  "club.profile.manage", "club.settings.manage", "club.members.view",
  "club.members.manage", "club.roles.manage", "club.activities.manage",
  "club.content.manage", "club.analytics.view", "club.audit.view",
];

const builtInClubPermissionsByRole: Record<string, string[]> = {
  owner: allClubManagementPermissions,
  administrator: allClubManagementPermissions,
  "membership-manager": ["club.members.view", "club.members.manage", "club.analytics.view"],
  "activities-manager": ["club.members.view", "club.activities.manage"],
  "content-manager": ["club.profile.manage", "club.content.manage"],
  member: [],
};

function isMissingMergedClubColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703"
    || candidate.code === "PGRST204"
    || (typeof candidate.message === "string" && candidate.message.includes("merged_into_club_id"));
}

async function resolveCurrentAthlete() {
  const account = await resolveCurrentUserAccountContext();
  if (!account?.primaryAthleteProfileId) return null;

  return {
    id: account.primaryAthleteProfileId,
    slug: account.primaryAthleteSlug ?? "",
    display_name: account.displayName,
    country_code: account.countryCode,
    city: account.city,
    accountDisplayName: account.displayName,
  };
}

export async function getAthleteRegistrationsReadModel(): Promise<AthleteRegistrationsReadModel> {
  const account = await resolveCurrentUserAccountContext();
  if (!account?.hasAthleteAccess) return fallbackAthleteRegistrations;

  return apiRequest<AthleteRegistrationsReadModel>({
    path: "/v1/me/registrations",
  });
}

export async function getAthleteClubsReadModel(): Promise<AthleteClubsReadModel> {
  const client = getSupabaseBrowserClient();
  const athlete = await resolveCurrentAthlete();
  if (!client || !athlete) return fallbackAthleteClubs;

  const { data: rawMemberships, error } = await client
    .from("club_memberships")
    .select("club_id,athlete_profile_id,club_role_id,membership_role,status,is_primary,membership_origin,joined_at")
    .eq("athlete_profile_id", athlete.id)
    .eq("status", "active");

  if (error || !rawMemberships?.length) {
    return {
      memberships: [],
      suggested: fallbackAthleteClubs.suggested,
    };
  }

  const clubIdentityRows: Array<{
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country_code: string | null;
    description: string | null;
    created_by_athlete_profile_id: string | null;
    status: string;
    merged_into_club_id: string | null;
  }> = [];
  const loadedClubIds = new Set<string>();
  let pendingClubIds = Array.from(new Set(rawMemberships.map((membership) => membership.club_id)));

  while (pendingClubIds.length) {
    const clubIdentityResult = await client
      .from("clubs")
      .select("id,slug,name,city,country_code,description,created_by_athlete_profile_id,status,merged_into_club_id")
      .in("id", pendingClubIds);
    const compatibleClubResult = clubIdentityResult.error && isMissingMergedClubColumn(clubIdentityResult.error)
      ? await client
          .from("clubs")
          .select("id,slug,name,city,country_code,description,created_by_athlete_profile_id,status")
          .in("id", pendingClubIds)
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
    pendingClubIds = Array.from(new Set(
      loadedRows
        .map((club) => club.merged_into_club_id)
        .filter((clubId): clubId is string => Boolean(clubId) && !loadedClubIds.has(clubId)),
    ));
  }

  const preliminaryCanonicalIds = buildCanonicalClubIdBySource(clubIdentityRows);
  const canonicalMembershipClubIds = Array.from(new Set(
    rawMemberships.map((membership) => canonicalClubId(membership.club_id, preliminaryCanonicalIds)),
  ));
  const mergedFamilyResult = await client
    .from("clubs")
    .select("id,slug,name,city,country_code,description,created_by_athlete_profile_id,status,merged_into_club_id")
    .in("merged_into_club_id", canonicalMembershipClubIds);
  if (mergedFamilyResult.error && !isMissingMergedClubColumn(mergedFamilyResult.error)) {
    throw mergedFamilyResult.error;
  }
  for (const club of mergedFamilyResult.error ? [] : (mergedFamilyResult.data ?? [])) {
    if (loadedClubIds.has(club.id)) continue;
    loadedClubIds.add(club.id);
    clubIdentityRows.push(club);
  }

  const canonicalClubIdBySource = buildCanonicalClubIdBySource(clubIdentityRows);
  const activeClubIds = new Set(
    clubIdentityRows.filter((club) => club.status === "active").map((club) => club.id),
  );
  const memberships = selectCurrentClubMemberships(
    rawMemberships,
    canonicalClubIdBySource,
    { includeRepresented: true },
  )
    .filter((membership) => activeClubIds.has(membership.club_id));
  const membershipClubIds = Array.from(new Set(memberships.map((membership) => membership.club_id)));
  const membershipFamilyIds = Array.from(new Set(
    clubIdentityRows
      .filter((club) => membershipClubIds.includes(canonicalClubId(club.id, canonicalClubIdBySource)))
      .map((club) => club.id),
  ));

  const roleIds = Array.from(new Set(
    memberships
      .map((membership) => membership.club_role_id)
      .filter((roleId): roleId is string => Boolean(roleId)),
  ));
  const [standingsResult, suggestedClubPoolResult, rolesResult] = await Promise.all([
    membershipFamilyIds.length
      ? client.from("league_club_standings").select("club_id,rank_overall").in("club_id", membershipFamilyIds)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("clubs")
      .select("id,slug,name,city,country_code,description")
      .eq("status", "active")
      .limit(12),
    roleIds.length
      ? client
          .from("club_roles")
          .select("id,role_key,name,permission_keys")
          .in("id", roleIds)
          .eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (standingsResult.error) throw standingsResult.error;
  if (suggestedClubPoolResult.error) throw suggestedClubPoolResult.error;
  if (rolesResult.error) throw rolesResult.error;

  const standings = standingsResult.data ?? [];
  const suggestedClubs = (suggestedClubPoolResult.data ?? [])
    .filter((club) => !membershipClubIds.includes(club.id))
    .slice(0, 3);
  const relevantClubIds = Array.from(new Set([
    ...membershipFamilyIds,
    ...suggestedClubs.map((club) => club.id),
  ]));
  const summaryClubIds = Array.from(new Set([
    ...membershipClubIds,
    ...suggestedClubs.map((club) => club.id),
  ]));
  const [activeClubMembershipsResult, clubResultRows] = await Promise.all([
    client
      .from("club_memberships")
      .select("club_id,athlete_profile_id,status,membership_origin")
      .in("club_id", relevantClubIds)
      .eq("status", "active"),
    getCurrentPublishedResultRows({ representedClubIds: relevantClubIds }),
  ]);
  if (activeClubMembershipsResult.error) throw activeClubMembershipsResult.error;

  const resultCategoryIds = Array.from(new Set(clubResultRows.map((row) => row.eventCategoryId)));
  let clubEventCategories: Array<{ id: string; event_edition_id: string }> = [];
  let clubEventSnapshots: Array<{
    event_category_id: string;
    track_template_id: string;
    created_at: string;
  }> = [];
  if (resultCategoryIds.length) {
    const [categoriesResult, snapshotsResult] = await Promise.all([
      client
        .from("event_categories")
        .select("id,event_edition_id")
        .in("id", resultCategoryIds),
      client
        .from("event_category_track_snapshots")
        .select("event_category_id,track_template_id,created_at")
        .in("event_category_id", resultCategoryIds)
        .order("created_at", { ascending: false }),
    ]);
    if (categoriesResult.error) throw categoriesResult.error;
    if (snapshotsResult.error) throw snapshotsResult.error;
    clubEventCategories = categoriesResult.data ?? [];
    clubEventSnapshots = snapshotsResult.data ?? [];
  }

  const editionIds = Array.from(new Set(clubEventCategories.map((category) => category.event_edition_id)));
  const clubTrackTemplateIds = Array.from(new Set(
    clubEventSnapshots.map((snapshot) => snapshot.track_template_id).filter(Boolean),
  ));
  const [editionsResult, trackTemplatesResult] = await Promise.all([
    editionIds.length
      ? client
          .from("event_editions")
          .select("id,slug,name,start_date,cover_image_url")
          .in("id", editionIds)
      : Promise.resolve({ data: [], error: null }),
    clubTrackTemplateIds.length
      ? client
          .from("track_templates")
          .select("id,gallery_preview_image_url")
          .in("id", clubTrackTemplateIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (editionsResult.error) throw editionsResult.error;
  if (trackTemplatesResult.error) throw trackTemplatesResult.error;
  const clubEventEditions = editionsResult.data ?? [];
  const clubEventEditionByName = new Map(
    clubEventEditions.map((edition) => [edition.name, edition]),
  );
  const clubTrackImageByTemplateId = new Map(
    (trackTemplatesResult.data ?? []).map((track) => [
      track.id,
      getTrackGalleryPreviewImageUrl(track.gallery_preview_image_url),
    ]),
  );
  const latestTrackTemplateIdByClubCategory = new Map<string, string>();
  for (const snapshot of clubEventSnapshots) {
    if (!latestTrackTemplateIdByClubCategory.has(snapshot.event_category_id)) {
      latestTrackTemplateIdByClubCategory.set(snapshot.event_category_id, snapshot.track_template_id);
    }
  }
  const linkedTrackImageByClubEditionId = new Map<string, string>();
  for (const category of clubEventCategories) {
    if (linkedTrackImageByClubEditionId.has(category.event_edition_id)) continue;
    const templateId = latestTrackTemplateIdByClubCategory.get(category.id);
    const imageUrl = templateId ? clubTrackImageByTemplateId.get(templateId) : null;
    if (imageUrl) linkedTrackImageByClubEditionId.set(category.event_edition_id, imageUrl);
  }

  const participationByClubId = buildClubParticipationSummaries({
    clubIds: summaryClubIds,
    memberships: (activeClubMembershipsResult.data ?? []).map((membership) => ({
      clubId: canonicalClubId(membership.club_id, canonicalClubIdBySource),
      athleteProfileId: membership.athlete_profile_id,
      status: membership.status,
      membershipOrigin: membership.membership_origin,
    })),
    resultRows: clubResultRows.map((row) => ({
      id: row.resultRowId,
      athleteProfileId: row.athleteProfileId,
      representedClubId: row.representedClubId
        ? canonicalClubId(row.representedClubId, canonicalClubIdBySource)
        : null,
      eventCategoryId: row.eventCategoryId,
      resultRunId: row.resultRunId,
      resultStatus: row.resultStatus,
      finishTimeMs: row.finishTimeMs,
    })),
    publications: clubResultRows.map((row) => ({
      id: row.publicationId,
      eventCategoryId: row.eventCategoryId,
      resultRunId: row.resultRunId,
      publicationState: row.publicationState,
      publishedAt: row.publishedAt,
      createdAt: row.publishedAt,
    })),
    categories: clubEventCategories.map((category) => ({
      id: category.id,
      eventEditionId: category.event_edition_id,
    })),
    editions: clubEventEditions.map((edition) => ({
      id: edition.id,
      name: edition.name,
      startDate: edition.start_date,
    })),
  });

  const clubById = new Map(
    clubIdentityRows.filter((club) => club.status === "active").map((club) => [club.id, club]),
  );
  const rankingByClubId = new Map<string, number | null>();
  const roleById = new Map(
    (rolesResult.data ?? []).map((role) => [role.id, role]),
  );
  for (const standing of standings) {
    const resolvedClubId = canonicalClubId(standing.club_id, canonicalClubIdBySource);
    const currentRank = rankingByClubId.get(resolvedClubId);
    if (
      currentRank == null
      || (standing.rank_overall != null && standing.rank_overall < currentRank)
    ) {
      rankingByClubId.set(resolvedClubId, standing.rank_overall);
    }
  }

  const activeMemberships = memberships.map((membership) => {
    const club = clubById.get(membership.club_id);
    const participation = participationByClubId.get(membership.club_id);
    const role = roleById.get(membership.club_role_id);
    const permissions = Array.isArray(role?.permission_keys)
      ? role.permission_keys.filter((permission): permission is string => typeof permission === "string")
      : builtInClubPermissionsByRole[membership.membership_role]
        ?? (membership.membership_role === "member" ? [] : allClubManagementPermissions);
    return {
      clubId: membership.club_id,
      clubSlug: club?.slug ?? "clubs",
      name: club?.name ?? "Trail Club",
      location: `${club?.city ?? "Croatia"}, ${countryLabel(club?.country_code)}`,
      memberSince: membership.joined_at ? format(new Date(membership.joined_at), "yyyy") : "Recent",
      role: role?.name ?? clubRoleLabel(membership.membership_role),
      members: participation?.members ?? 0,
      events: participation?.events ?? 0,
      ranking: rankingByClubId.get(membership.club_id) ?? null,
      recentEvents: participation?.recentEvents ?? [],
      recentEventPreviews: (participation?.recentEvents ?? []).flatMap((eventName) => {
        const edition = clubEventEditionByName.get(eventName);
        if (!edition) return [];
        return [{
          eventSlug: edition.slug,
          name: edition.name,
          eventImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
          linkedTrackImageUrl: linkedTrackImageByClubEditionId.get(edition.id) ?? null,
        }];
      }),
      canEdit: membership.membership_role !== "member",
      isPrimary: Boolean(membership.is_primary),
      roleKey: role?.role_key ?? membership.membership_role,
      permissions,
    } satisfies AthleteClubMembershipItem;
  }).sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));

  return {
    memberships: activeMemberships,
    suggested: (suggestedClubs ?? []).map((club) => {
      const participation = participationByClubId.get(club.id);
      return {
        clubSlug: club.slug,
        name: club.name,
        location: `${club.city ?? "Croatia"}, ${countryLabel(club.country_code)}`,
        members: participation?.members ?? 0,
        events: participation?.events ?? 0,
        specialty: club.description ?? "Trail Running",
      } satisfies AthleteSuggestedClubItem;
    }),
  };
}

export async function setAthletePrimaryClub(clubId: string) {
  return apiRequest<{ clubId: string; changed: boolean }>({
    path: `/v1/me/clubs/${encodeURIComponent(clubId)}/default`,
    method: "POST",
  });
}

export async function getAthleteRegistrationClubOptions(): Promise<AthleteRegistrationClubOption[]> {
  const client = getSupabaseBrowserClient();
  const athlete = await resolveCurrentAthlete();
  if (!client || !athlete) return [];

  const { data: memberships, error } = await client
    .from("club_memberships")
    .select("club_id,membership_role,is_primary,joined_at")
    .eq("athlete_profile_id", athlete.id)
    .eq("status", "active")
    .order("is_primary", { ascending: false })
    .order("joined_at", { ascending: true, nullsFirst: false });

  if (error || !memberships?.length) {
    if (error) console.warn("Unable to load athlete club representation options", error);
    return [];
  }

  const clubIdentityRows: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    merged_into_club_id: string | null;
  }> = [];
  const loadedClubIds = new Set<string>();
  let pendingClubIds = Array.from(new Set(memberships.map((membership) => membership.club_id)));

  while (pendingClubIds.length) {
    const identityResult = await client
      .from("clubs")
      .select("id,slug,name,status,merged_into_club_id")
      .in("id", pendingClubIds);
    const compatibleResult = identityResult.error && isMissingMergedClubColumn(identityResult.error)
      ? await client.from("clubs").select("id,slug,name,status").in("id", pendingClubIds)
      : null;
    if (compatibleResult?.error) {
      console.warn("Unable to load athlete club records", compatibleResult.error);
      return [];
    }
    if (identityResult.error && !isMissingMergedClubColumn(identityResult.error)) {
      console.warn("Unable to load athlete club records", identityResult.error);
      return [];
    }

    const loadedRows = compatibleResult
      ? (compatibleResult.data ?? []).map((club) => ({ ...club, merged_into_club_id: null }))
      : (identityResult.data ?? []);
    for (const club of loadedRows) {
      if (loadedClubIds.has(club.id)) continue;
      loadedClubIds.add(club.id);
      clubIdentityRows.push(club);
    }
    pendingClubIds = Array.from(new Set(
      loadedRows
        .map((club) => club.merged_into_club_id)
        .filter((clubId): clubId is string => Boolean(clubId) && !loadedClubIds.has(clubId)),
    ));
  }

  if (!clubIdentityRows.length) {
    return [];
  }

  const canonicalClubIdBySource = buildCanonicalClubIdBySource(clubIdentityRows);
  const clubById = new Map(
    clubIdentityRows.filter((club) => club.status === "active").map((club) => [club.id, club]),
  );
  const includedClubIds = new Set<string>();

  return memberships.flatMap((membership) => {
    const resolvedClubId = canonicalClubId(membership.club_id, canonicalClubIdBySource);
    const club = clubById.get(resolvedClubId);
    if (!club || includedClubIds.has(resolvedClubId)) return [];
    includedClubIds.add(resolvedClubId);

    return [{
      clubId: club.id,
      clubSlug: club.slug,
      name: club.name,
      isPrimary: Boolean(membership.is_primary),
      role: membership.membership_role === "member" ? "Member" : membership.membership_role,
    } satisfies AthleteRegistrationClubOption];
  });
}

export async function getAthleteDashboardReadModel(): Promise<AthleteDashboardReadModel> {
  const account = await resolveCurrentUserAccountContext();
  if (!account?.hasAthleteAccess) return fallbackAthleteDashboard;

  return apiRequest<AthleteDashboardReadModel>({
    path: "/v1/me/dashboard",
  });
}

export async function getOrganizerDashboardReadModel(
  scopedAccount?: Awaited<ReturnType<typeof resolveCurrentUserAccountContext>>,
): Promise<OrganizerDashboardReadModel> {
  const account = scopedAccount ?? await resolveCurrentUserAccountContext();
  if (account?.hasOrganizerAccess) {
    return apiRequest<OrganizerDashboardReadModel>({
      path: `/v1/organizer/dashboard${account.organizationIds[0] ? `?organization=${encodeURIComponent(account.organizationIds[0])}` : ""}`,
    });
  }

  const client = getSupabaseBrowserClient();
  if (!client || !account?.organizationIds.length) return fallbackOrganizerDashboard;

  const organizationId = account.organizationIds[0];
  const organizationName = account.organizationNames[0] ?? "Organization";

  const { data: series } = await client
    .from("event_series")
    .select("id")
    .eq("organization_id", organizationId);

  const seriesIds = (series ?? []).map((item) => item.id);
  const { data: editions } = seriesIds.length
      ? await client
        .from("event_editions")
        .select("id,slug,name,start_date,status,published_at,cover_image_url")
        .in("event_series_id", seriesIds)
        .order("start_date", { ascending: true })
    : { data: [] };

  const editionIds = (editions ?? []).map((edition) => edition.id);
  const { data: categories } = editionIds.length
    ? await client
        .from("event_categories")
        .select("id,event_edition_id,capacity")
        .in("event_edition_id", editionIds)
    : { data: [] };

  const { data: leagues } = await client
    .from("leagues")
    .select("id")
    .eq("organization_id", organizationId);

  const categoryIds = (categories ?? []).map((category) => category.id);
  const [registrationsResponse, checkinsResponse, publicationsResponse, membershipsResponse, trackTemplatesResponse, trackSnapshotsResponse, leagueSeasonsResponse] = await Promise.all([
    categoryIds.length
      ? client
          .from("registrations")
          .select("id,event_category_id,created_at")
          .in("event_category_id", categoryIds)
      : Promise.resolve({ data: [] }),
    categoryIds.length
      ? client
          .from("checkins")
          .select("registration_id,checked_in_at")
      : Promise.resolve({ data: [] }),
    categoryIds.length
      ? client
          .from("result_publications")
          .select("event_category_id,published_at,publication_state")
          .in("event_category_id", categoryIds)
          .order("published_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    client
      .from("organization_memberships")
      .select("user_id,role")
      .eq("organization_id", organizationId)
      .eq("status", "active"),
    client
      .from("track_templates")
      .select("id,gallery_preview_image_url")
      .eq("organization_id", organizationId),
    categoryIds.length
      ? client
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id,created_at")
          .in("event_category_id", categoryIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    (leagues ?? []).length
      ? client
          .from("league_seasons")
          .select("id,published_at")
          .in("league_id", (leagues ?? []).map((league) => league.id))
      : Promise.resolve({ data: [] }),
  ]);

  const categoryById = new Map((categories ?? []).map((category) => [category.id, category]));
  const editionById = new Map((editions ?? []).map((edition) => [edition.id, edition]));
  const registrationsByEditionId = new Map<string, number>();
  const capacityByEditionId = new Map<string, number>();
  const registrationIds = new Set<string>();

  for (const category of categories ?? []) {
    capacityByEditionId.set(
      category.event_edition_id,
      (capacityByEditionId.get(category.event_edition_id) ?? 0) + (category.capacity ?? 0),
    );
  }

  for (const registration of registrationsResponse.data ?? []) {
    registrationIds.add(registration.id);
    const category = categoryById.get(registration.event_category_id);
    if (!category) continue;
    registrationsByEditionId.set(
      category.event_edition_id,
      (registrationsByEditionId.get(category.event_edition_id) ?? 0) + 1,
    );
  }

  const checkedInCount = (checkinsResponse.data ?? []).filter((checkin) => registrationIds.has(checkin.registration_id)).length;
  const publicationCount = (publicationsResponse.data ?? []).length;
  const trackTemplateIds = (trackTemplatesResponse.data ?? []).map((track) => track.id);
  const trackImageByTemplateId = new Map(
    (trackTemplatesResponse.data ?? []).map((track) => [
      track.id,
      getTrackGalleryPreviewImageUrl(track.gallery_preview_image_url),
    ]),
  );
  const latestTrackTemplateIdByCategory = new Map<string, string>();
  for (const snapshot of trackSnapshotsResponse.data ?? []) {
    if (!latestTrackTemplateIdByCategory.has(snapshot.event_category_id)) {
      latestTrackTemplateIdByCategory.set(snapshot.event_category_id, snapshot.track_template_id);
    }
  }
  const linkedTrackImageByEditionId = new Map<string, string>();
  for (const category of categories ?? []) {
    if (linkedTrackImageByEditionId.has(category.event_edition_id)) continue;
    const templateId = latestTrackTemplateIdByCategory.get(category.id);
    const imageUrl = templateId ? trackImageByTemplateId.get(templateId) : null;
    if (imageUrl) linkedTrackImageByEditionId.set(category.event_edition_id, imageUrl);
  }
  const { data: trackVersions } = trackTemplateIds.length
    ? await client
        .from("track_versions")
        .select("track_template_id,published_at")
        .in("track_template_id", trackTemplateIds)
    : { data: [] };
  const publishedTrackTemplateIds = new Set(
    (trackVersions ?? [])
      .filter((version) => version.published_at)
      .map((version) => version.track_template_id),
  );
  const eventsPendingPublish = (editions ?? []).filter(
    (edition) => !edition.published_at || edition.status === "draft",
  ).length;
  const tracksPendingPublish = Math.max(trackTemplateIds.length - publishedTrackTemplateIds.size, 0);
  const leagueSeasonsPendingPublish = (leagueSeasonsResponse.data ?? []).filter((season) => !season.published_at).length;
  const upcomingEvents = (editions ?? [])
    .filter((edition) => isAfter(new Date(`${edition.start_date}T00:00:00`), startOfDay(new Date())))
    .slice(0, 3)
    .map((edition) => ({
      id: edition.id,
      slug: edition.slug,
      name: edition.name,
      date: format(new Date(`${edition.start_date}T00:00:00`), "MMM d"),
      registrations: registrationsByEditionId.get(edition.id) ?? 0,
      capacity: capacityByEditionId.get(edition.id) ?? 0,
      checkedIn: 0,
      status: "prep" as const,
      isPublic: Boolean(edition.published_at && edition.status !== "draft"),
      publishedAt: edition.published_at ?? null,
      coverImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
      linkedTrackImageUrl: linkedTrackImageByEditionId.get(edition.id) ?? null,
    }));
  const finishedEvents = (editions ?? [])
    .filter(
      (edition) =>
        edition.status === "completed"
        || edition.status === "archived"
        || isBefore(new Date(`${edition.start_date}T00:00:00`), startOfDay(new Date())),
    )
    .sort((left, right) => right.start_date.localeCompare(left.start_date))
    .slice(0, 4)
    .map((edition) => ({
      id: edition.id,
      slug: edition.slug,
      name: edition.name,
      date: format(new Date(`${edition.start_date}T00:00:00`), "MMM d"),
      registrations: registrationsByEditionId.get(edition.id) ?? 0,
      capacity: capacityByEditionId.get(edition.id) ?? 0,
      checkedIn: 0,
      status: "completed" as const,
      isPublic: Boolean(edition.published_at && edition.status !== "draft"),
      publishedAt: edition.published_at ?? null,
      coverImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
      linkedTrackImageUrl: linkedTrackImageByEditionId.get(edition.id) ?? null,
    }));

  const recentActivity = [
    ...(eventsPendingPublish > 0
      ? [{ text: `${eventsPendingPublish} races still need publish`, time: "publish queue" }]
      : []),
    ...(upcomingEvents[0]
      ? [{ text: `Registration flow active for ${upcomingEvents[0].name}`, time: "live" }]
      : []),
    ...(publicationsResponse.data ?? [])
      .slice(0, 2)
      .map((publication) => {
        const category = categoryById.get(publication.event_category_id);
        const edition = category?.event_edition_id ? editionById.get(category.event_edition_id) : undefined;
        return {
          text: `${publication.publication_state} results published for ${edition?.name ?? "event"}`,
          time: publication.published_at ? formatDistanceToNowStrict(new Date(publication.published_at), { addSuffix: true }) : "recently",
        };
      }),
  ].slice(0, 5);

  const currentUserId = account.userId;
  const staff = (membershipsResponse.data ?? []).map((membership) => ({
    name: membership.user_id === currentUserId ? "You" : membership.role === "timer" ? "Timer" : "Staff",
    role: membership.role,
  }));

  return {
    organizationName,
    activeEvents: upcomingEvents.length,
    totalRegistrations: (registrationsResponse.data ?? []).length,
    checkedIn: checkedInCount,
    publishedResults: publicationCount,
    ownedTracks: trackTemplateIds.length,
    ownedLeagueSeasons: (leagueSeasonsResponse.data ?? []).length,
    eventsPendingPublish,
    tracksPendingPublish,
    leagueSeasonsPendingPublish,
    upcomingEvents: upcomingEvents.length ? upcomingEvents : fallbackOrganizerDashboard.upcomingEvents,
    finishedEvents,
    recentActivity: recentActivity.length ? recentActivity : fallbackOrganizerDashboard.recentActivity,
    staff: staff.length ? staff : fallbackOrganizerDashboard.staff,
  };
}
