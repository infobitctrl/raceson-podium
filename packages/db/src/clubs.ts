import { randomUUID } from "node:crypto";
import type { AccountContext, RequestSession } from "@raceson/domain/auth";
import { countryName } from "@raceson/domain/geography";
import {
  DEFAULT_SPORT_CODE,
  SPORT_DEFINITIONS,
  getSportDefinition,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { loadAccountContextForAccessToken } from "./account.js";
import {
  getCurrentUserClubAccess,
  type ClubAccess,
  type ClubPermission,
} from "./club-access.js";
import { createAdminSupabaseClient, createUserSupabaseClient } from "./supabase.js";

export type CreateCurrentUserClubInput = {
  clubName: string;
  clubHandle: string;
  clubCity: string;
  clubRegion: string;
  clubCountry: string;
  clubPresident: string;
  clubDescription: string;
  clubFoundedYear?: number | null;
  mainSport?: string | null;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  clubType?: string | null;
  officiallyRegistered?: boolean;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  clubTrainingDays?: string[];
  clubHasRegularTraining?: boolean;
  clubTrainingLocation?: string | null;
  clubTrainingNote?: string | null;
  clubPrivacy?: string | null;
  requiresApproval?: boolean;
  clubIconKey?: string | null;
  clubColorKey?: string | null;
  clubLogoUrl?: string | null;
  clubCoverUrl?: string | null;
  idempotencyKey?: string;
};

export type CreateCurrentUserClubResult = {
  clubId: string;
  clubSlug: string;
  account: AccountContext;
};

export type CurrentUserClubManagement = {
  clubId: string;
  clubSlug: string;
  clubName: string;
  clubCity: string;
  clubRegion: string;
  clubCountry: string;
  clubPresident: string;
  clubDescription: string;
  clubFoundedYear: number | null;
  mainSport: string | null;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  clubType: string | null;
  officiallyRegistered: boolean;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  clubTrainingDays: string[];
  clubHasRegularTraining: boolean;
  clubTrainingLocation: string | null;
  clubTrainingNote: string | null;
  clubPrivacy: "public" | "private" | "invite_only";
  requiresApproval: boolean;
  clubIconKey: string;
  clubColorKey: string;
  clubLogoUrl: string | null;
  clubCoverUrl: string | null;
  canManageActivities: boolean;
};

export type UpdateCurrentUserClubInput = Omit<
  CreateCurrentUserClubInput,
  "clubHandle" | "idempotencyKey"
>;

export type ClubMembershipRequest = {
  membershipId: string;
  athleteProfileId: string;
  athleteSlug: string;
  displayName: string;
  location: string | null;
  requestedAt: string;
};

export type ClubMembershipDecision = "approve" | "reject";

type ClubManagementRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  region: string | null;
  country_code: string | null;
  president_name: string | null;
  description: string | null;
  founded_year: number | null;
  main_sport: string | null;
  club_type: string | null;
  officially_registered: boolean | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  training_days: string[] | null;
  has_regular_training: boolean | null;
  training_location: string | null;
  training_note: string | null;
  privacy_level: string | null;
  requires_approval: boolean | null;
  icon_key: string | null;
  color_key: string | null;
  logo_image_url: string | null;
  cover_image_url: string | null;
  created_by_athlete_profile_id: string | null;
};

type CreateClubRpcResult = {
  club_id?: unknown;
  club_slug?: unknown;
} | null;

type UpdateClubRpcResult = {
  club?: ClubManagementRow;
  sport_codes?: unknown;
  primary_sport_code?: unknown;
} | null;

type ClubSportSelection = {
  sportCodes: SportCode[];
  primarySportCode: SportCode;
};

function nullableTrimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function throwMappedClubIdentityError(error: { message?: string | null }): never {
  if (error.message?.includes("club_identity_duplicate")) {
    throw conflict("A matching club already exists. Use the existing club instead of creating a duplicate.");
  }
  throw error;
}

function normalizePrivacy(value: string | null | undefined): "public" | "private" | "invite_only" {
  return value === "private" || value === "invite_only" ? value : "public";
}

function legacyMainSportCode(value: string | null | undefined): SportCode {
  const normalized = value?.trim().toLowerCase() ?? "";
  const exactMatch = SPORT_DEFINITIONS.find(
    (sport) => sport.label.toLowerCase() === normalized || sport.code === normalized,
  );
  if (exactMatch) return exactMatch.code;
  if (normalized.includes("triathlon")) return "triathlon";
  if (normalized.includes("duathlon")) return "duathlon";
  if (normalized.includes("aquathlon")) return "aquathlon";
  if (normalized.includes("swim")) return "swimming";
  if (normalized.includes("mountain") && (normalized.includes("bike") || normalized.includes("cycl"))) {
    return "mountain_biking";
  }
  if (normalized.includes("bike") || normalized.includes("cycl")) return "road_cycling";
  if (normalized.includes("road") && normalized.includes("run")) return "road_running";
  return DEFAULT_SPORT_CODE;
}

function normalizeClubSportSelection(
  input: Pick<CreateCurrentUserClubInput, "mainSport" | "sportCodes" | "primarySportCode">,
): ClubSportSelection {
  const legacySportCode = legacyMainSportCode(input.mainSport);
  return normalizeSportSelection({
    sportCodes: input.sportCodes?.length ? input.sportCodes : [legacySportCode],
    primarySportCode: input.primarySportCode ?? legacySportCode,
  });
}

async function loadClubSportSelection(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  club: Pick<ClubManagementRow, "id" | "main_sport">,
): Promise<ClubSportSelection> {
  const { data, error } = await adminClient
    .from("club_sports")
    .select("sport_code,is_primary")
    .eq("club_id", club.id);

  if (error) throw error;
  const rows = data ?? [];
  const fallbackSportCode = legacyMainSportCode(club.main_sport);
  return normalizeSportSelection({
    sportCodes: rows.length ? rows.map((row) => row.sport_code) : [fallbackSportCode],
    primarySportCode: rows.find((row) => row.is_primary)?.sport_code ?? fallbackSportCode,
  });
}

const CLUB_MEDIA_PUBLIC_PATH = "/storage/v1/object/public/club-media/";

function clubMediaStoragePath(
  value: string | null | undefined,
  expectedOwnerUserId: string,
) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const pathIndex = url.pathname.indexOf(CLUB_MEDIA_PUBLIC_PATH);
    if (pathIndex < 0) return null;
    const storagePath = decodeURIComponent(
      url.pathname.slice(pathIndex + CLUB_MEDIA_PUBLIC_PATH.length),
    );
    if (!storagePath.startsWith(`${expectedOwnerUserId}/`)) return null;
    if (storagePath.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return storagePath;
  } catch {
    return null;
  }
}

async function requireManageableClub(
  session: RequestSession,
  clubSlug: string,
  env: ServerEnv,
  permission: ClubPermission | readonly ClubPermission[] = "club.profile.manage",
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("clubs")
    .select("id,slug,name,city,region,country_code,president_name,description,founded_year,main_sport,club_type,officially_registered,website_url,instagram_url,facebook_url,contact_email,contact_phone,training_days,has_regular_training,training_location,training_note,privacy_level,requires_approval,icon_key,color_key,logo_image_url,cover_image_url,created_by_athlete_profile_id")
    .eq("slug", clubSlug)
    .eq("status", "active")
    .maybeSingle<ClubManagementRow>();

  if (error) throwMappedClubIdentityError(error);
  if (!data) throw notFound("Club not found.");
  const access = await getCurrentUserClubAccess(session, clubSlug, env);
  const acceptedPermissions = Array.isArray(permission) ? permission : [permission];
  if (!acceptedPermissions.some((item) => access.permissions.includes(item))) {
    throw forbidden(`One of these club permissions is required: ${acceptedPermissions.join(", ")}.`);
  }

  return { adminClient, club: data, access };
}

function mapClubManagement(
  club: ClubManagementRow,
  access: ClubAccess,
  sportSelection: ClubSportSelection,
): CurrentUserClubManagement {
  return {
    clubId: club.id,
    clubSlug: club.slug,
    clubName: club.name,
    clubCity: club.city ?? "",
    clubRegion: club.region ?? "",
    clubCountry: club.country_code?.trim().toUpperCase() || "HR",
    clubPresident: club.president_name ?? "",
    clubDescription: club.description ?? "",
    clubFoundedYear: club.founded_year,
    mainSport: club.main_sport,
    sportCodes: sportSelection.sportCodes,
    primarySportCode: sportSelection.primarySportCode,
    clubType: club.club_type,
    officiallyRegistered: Boolean(club.officially_registered),
    websiteUrl: club.website_url,
    instagramUrl: club.instagram_url,
    facebookUrl: club.facebook_url,
    contactEmail: club.contact_email,
    contactPhone: club.contact_phone,
    clubTrainingDays: Array.isArray(club.training_days) ? club.training_days : [],
    clubHasRegularTraining: club.has_regular_training !== false,
    clubTrainingLocation: club.training_location,
    clubTrainingNote: club.training_note,
    clubPrivacy: normalizePrivacy(club.privacy_level),
    requiresApproval: Boolean(club.requires_approval),
    clubIconKey: club.icon_key ?? "mountain",
    clubColorKey: club.color_key ?? "primary",
    clubLogoUrl: club.logo_image_url,
    clubCoverUrl: club.cover_image_url,
    canManageActivities: access.permissions.includes("club.activities.manage"),
  };
}

export async function getCurrentUserClubManagement(
  session: RequestSession,
  clubSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<CurrentUserClubManagement> {
  const { adminClient, club, access } = await requireManageableClub(
    session,
    clubSlug,
    env,
    ["club.profile.manage", "club.settings.manage"],
  );
  const sportSelection = await loadClubSportSelection(adminClient, club);
  return mapClubManagement(club, access, sportSelection);
}

export async function listCurrentUserClubMembershipRequests(
  session: RequestSession,
  clubSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<ClubMembershipRequest[]> {
  const { adminClient, club } = await requireManageableClub(
    session,
    clubSlug,
    env,
    "club.members.manage",
  );
  const { data: memberships, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,athlete_profile_id,created_at")
    .eq("club_id", club.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (membershipError) throw membershipError;
  if (!memberships?.length) return [];

  const athleteProfileIds = memberships.map((membership) => membership.athlete_profile_id);
  const { data: athletes, error: athleteError } = await adminClient
    .from("athlete_profiles")
    .select("id,slug,display_name,city,country_code")
    .in("id", athleteProfileIds);

  if (athleteError) throw athleteError;
  const athleteById = new Map((athletes ?? []).map((athlete) => [athlete.id, athlete]));

  return memberships.flatMap((membership) => {
    const athlete = athleteById.get(membership.athlete_profile_id);
    if (!athlete) return [];
    const location = [athlete.city, countryName(athlete.country_code)]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(", ");

    return [{
      membershipId: membership.id,
      athleteProfileId: membership.athlete_profile_id,
      athleteSlug: athlete.slug,
      displayName: athlete.display_name,
      location: location || null,
      requestedAt: membership.created_at,
    }];
  });
}

export async function decideCurrentUserClubMembershipRequest(
  session: RequestSession,
  clubSlug: string,
  membershipId: string,
  decision: ClubMembershipDecision,
  env: ServerEnv = loadServerEnv(),
) {
  const { adminClient, club } = await requireManageableClub(
    session,
    clubSlug,
    env,
    "club.members.manage",
  );
  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,athlete_profile_id,status")
    .eq("id", membershipId)
    .eq("club_id", club.id)
    .maybeSingle<{ id: string; athlete_profile_id: string; status: string }>();

  if (membershipError) throw membershipError;
  if (!membership || membership.status !== "pending") {
    throw notFound("Pending club membership request not found.");
  }

  let makePrimary = false;
  if (decision === "approve") {
    const { data: primaryMembership, error: primaryMembershipError } = await adminClient
      .from("club_memberships")
      .select("id")
      .eq("athlete_profile_id", membership.athlete_profile_id)
      .eq("status", "active")
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (primaryMembershipError) throw primaryMembershipError;
    makePrimary = !primaryMembership;
  }

  const nextStatus = decision === "approve" ? "active" : "rejected";
  const { data: savedMembership, error: updateError } = await adminClient
    .from("club_memberships")
    .update({
      status: nextStatus,
      is_primary: decision === "approve" ? makePrimary : false,
      joined_at: decision === "approve" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.id)
    .eq("status", "pending")
    .select("id,club_id,athlete_profile_id,status,is_primary,joined_at")
    .maybeSingle();

  if (updateError) throw updateError;
  if (!savedMembership) throw conflict("This club membership request was already reviewed.");

  const { error: auditError } = await adminClient.from("audit_log").insert({
    actor_user_id: session.account.userId,
    entity_type: "club_membership",
    entity_id: savedMembership.id,
    action: decision === "approve" ? "club.membership.approved" : "club.membership.rejected",
    metadata_json: {
      club_id: club.id,
      athlete_profile_id: membership.athlete_profile_id,
    },
  });
  if (auditError) throw auditError;

  return {
    membershipId: savedMembership.id,
    clubId: club.id,
    athleteProfileId: membership.athlete_profile_id,
    status: nextStatus,
    isPrimary: savedMembership.is_primary === true,
    joinedAt: savedMembership.joined_at ?? null,
  };
}

export async function updateCurrentUserClub(
  session: RequestSession,
  clubSlug: string,
  input: UpdateCurrentUserClubInput,
  env: ServerEnv = loadServerEnv(),
): Promise<CurrentUserClubManagement> {
  const { adminClient, club, access } = await requireManageableClub(
    session,
    clubSlug,
    env,
    ["club.profile.manage", "club.settings.manage"],
  );
  const currentSportSelection = await loadClubSportSelection(adminClient, club);
  const nextSportSelection = normalizeSportSelection({
    sportCodes: input.sportCodes ?? currentSportSelection.sportCodes,
    primarySportCode: input.primarySportCode ?? currentSportSelection.primarySportCode,
  });
  const privacyLevel = normalizePrivacy(input.clubPrivacy);
  const profilePayload: Record<string, unknown> = {
    name: input.clubName.trim(),
    country_code: input.clubCountry.trim().toUpperCase(),
    region: nullableTrimmed(input.clubRegion),
    city: nullableTrimmed(input.clubCity),
    description: input.clubDescription.trim(),
    president_name: nullableTrimmed(input.clubPresident),
    founded_year: input.clubFoundedYear ?? null,
    main_sport: getSportDefinition(nextSportSelection.primarySportCode).label,
    club_type: nullableTrimmed(input.clubType),
    officially_registered: input.officiallyRegistered ?? false,
    website_url: nullableTrimmed(input.websiteUrl),
    instagram_url: nullableTrimmed(input.instagramUrl),
    facebook_url: nullableTrimmed(input.facebookUrl),
    contact_email: nullableTrimmed(input.contactEmail),
    contact_phone: nullableTrimmed(input.contactPhone),
    training_days: input.clubTrainingDays ?? [],
    has_regular_training: input.clubHasRegularTraining ?? false,
    training_location: nullableTrimmed(input.clubTrainingLocation),
    training_note: nullableTrimmed(input.clubTrainingNote),
    icon_key: nullableTrimmed(input.clubIconKey) ?? "mountain",
    color_key: nullableTrimmed(input.clubColorKey) ?? "primary",
  };

  if (input.clubLogoUrl !== undefined) {
    profilePayload.logo_image_url = nullableTrimmed(input.clubLogoUrl);
  }
  if (input.clubCoverUrl !== undefined) {
    profilePayload.cover_image_url = nullableTrimmed(input.clubCoverUrl);
  }

  const settingsPayload: Record<string, unknown> = {
    privacy_level: privacyLevel,
    requires_approval: privacyLevel === "invite_only" ? true : input.requiresApproval ?? false,
  };
  const currentProfile: Record<string, unknown> = {
    name: club.name,
    country_code: club.country_code?.trim().toUpperCase() || "HR",
    region: nullableTrimmed(club.region),
    city: nullableTrimmed(club.city),
    description: club.description ?? "",
    president_name: club.president_name ?? "",
    founded_year: club.founded_year,
    main_sport: getSportDefinition(currentSportSelection.primarySportCode).label,
    club_type: nullableTrimmed(club.club_type),
    officially_registered: Boolean(club.officially_registered),
    website_url: nullableTrimmed(club.website_url),
    instagram_url: nullableTrimmed(club.instagram_url),
    facebook_url: nullableTrimmed(club.facebook_url),
    contact_email: nullableTrimmed(club.contact_email),
    contact_phone: nullableTrimmed(club.contact_phone),
    training_days: club.training_days ?? [],
    has_regular_training: club.has_regular_training !== false,
    training_location: nullableTrimmed(club.training_location),
    training_note: nullableTrimmed(club.training_note),
    icon_key: club.icon_key ?? "mountain",
    color_key: club.color_key ?? "primary",
    logo_image_url: club.logo_image_url,
    cover_image_url: club.cover_image_url,
  };
  const currentSettings: Record<string, unknown> = {
    privacy_level: normalizePrivacy(club.privacy_level),
    requires_approval: normalizePrivacy(club.privacy_level) === "invite_only"
      ? true
      : Boolean(club.requires_approval),
  };
  const payloadChanged = (payload: Record<string, unknown>, current: Record<string, unknown>) => (
    Object.entries(payload).some(([key, value]) => (
      Array.isArray(value)
        ? JSON.stringify(value) !== JSON.stringify(current[key] ?? [])
        : value !== current[key]
    ))
  );
  const sportsChanged = (
    JSON.stringify(nextSportSelection.sportCodes) !== JSON.stringify(currentSportSelection.sportCodes)
    || nextSportSelection.primarySportCode !== currentSportSelection.primarySportCode
  );
  const profileChanged = payloadChanged(profilePayload, currentProfile) || sportsChanged;
  const settingsChanged = payloadChanged(settingsPayload, currentSettings);
  if (profileChanged && !access.permissions.includes("club.profile.manage")) {
    throw forbidden("The club.profile.manage club permission is required to edit the public club profile.");
  }
  if (settingsChanged && !access.permissions.includes("club.settings.manage")) {
    throw forbidden("The club.settings.manage club permission is required to change club privacy or membership settings.");
  }

  const { data, error } = await adminClient.rpc("service_update_club_profile_v2", {
    p_actor_user_id: session.account.userId,
    p_club_id: club.id,
    p_profile: profilePayload,
    p_settings: settingsPayload,
    p_selected_sport_codes: nextSportSelection.sportCodes,
    p_selected_primary_sport_code: nextSportSelection.primarySportCode,
    p_profile_changed: profileChanged,
    p_settings_changed: settingsChanged,
  });

  if (error) throwMappedClubIdentityError(error);
  const result = (data as UpdateClubRpcResult) ?? null;
  const updatedClub = result?.club;
  if (!updatedClub?.id) {
    throw new Error("Club update did not return the updated club details.");
  }

  const replacedStoragePaths = [
    input.clubLogoUrl !== undefined && updatedClub.logo_image_url !== club.logo_image_url
      ? clubMediaStoragePath(club.logo_image_url, session.account.userId)
      : null,
    input.clubCoverUrl !== undefined && updatedClub.cover_image_url !== club.cover_image_url
      ? clubMediaStoragePath(club.cover_image_url, session.account.userId)
      : null,
  ].filter((path): path is string => Boolean(path));

  if (replacedStoragePaths.length) {
    await adminClient.storage.from("club-media").remove(replacedStoragePaths).catch(() => undefined);
  }

  return mapClubManagement(updatedClub, access, nextSportSelection);
}

export async function createCurrentUserClub(
  session: RequestSession,
  input: CreateCurrentUserClubInput,
  env: ServerEnv = loadServerEnv(),
): Promise<CreateCurrentUserClubResult> {
  if (!session.account.primaryAthleteProfileId) {
    throw badRequest("This account needs an athlete profile before creating a club.");
  }

  const sportSelection = normalizeClubSportSelection(input);
  const userClient = createUserSupabaseClient(session.accessToken, env);
  const { data, error } = await userClient.rpc("create_current_user_club_v3", {
    club_slug: input.clubHandle.trim(),
    club_name: input.clubName.trim(),
    club_country_code: input.clubCountry.trim().toUpperCase(),
    club_city: input.clubCity.trim(),
    club_region: nullableTrimmed(input.clubRegion),
    club_description: input.clubDescription.trim(),
    president_name: nullableTrimmed(input.clubPresident),
    selected_sport_codes: sportSelection.sportCodes,
    selected_primary_sport_code: sportSelection.primarySportCode,
    creation_idempotency_key: input.idempotencyKey ?? randomUUID(),
    founded_year: input.clubFoundedYear ?? null,
    club_type: nullableTrimmed(input.clubType),
    officially_registered: input.officiallyRegistered ?? false,
    website_url: nullableTrimmed(input.websiteUrl),
    instagram_url: nullableTrimmed(input.instagramUrl),
    facebook_url: nullableTrimmed(input.facebookUrl),
    contact_email: nullableTrimmed(input.contactEmail),
    contact_phone: nullableTrimmed(input.contactPhone),
    training_days: input.clubTrainingDays ?? [],
    has_regular_training: input.clubHasRegularTraining ?? true,
    training_location: nullableTrimmed(input.clubTrainingLocation),
    training_note: nullableTrimmed(input.clubTrainingNote),
    privacy_level: nullableTrimmed(input.clubPrivacy) ?? "public",
    requires_approval: input.requiresApproval ?? false,
    icon_key: nullableTrimmed(input.clubIconKey) ?? "mountain",
    color_key: nullableTrimmed(input.clubColorKey) ?? "primary",
    logo_image_url: nullableTrimmed(input.clubLogoUrl),
    cover_image_url: nullableTrimmed(input.clubCoverUrl),
  });

  if (error) {
    throwMappedClubIdentityError(error);
  }

  const payload = (data as CreateClubRpcResult) ?? null;
  const clubId = typeof payload?.club_id === "string" ? payload.club_id : null;
  const clubSlug = typeof payload?.club_slug === "string" ? payload.club_slug : null;

  if (!clubId || !clubSlug) {
    throw new Error("Club creation did not return the new club details.");
  }

  const nextAccount = await loadAccountContextForAccessToken(session.accessToken, env);

  return {
    clubId,
    clubSlug,
    account: nextAccount,
  };
}
