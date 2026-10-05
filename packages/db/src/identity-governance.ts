import type { RequestSession } from "@raceson/domain/auth";
import { countryName } from "@raceson/domain/geography";
import {
  consumePublicAuthRateLimit,
  logAuthSecurityEvent,
  normalizeEmailAddress,
  resolveAuthRedirectUrl,
} from "./auth-security.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId } from "./permissions.js";
import { hasPlatformCapability, requirePlatformCapability } from "./platform-capabilities.js";
import { createAdminSupabaseClient, createServerAuthSupabaseClient } from "./supabase.js";

type MatchInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string | null;
};

type AthleteMatchRow = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  display_name: string;
  date_of_birth: string | null;
  primary_email: string | null;
  city: string | null;
  country_code: string | null;
};

export type AthleteProfileMatch = {
  athleteProfileId: string;
  slug: string;
  displayName: string;
  location: string | null;
  confidence: "strong" | "possible";
  raceCount: number;
  resultCount: number;
  clubNames: string[];
};

export type AthleteProfileClaimAvailability = {
  athleteSlug: string;
  displayName: string;
  status: "claimable" | "manual" | "claimed" | "unavailable";
  maskedEmail: string | null;
};

export type EmailVerifiedAthleteProfileClaim = {
  athleteProfileId: string;
  athleteSlug: string;
  claimed: boolean;
};

export type AutomaticAthleteProfileClaimResult =
  | { status: "not_applicable" | "no_match" | "ambiguous" | "manual_review_required" | "failed" }
  | { status: "claimed"; claim: EmailVerifiedAthleteProfileClaim };

type AutomaticAthleteProfileClaimCandidate = {
  id: string;
  slug: string;
};

export type GovernanceRequestDecision = "approved" | "rejected";
export type ClubAccessRequestRole = "administrator" | "owner";

export type PlatformAthleteRecord = {
  athleteProfileId: string;
  slug: string;
  firstName: string;
  lastName: string;
  displayName: string;
  dateOfBirth: string | null;
  primaryEmail: string | null;
  city: string | null;
  countryCode: string | null;
  isClaimed: boolean;
  status: string;
  registrationCount: number;
  resultCount: number;
  activeClubCount: number;
  updatedAt: string;
};

export type PlatformClubRecord = {
  clubId: string;
  slug: string;
  name: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  status: string;
  verificationStatus: "unverified" | "verified" | "merged" | "flagged";
  activeMemberCount: number;
  representedAthleteCount: number;
  registrationCount: number;
  resultCount: number;
  isImported: boolean;
  updatedAt: string;
};

export type UpdatePlatformAthleteInput = Pick<
  PlatformAthleteRecord,
  "firstName" | "lastName" | "displayName" | "dateOfBirth" | "primaryEmail" | "city" | "countryCode"
> & { status: "active" | "inactive" };

export type UpdatePlatformClubInput = Pick<
  PlatformClubRecord,
  "name" | "city" | "region" | "countryCode"
> & {
  status: "active" | "inactive";
  verificationStatus: "unverified" | "verified" | "flagged";
};

export type PlatformIntegrityCheckType = "duplicate" | "membership" | "result";
export type PlatformIntegrityCheckState = "open" | "acknowledged" | "dismissed";
type PlatformIntegrityReview = {
  reviewState: Exclude<PlatformIntegrityCheckState, "dismissed">;
  reviewedAt: string | null;
};

export type IdentityGovernanceInbox = {
  permissions: {
    canEditPlatformData: boolean;
  };
  quality: {
    activeAthletes: number;
    unclaimedAthletes: number;
    duplicateCandidateGroups: number;
    activeClubs: number;
    representedMembershipGaps: number;
    resultRegistrationMismatches: number;
  };
  athletes: PlatformAthleteRecord[];
  clubs: PlatformClubRecord[];
  integrity: {
    duplicateGroups: Array<{
      groupKey: string;
      normalizedName: string;
      dateOfBirth: string;
      athletes: Array<{
        athleteProfileId: string;
        slug: string;
        displayName: string;
        primaryEmail: string | null;
        isClaimed: boolean;
      }>;
    } & PlatformIntegrityReview>;
    membershipGaps: Array<{
      registrationId: string;
      athleteProfileId: string;
      athleteName: string;
      clubId: string;
      clubName: string;
    } & PlatformIntegrityReview>;
    resultMismatches: Array<{
      resultRowId: string;
      registrationId: string;
      resultAthleteName: string;
      registrationAthleteName: string;
      resultClubName: string | null;
      registrationClubName: string | null;
    } & PlatformIntegrityReview>;
  };
  athleteClaims: Array<{
    requestId: string;
    athleteProfileId: string;
    athleteName: string;
    athleteSlug: string;
    claimantUserId: string;
    claimantName: string;
    claimantEmail: string | null;
    evidence: Record<string, unknown>;
    note: string | null;
    submittedAt: string;
  }>;
  clubAdminRequests: Array<{
    requestId: string;
    clubId: string;
    clubName: string;
    clubSlug: string;
    athleteName: string;
    claimantUserId: string;
    claimantName: string;
    claimantEmail: string | null;
    requestedRoleKey: ClubAccessRequestRole;
    note: string | null;
    submittedAt: string;
  }>;
};

export type IdentityGovernanceRequests = Pick<
  IdentityGovernanceInbox,
  "athleteClaims" | "clubAdminRequests"
>;

export function normalizeAthleteMatchText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("hr")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function athleteCandidateMatchScore(
  input: MatchInput,
  candidate: Pick<AthleteMatchRow, "first_name" | "last_name" | "date_of_birth" | "primary_email">,
) {
  if (!candidate.date_of_birth || candidate.date_of_birth !== input.dateOfBirth) return 0;

  const candidateName = normalizeAthleteMatchText(`${candidate.first_name} ${candidate.last_name}`);
  const inputName = normalizeAthleteMatchText(`${input.firstName} ${input.lastName}`);
  const email = input.email?.trim().toLowerCase() || null;
  const candidateEmail = candidate.primary_email?.trim().toLowerCase() || null;
  const emailMatches = Boolean(email && candidateEmail && email === candidateEmail);
  const nameMatches = Boolean(inputName && candidateName === inputName);

  if (emailMatches && nameMatches) return 100;
  if (emailMatches) return 92;
  if (nameMatches) return 78;
  return 0;
}

export function maskAthleteClaimEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  const separatorIndex = normalized.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) return null;

  const localPart = normalized.slice(0, separatorIndex);
  const domain = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, Math.min(2, localPart.length));
  return `${visiblePrefix}${"•".repeat(Math.max(3, localPart.length - visiblePrefix.length))}@${domain}`;
}

export function resolveAutomaticAthleteProfileClaimCandidate(
  candidates: AutomaticAthleteProfileClaimCandidate[],
) {
  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.id, candidate])).values(),
  );

  if (uniqueCandidates.length === 0) {
    return { status: "no_match" as const, candidate: null };
  }
  if (uniqueCandidates.length > 1) {
    return { status: "ambiguous" as const, candidate: null };
  }
  return { status: "match" as const, candidate: uniqueCandidates[0] };
}

function escapePostgrestLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function findAutomaticAthleteProfileClaimCandidate(
  email: string,
  env: ServerEnv = loadServerEnv(),
) {
  const normalizedEmail = normalizeEmailAddress(email);
  const adminClient = createAdminSupabaseClient(env);
  const [primaryEmailResult, emailIdentityResult] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("id")
      .eq("primary_email", normalizedEmail)
      .eq("is_claimed", false)
      .eq("status", "active")
      .is("merged_into_athlete_profile_id", null)
      .limit(3)
      .returns<Array<{ id: string }>>(),
    adminClient
      .from("athlete_identities")
      .select("athlete_profile_id")
      .eq("identity_type", "email")
      .ilike("identity_value", escapePostgrestLikePattern(normalizedEmail))
      .limit(3)
      .returns<Array<{ athlete_profile_id: string }>>(),
  ]);
  if (primaryEmailResult.error) throw primaryEmailResult.error;
  if (emailIdentityResult.error) throw emailIdentityResult.error;

  const candidateIds = Array.from(new Set([
    ...(primaryEmailResult.data ?? []).map((profile) => profile.id),
    ...(emailIdentityResult.data ?? []).map((identity) => identity.athlete_profile_id),
  ]));
  if (!candidateIds.length) {
    return resolveAutomaticAthleteProfileClaimCandidate([]);
  }

  const { data: candidates, error: candidatesError } = await adminClient
    .from("athlete_profiles")
    .select("id,slug")
    .in("id", candidateIds)
    .eq("is_claimed", false)
    .eq("status", "active")
    .is("merged_into_athlete_profile_id", null)
    .returns<AutomaticAthleteProfileClaimCandidate[]>();
  if (candidatesError) throw candidatesError;

  return resolveAutomaticAthleteProfileClaimCandidate(candidates ?? []);
}

function requirePlatformAdministrator(session: RequestSession) {
  if (!session.account.platformRole) {
    throw forbidden("Only site administrators can review identity and club access requests.");
  }
}

export function canEditPlatformData(platformRole: string | null | undefined) {
  return hasPlatformCapability(
    platformRole === "super_admin" || platformRole === "site_admin" ? platformRole : null,
    "platform.records.edit",
  );
}

type PlatformResultCountRegistration = {
  id: string;
  participation_status: string;
};

type PlatformResultCountRow = {
  id: string;
  athlete_profile_id: string;
  event_category_id: string;
  result_run_id: string;
  registration_id: string | null;
  result_status: string;
};

type PlatformResultCountPublication = {
  id: string;
  event_category_id: string;
  result_run_id: string;
  publication_state: string;
  published_at: string | null;
  created_at: string;
};

const nonResultParticipationStatuses = new Set(["not_started", "checked_in", "dns", "withdrawn"]);

function publicationRecencyKey(publication: PlatformResultCountPublication) {
  return `${publication.published_at ?? ""}|${publication.created_at}|${publication.id}`;
}

export function filterCurrentPublishedResultRows<Row extends PlatformResultCountRow>({
  results,
  publications,
}: {
  results: Row[];
  publications: PlatformResultCountPublication[];
}) {
  const latestPublicationByCategory = new Map<string, PlatformResultCountPublication>();
  for (const publication of publications) {
    if (publication.publication_state !== "official" && publication.publication_state !== "corrected") continue;
    const current = latestPublicationByCategory.get(publication.event_category_id);
    if (!current || publicationRecencyKey(publication) > publicationRecencyKey(current)) {
      latestPublicationByCategory.set(publication.event_category_id, publication);
    }
  }

  return results.filter((result) => {
    if (result.result_status !== "official" && result.result_status !== "corrected") return false;
    const latestPublication = latestPublicationByCategory.get(result.event_category_id);
    return latestPublication?.result_run_id === result.result_run_id;
  });
}

export function countCurrentPublishedResultsByAthlete({
  registrations,
  results,
  publications,
}: {
  registrations: PlatformResultCountRegistration[];
  results: PlatformResultCountRow[];
  publications: PlatformResultCountPublication[];
}) {
  const registrationById = new Map(registrations.map((registration) => [registration.id, registration]));
  const counts = new Map<string, number>();
  for (const result of filterCurrentPublishedResultRows({ results, publications })) {
    const participationStatus = result.registration_id
      ? registrationById.get(result.registration_id)?.participation_status
      : null;
    if (participationStatus && nonResultParticipationStatuses.has(participationStatus)) continue;

    counts.set(result.athlete_profile_id, (counts.get(result.athlete_profile_id) ?? 0) + 1);
  }

  return counts;
}

export function isRepresentedMembershipGap(input: {
  representedClubId: string | null;
  representedClubStatus: string | null;
  hasActiveMembership: boolean;
}) {
  return Boolean(
    input.representedClubId
    && input.representedClubStatus === "active"
    && !input.hasActiveMembership,
  );
}

function requireSuperAdministrator(session: RequestSession) {
  requirePlatformCapability(session, "platform.records.delete");
}

function nullableTrimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function throwGovernanceRpcError(error: { code?: string; message?: string }): never {
  const message = error.message ?? "Identity governance command failed";
  if (error.code === "28000" || error.code === "42501") throw forbidden(message);
  if (error.code === "P0002") throw notFound(message);
  if (error.code === "23505" || error.code === "55000") throw conflict(message);
  if (error.code === "22023") throw badRequest(message);
  throw error;
}

export async function getAthleteProfileClaimAvailability(
  athleteSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteProfileClaimAvailability> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("athlete_profiles")
    .select("slug,display_name,primary_email,is_claimed,claimed_by_user_id,status,merged_into_athlete_profile_id")
    .eq("slug", athleteSlug)
    .maybeSingle<{
      slug: string;
      display_name: string;
      primary_email: string | null;
      is_claimed: boolean;
      claimed_by_user_id: string | null;
      status: string;
      merged_into_athlete_profile_id: string | null;
    }>();
  if (error) throw error;
  if (!data) throw notFound("Athlete profile not found.");

  const isCurrentProfile = data.status === "active" && !data.merged_into_athlete_profile_id;
  const isClaimed = data.is_claimed || Boolean(data.claimed_by_user_id);
  const maskedEmail = isCurrentProfile && !isClaimed
    ? maskAthleteClaimEmail(data.primary_email)
    : null;

  return {
    athleteSlug: data.slug,
    displayName: data.display_name,
    status: !isCurrentProfile
      ? "unavailable"
      : isClaimed
        ? "claimed"
        : maskedEmail
          ? "claimable"
          : "manual",
    maskedEmail,
  };
}

export async function requestAthleteProfileClaimEmail(
  athleteSlug: string,
  requestMetadata: { ipAddress?: string | null; userAgent?: string | null } = {},
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: profile, error: profileError } = await adminClient
    .from("athlete_profiles")
    .select("id,slug,display_name,first_name,last_name,primary_email,is_claimed,claimed_by_user_id")
    .eq("slug", athleteSlug)
    .eq("status", "active")
    .is("merged_into_athlete_profile_id", null)
    .maybeSingle<{
      id: string;
      slug: string;
      display_name: string;
      first_name: string;
      last_name: string;
      primary_email: string | null;
      is_claimed: boolean;
      claimed_by_user_id: string | null;
    }>();
  if (profileError) throw profileError;
  if (!profile) throw notFound("Athlete profile not found.");
  if (profile.is_claimed || profile.claimed_by_user_id) {
    throw conflict("This athlete profile has already been claimed.");
  }
  if (!profile.primary_email) {
    throw badRequest("This imported athlete profile does not have an email available for ownership verification.");
  }

  const email = normalizeEmailAddress(profile.primary_email);
  const maskedEmail = maskAthleteClaimEmail(email);
  const rateLimit = await consumePublicAuthRateLimit({
    action: `athlete_profile_claim:${profile.id}`,
    email,
    ipAddress: requestMetadata.ipAddress ?? null,
  }, env);
  if (!rateLimit.allowed) {
    await logAuthSecurityEvent({
      email,
      eventType: "athlete_profile_claim_email_requested",
      eventStatus: "rate_limited",
      metadata: {
        athleteProfileId: profile.id,
        athleteSlug: profile.slug,
        ipAddress: requestMetadata.ipAddress ?? null,
        userAgent: requestMetadata.userAgent ?? null,
      },
    }, env);
    return { accepted: true, maskedEmail, rateLimited: true };
  }

  const redirectUrl = resolveAuthRedirectUrl(`/auth?claim=${encodeURIComponent(profile.slug)}`, env);
  const authClient = createServerAuthSupabaseClient(env);
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      ...(redirectUrl ? { emailRedirectTo: redirectUrl } : {}),
      data: {
        display_name: profile.display_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
        requested_roles: ["athlete"],
        claim_athlete_profile_id: profile.id,
        claim_athlete_profile_slug: profile.slug,
      },
    },
  });
  if (error) {
    await logAuthSecurityEvent({
      email,
      eventType: "athlete_profile_claim_email_requested",
      eventStatus: "failure",
      metadata: {
        athleteProfileId: profile.id,
        athleteSlug: profile.slug,
        reason: error.message,
        ipAddress: requestMetadata.ipAddress ?? null,
        userAgent: requestMetadata.userAgent ?? null,
      },
    }, env);
    throw error;
  }

  await logAuthSecurityEvent({
    email,
    eventType: "athlete_profile_claim_email_requested",
    eventStatus: "success",
    metadata: {
      athleteProfileId: profile.id,
      athleteSlug: profile.slug,
      ipAddress: requestMetadata.ipAddress ?? null,
      userAgent: requestMetadata.userAgent ?? null,
    },
  }, env);
  return { accepted: true, maskedEmail, rateLimited: false };
}

export async function claimImportedAthleteProfileByVerifiedEmail(
  session: RequestSession,
  athleteSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<EmailVerifiedAthleteProfileClaim> {
  const verifiedEmail = session.account.email?.trim().toLowerCase() ?? null;
  if (!session.account.emailVerified || !verifiedEmail) {
    throw forbidden("Open the verification link sent to this athlete profile's assigned email before claiming it.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: profile, error: profileError } = await adminClient
    .from("athlete_profiles")
    .select("id")
    .eq("slug", athleteSlug)
    .eq("status", "active")
    .is("merged_into_athlete_profile_id", null)
    .maybeSingle<{ id: string }>();
  if (profileError) throw profileError;
  if (!profile) throw notFound("Athlete profile not found.");

  const { data, error } = await adminClient.rpc("service_claim_imported_athlete_profile_by_email", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: profile.id,
    p_verified_email: verifiedEmail,
  });
  if (error) throwGovernanceRpcError(error);
  return data as EmailVerifiedAthleteProfileClaim;
}

/**
 * Best-effort account-entry hook. Ownership is still granted exclusively by
 * the service-role RPC, which independently verifies the Supabase Auth email.
 * Ambiguous matches never claim a profile automatically.
 */
export async function automaticallyClaimAthleteProfileByVerifiedEmail(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<AutomaticAthleteProfileClaimResult> {
  const verifiedEmail = session.account.email?.trim().toLowerCase() ?? null;
  if (!session.account.emailVerified || !verifiedEmail) {
    return { status: "not_applicable" };
  }

  try {
    const resolution = await findAutomaticAthleteProfileClaimCandidate(verifiedEmail, env);
    if (resolution.status !== "match") {
      return { status: resolution.status };
    }

    const claim = await claimImportedAthleteProfileByVerifiedEmail(
      session,
      resolution.candidate.slug,
      env,
    );
    return { status: "claimed", claim };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("athlete_claim_requires_manual_merge")) {
      return { status: "manual_review_required" };
    }
    if (
      message.includes("athlete_profile_already_claimed")
      || message.includes("athlete_profile_not_found")
    ) {
      return { status: "no_match" };
    }

    console.warn("Unable to auto-claim athlete profile for verified account", {
      userId: session.account.userId,
      reason: message || "Unknown identity-governance error",
    });
    return { status: "failed" };
  }
}

export async function findUnclaimedAthleteProfileMatches(
  input: MatchInput,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteProfileMatch[]> {
  if (!input.dateOfBirth || !input.firstName.trim() || !input.lastName.trim()) return [];

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("athlete_profiles")
    .select("id,slug,first_name,last_name,display_name,date_of_birth,primary_email,city,country_code")
    .eq("date_of_birth", input.dateOfBirth)
    .eq("is_claimed", false)
    .eq("status", "active")
    .is("merged_into_athlete_profile_id", null)
    .limit(20)
    .returns<AthleteMatchRow[]>();
  if (error) throw error;

  const scored = (data ?? [])
    .map((candidate) => ({ candidate, score: athleteCandidateMatchScore(input, candidate) }))
    .filter(({ score }) => score >= 78)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  if (!scored.length) return [];

  const athleteIds = scored.map(({ candidate }) => candidate.id);
  const [registrationsResult, resultsResult, visibilityResult] = await Promise.all([
    adminClient
      .from("registrations")
      .select("athlete_profile_id,represented_club_id")
      .in("athlete_profile_id", athleteIds),
    adminClient
      .from("result_rows")
      .select("athlete_profile_id,result_status")
      .in("athlete_profile_id", athleteIds)
      .in("result_status", ["official", "corrected"]),
    adminClient
      .from("profile_visibility_settings")
      .select("athlete_profile_id,show_city,show_clubs,show_history")
      .in("athlete_profile_id", athleteIds),
  ]);
  if (registrationsResult.error) throw registrationsResult.error;
  if (resultsResult.error) throw resultsResult.error;
  if (visibilityResult.error) throw visibilityResult.error;

  const clubIds = Array.from(new Set(
    (registrationsResult.data ?? [])
      .map((registration) => registration.represented_club_id)
      .filter((value): value is string => Boolean(value)),
  ));
  const clubsResult = clubIds.length
    ? await adminClient.from("clubs").select("id,name").in("id", clubIds)
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (clubsResult.error) throw clubsResult.error;

  const clubNameById = new Map((clubsResult.data ?? []).map((club) => [club.id, club.name]));
  const visibilityByAthleteId = new Map(
    (visibilityResult.data ?? []).map((visibility) => [visibility.athlete_profile_id, visibility]),
  );
  return scored.map(({ candidate, score }) => {
    const registrations = (registrationsResult.data ?? []).filter(
      (registration) => registration.athlete_profile_id === candidate.id,
    );
    const visibility = visibilityByAthleteId.get(candidate.id);
    const clubNames = visibility?.show_clubs ? Array.from(new Set(registrations.flatMap((registration) => {
      const clubName = registration.represented_club_id
        ? clubNameById.get(registration.represented_club_id)
        : null;
      return clubName ? [clubName] : [];
    }))) : [];
    const resultCount = visibility?.show_history
      ? (resultsResult.data ?? []).filter((result) => result.athlete_profile_id === candidate.id).length
      : 0;

    return {
      athleteProfileId: candidate.id,
      slug: candidate.slug,
      displayName: candidate.display_name,
      location: visibility?.show_city
        ? [candidate.city, countryName(candidate.country_code)].filter(Boolean).join(", ") || null
        : null,
      confidence: score >= 90 ? "strong" : "possible",
      raceCount: resultCount,
      resultCount,
      clubNames,
    };
  });
}

export async function submitCurrentUserAthleteProfileClaim(
  session: RequestSession,
  athleteProfileId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const [firstName = "", ...lastNameParts] = session.account.displayName.trim().split(/\s+/);
  const matches = await findUnclaimedAthleteProfileMatches({
    firstName: session.account.firstName ?? firstName,
    lastName: session.account.lastName ?? lastNameParts.join(" "),
    dateOfBirth: session.account.dateOfBirth ?? "",
    email: session.account.email,
  }, env);
  const match = matches.find((candidate) => candidate.athleteProfileId === athleteProfileId);
  if (!match) {
    throw badRequest("This profile no longer matches the account details closely enough to request a claim.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_submit_athlete_profile_claim", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_evidence_json: {
      source: "athlete_profile_history_search",
      confidence: match.confidence,
      matchedDateOfBirth: true,
      matchedEmail: Boolean(session.account.email && match.confidence === "strong"),
      raceCount: match.raceCount,
      resultCount: match.resultCount,
      clubNames: match.clubNames,
    },
    p_note: "Requested by an account holder after a similar historical race profile was shown.",
  });
  if (error) throwGovernanceRpcError(error);
  return data as { requestId: string; athleteProfileId: string; status: string; submittedAt: string };
}

export async function getCurrentClubAdminRequestStates(
  session: RequestSession,
  requestedRoleKey: ClubAccessRequestRole = "administrator",
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("club_admin_role_requests")
    .select("club_id,status")
    .eq("claimant_user_id", session.account.userId)
    .eq("requested_role_key", requestedRoleKey)
    .order("submitted_at", { ascending: false });
  if (error) throw error;

  const states: Record<string, string> = {};
  for (const request of data ?? []) {
    if (!states[request.club_id]) states[request.club_id] = request.status;
  }
  return states;
}

export async function submitCurrentUserClubAdminRequest(
  session: RequestSession,
  clubId: string,
  note: string | null,
  requestedRoleKey: ClubAccessRequestRole = "administrator",
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_submit_club_admin_role_request", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_club_id: clubId,
    p_note: note?.trim() || null,
    p_requested_role_key: requestedRoleKey,
  });
  if (error) throwGovernanceRpcError(error);
  return data as {
    requestId: string;
    clubId: string;
    requestedRoleKey: ClubAccessRequestRole;
    status: string;
    submittedAt: string;
  };
}

export async function listIdentityGovernanceInbox(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<IdentityGovernanceInbox> {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const [athletesResult, clubsResult, registrationsResult, resultsResult, publicationsResult, membershipsResult, claimsResult, clubRequestsResult, integrityActionsResult] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("id,slug,first_name,last_name,display_name,date_of_birth,primary_email,city,country_code,is_claimed,status,merged_into_athlete_profile_id,updated_at")
      .is("merged_into_athlete_profile_id", null),
    adminClient.from("clubs").select("id,slug,name,city,region,country_code,status,verification_status,created_by_athlete_profile_id,organization_id,updated_at"),
    adminClient.from("registrations").select("id,athlete_profile_id,represented_club_id,participation_status"),
    adminClient.from("result_rows").select("id,athlete_profile_id,registration_id,represented_club_id,event_category_id,result_run_id,result_status"),
    adminClient
      .from("result_publications")
      .select("id,event_category_id,result_run_id,publication_state,published_at,created_at")
      .in("publication_state", ["official", "corrected"]),
    adminClient.from("club_memberships").select("athlete_profile_id,club_id,status"),
    adminClient
      .from("athlete_claims")
      .select("id,athlete_profile_id,claimant_user_id,evidence_json,note,submitted_at")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
    adminClient
      .from("club_admin_role_requests")
      .select("id,club_id,athlete_profile_id,claimant_user_id,requested_role_key,note,submitted_at")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
    adminClient
      .from("platform_integrity_check_actions")
      .select("check_type,check_key,state,updated_at"),
  ]);
  for (const result of [athletesResult, clubsResult, registrationsResult, resultsResult, publicationsResult, membershipsResult, claimsResult, clubRequestsResult, integrityActionsResult]) {
    if (result.error) throw result.error;
  }

  const athletes = athletesResult.data ?? [];
  const clubs = clubsResult.data ?? [];
  const activeAthletes = athletes.filter((athlete) => athlete.status === "active");
  const activeClubs = clubs.filter((club) => club.status === "active" && club.verification_status !== "merged");
  const registrations = registrationsResult.data ?? [];
  const results = resultsResult.data ?? [];
  const currentResults = filterCurrentPublishedResultRows({
    results,
    publications: publicationsResult.data ?? [],
  });
  const memberships = membershipsResult.data ?? [];
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const registrationById = new Map(registrations.map((registration) => [registration.id, registration]));
  const activeMembershipKeys = new Set(memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => `${membership.athlete_profile_id}:${membership.club_id}`));
  const integrityActionByKey = new Map(
    (integrityActionsResult.data ?? []).map((action) => [
      `${action.check_type}:${action.check_key}`,
      action as { check_type: PlatformIntegrityCheckType; check_key: string; state: "acknowledged" | "dismissed"; updated_at: string },
    ]),
  );
  function reviewFor(checkType: PlatformIntegrityCheckType, checkKey: string): PlatformIntegrityReview | null {
    const action = integrityActionByKey.get(`${checkType}:${checkKey}`);
    if (action?.state === "dismissed") return null;
    return {
      reviewState: action?.state === "acknowledged" ? "acknowledged" : "open",
      reviewedAt: action?.state === "acknowledged" ? action.updated_at : null,
    };
  }

  const duplicateKeys = new Map<string, number>();
  for (const athlete of activeAthletes) {
    const normalizedName = normalizeAthleteMatchText(`${athlete.first_name} ${athlete.last_name}`);
    if (!athlete.date_of_birth || !normalizedName) continue;
    const key = `${normalizedName}:${athlete.date_of_birth}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  const claimantUserIds = Array.from(new Set([
    ...(claimsResult.data ?? []).map((claim) => claim.claimant_user_id),
    ...(clubRequestsResult.data ?? []).map((request) => request.claimant_user_id),
  ]));
  const claimantProfilesResult = claimantUserIds.length
    ? await adminClient
        .from("user_profiles")
        .select("user_id,display_name,email")
        .in("user_id", claimantUserIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null; email: string | null }>, error: null };
  if (claimantProfilesResult.error) throw claimantProfilesResult.error;
  const claimantById = new Map((claimantProfilesResult.data ?? []).map((profile) => [profile.user_id, profile]));

  const registrationsByAthleteId = new Map<string, number>();
  const resultsByAthleteId = countCurrentPublishedResultsByAthlete({
    registrations,
    results,
    publications: publicationsResult.data ?? [],
  });
  const activeClubsByAthleteId = new Map<string, Set<string>>();
  const activeMembersByClubId = new Map<string, number>();
  const representedAthletesByClubId = new Map<string, Set<string>>();
  const registrationsByClubId = new Map<string, number>();
  const resultsByClubId = new Map<string, number>();
  for (const registration of registrations) {
    registrationsByAthleteId.set(
      registration.athlete_profile_id,
      (registrationsByAthleteId.get(registration.athlete_profile_id) ?? 0) + 1,
    );
    if (registration.represented_club_id) {
      registrationsByClubId.set(
        registration.represented_club_id,
        (registrationsByClubId.get(registration.represented_club_id) ?? 0) + 1,
      );
      const representedAthletes = representedAthletesByClubId.get(registration.represented_club_id) ?? new Set<string>();
      representedAthletes.add(registration.athlete_profile_id);
      representedAthletesByClubId.set(registration.represented_club_id, representedAthletes);
    }
  }
  for (const result of results) {
    if (!result.represented_club_id) continue;
    resultsByClubId.set(
      result.represented_club_id,
      (resultsByClubId.get(result.represented_club_id) ?? 0) + 1,
    );
  }
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    activeMembersByClubId.set(membership.club_id, (activeMembersByClubId.get(membership.club_id) ?? 0) + 1);
    const activeClubsForAthlete = activeClubsByAthleteId.get(membership.athlete_profile_id) ?? new Set<string>();
    activeClubsForAthlete.add(membership.club_id);
    activeClubsByAthleteId.set(membership.athlete_profile_id, activeClubsForAthlete);
  }

  const duplicateGroups = Array.from(duplicateKeys.entries()).flatMap(([groupKey, count]) => {
    if (count < 2) return [];
    const review = reviewFor("duplicate", groupKey);
    if (!review) return [];
    const separatorIndex = groupKey.lastIndexOf(":");
    const normalizedName = groupKey.slice(0, separatorIndex);
    const dateOfBirth = groupKey.slice(separatorIndex + 1);
    const matchingAthletes = activeAthletes.filter((athlete) => (
      athlete.date_of_birth === dateOfBirth
      && normalizeAthleteMatchText(`${athlete.first_name} ${athlete.last_name}`) === normalizedName
    ));
    return [{
      groupKey,
      normalizedName,
      dateOfBirth,
      athletes: matchingAthletes.map((athlete) => ({
        athleteProfileId: athlete.id,
        slug: athlete.slug,
        displayName: athlete.display_name,
        primaryEmail: athlete.primary_email,
        isClaimed: athlete.is_claimed,
      })),
      ...review,
    }];
  });

  const membershipGaps = registrations.flatMap((registration) => {
    const review = reviewFor("membership", registration.id);
    if (!review) return [];
    const club = registration.represented_club_id
      ? clubById.get(registration.represented_club_id)
      : null;
    if (!isRepresentedMembershipGap({
      representedClubId: registration.represented_club_id,
      representedClubStatus: club?.status ?? null,
      hasActiveMembership: Boolean(
        registration.represented_club_id
        && activeMembershipKeys.has(`${registration.athlete_profile_id}:${registration.represented_club_id}`),
      ),
    })) return [];
    const athlete = athleteById.get(registration.athlete_profile_id);
    if (!athlete || !club) return [];
    return [{
      registrationId: registration.id,
      athleteProfileId: athlete.id,
      athleteName: athlete.display_name,
      clubId: club.id,
      clubName: club.name,
      ...review,
    }];
  });

  const resultMismatches = currentResults.flatMap((result) => {
    const review = reviewFor("result", result.id);
    if (!review) return [];
    const registration = result.registration_id ? registrationById.get(result.registration_id) : null;
    if (!registration || (
      registration.athlete_profile_id === result.athlete_profile_id
      && registration.represented_club_id === result.represented_club_id
    )) return [];
    return [{
      resultRowId: result.id,
      registrationId: registration.id,
      resultAthleteName: athleteById.get(result.athlete_profile_id)?.display_name ?? "Unknown athlete",
      registrationAthleteName: athleteById.get(registration.athlete_profile_id)?.display_name ?? "Unknown athlete",
      resultClubName: result.represented_club_id ? clubById.get(result.represented_club_id)?.name ?? null : null,
      registrationClubName: registration.represented_club_id
        ? clubById.get(registration.represented_club_id)?.name ?? null
        : null,
      ...review,
    }];
  });

  return {
    permissions: {
      canEditPlatformData: canEditPlatformData(session.account.platformRole),
    },
    quality: {
      activeAthletes: activeAthletes.length,
      unclaimedAthletes: activeAthletes.filter((athlete) => !athlete.is_claimed).length,
      duplicateCandidateGroups: duplicateGroups.filter((group) => group.reviewState === "open").length,
      activeClubs: activeClubs.length,
      representedMembershipGaps: membershipGaps.filter((gap) => gap.reviewState === "open").length,
      resultRegistrationMismatches: resultMismatches.filter((mismatch) => mismatch.reviewState === "open").length,
    },
    athletes: athletes
      .map((athlete) => ({
        athleteProfileId: athlete.id,
        slug: athlete.slug,
        firstName: athlete.first_name,
        lastName: athlete.last_name,
        displayName: athlete.display_name,
        dateOfBirth: athlete.date_of_birth,
        primaryEmail: athlete.primary_email,
        city: athlete.city,
        countryCode: athlete.country_code?.trim().toUpperCase() ?? null,
        isClaimed: athlete.is_claimed,
        status: athlete.status,
        registrationCount: registrationsByAthleteId.get(athlete.id) ?? 0,
        resultCount: resultsByAthleteId.get(athlete.id) ?? 0,
        activeClubCount: activeClubsByAthleteId.get(athlete.id)?.size ?? 0,
        updatedAt: athlete.updated_at,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "hr")),
    clubs: clubs
      .filter((club) => club.verification_status !== "merged")
      .map((club) => ({
        clubId: club.id,
        slug: club.slug,
        name: club.name,
        city: club.city,
        region: club.region,
        countryCode: club.country_code?.trim().toUpperCase() ?? null,
        status: club.status,
        verificationStatus: club.verification_status,
        activeMemberCount: activeMembersByClubId.get(club.id) ?? 0,
        representedAthleteCount: representedAthletesByClubId.get(club.id)?.size ?? 0,
        registrationCount: registrationsByClubId.get(club.id) ?? 0,
        resultCount: resultsByClubId.get(club.id) ?? 0,
        isImported: club.created_by_athlete_profile_id === null && club.organization_id === null,
        updatedAt: club.updated_at,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "hr")),
    integrity: {
      duplicateGroups,
      membershipGaps,
      resultMismatches,
    },
    athleteClaims: (claimsResult.data ?? []).flatMap((claim) => {
      const athlete = athleteById.get(claim.athlete_profile_id);
      if (!athlete) return [];
      const claimant = claimantById.get(claim.claimant_user_id);
      return [{
        requestId: claim.id,
        athleteProfileId: athlete.id,
        athleteName: athlete.display_name,
        athleteSlug: athlete.slug,
        claimantUserId: claim.claimant_user_id,
        claimantName: claimant?.display_name?.trim() || "Account holder",
        claimantEmail: claimant?.email ?? null,
        evidence: claim.evidence_json && typeof claim.evidence_json === "object"
          ? claim.evidence_json as Record<string, unknown>
          : {},
        note: claim.note,
        submittedAt: claim.submitted_at,
      }];
    }),
    clubAdminRequests: (clubRequestsResult.data ?? []).flatMap((request) => {
      const club = clubById.get(request.club_id);
      const athlete = athleteById.get(request.athlete_profile_id);
      if (!club || !athlete) return [];
      const claimant = claimantById.get(request.claimant_user_id);
      return [{
        requestId: request.id,
        clubId: club.id,
        clubName: club.name,
        clubSlug: club.slug,
        athleteName: athlete.display_name,
        claimantUserId: request.claimant_user_id,
        claimantName: claimant?.display_name?.trim() || athlete.display_name,
        claimantEmail: claimant?.email ?? null,
        requestedRoleKey: request.requested_role_key as ClubAccessRequestRole,
        note: request.note,
        submittedAt: request.submitted_at,
      }];
    }),
  };
}

export async function listIdentityGovernanceRequests(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<IdentityGovernanceRequests> {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const [claimsResult, clubRequestsResult] = await Promise.all([
    adminClient
      .from("athlete_claims")
      .select("id,athlete_profile_id,claimant_user_id,evidence_json,note,submitted_at")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
    adminClient
      .from("club_admin_role_requests")
      .select("id,club_id,athlete_profile_id,claimant_user_id,requested_role_key,note,submitted_at")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
  ]);
  if (claimsResult.error) throw claimsResult.error;
  if (clubRequestsResult.error) throw clubRequestsResult.error;

  const athleteIds = Array.from(new Set([
    ...(claimsResult.data ?? []).map((claim) => claim.athlete_profile_id),
    ...(clubRequestsResult.data ?? []).map((request) => request.athlete_profile_id),
  ]));
  const clubIds = Array.from(new Set(
    (clubRequestsResult.data ?? []).map((request) => request.club_id),
  ));
  const claimantUserIds = Array.from(new Set([
    ...(claimsResult.data ?? []).map((claim) => claim.claimant_user_id),
    ...(clubRequestsResult.data ?? []).map((request) => request.claimant_user_id),
  ]));

  const [athletesResult, clubsResult, claimantProfilesResult] = await Promise.all([
    athleteIds.length
      ? adminClient.from("athlete_profiles").select("id,slug,display_name").in("id", athleteIds)
      : Promise.resolve({ data: [], error: null }),
    clubIds.length
      ? adminClient.from("clubs").select("id,slug,name").in("id", clubIds)
      : Promise.resolve({ data: [], error: null }),
    claimantUserIds.length
      ? adminClient.from("user_profiles").select("user_id,display_name,email").in("user_id", claimantUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (athletesResult.error) throw athletesResult.error;
  if (clubsResult.error) throw clubsResult.error;
  if (claimantProfilesResult.error) throw claimantProfilesResult.error;

  const athleteById = new Map((athletesResult.data ?? []).map((athlete) => [athlete.id, athlete]));
  const clubById = new Map((clubsResult.data ?? []).map((club) => [club.id, club]));
  const claimantById = new Map((claimantProfilesResult.data ?? []).map((profile) => [profile.user_id, profile]));

  return {
    athleteClaims: (claimsResult.data ?? []).flatMap((claim) => {
      const athlete = athleteById.get(claim.athlete_profile_id);
      if (!athlete) return [];
      const claimant = claimantById.get(claim.claimant_user_id);
      return [{
        requestId: claim.id,
        athleteProfileId: athlete.id,
        athleteName: athlete.display_name,
        athleteSlug: athlete.slug,
        claimantUserId: claim.claimant_user_id,
        claimantName: claimant?.display_name?.trim() || "Account holder",
        claimantEmail: claimant?.email ?? null,
        evidence: claim.evidence_json && typeof claim.evidence_json === "object"
          ? claim.evidence_json as Record<string, unknown>
          : {},
        note: claim.note,
        submittedAt: claim.submitted_at,
      }];
    }),
    clubAdminRequests: (clubRequestsResult.data ?? []).flatMap((request) => {
      const club = clubById.get(request.club_id);
      const athlete = athleteById.get(request.athlete_profile_id);
      if (!club || !athlete) return [];
      const claimant = claimantById.get(request.claimant_user_id);
      return [{
        requestId: request.id,
        clubId: club.id,
        clubName: club.name,
        clubSlug: club.slug,
        athleteName: athlete.display_name,
        claimantUserId: request.claimant_user_id,
        claimantName: claimant?.display_name?.trim() || athlete.display_name,
        claimantEmail: claimant?.email ?? null,
        requestedRoleKey: request.requested_role_key as ClubAccessRequestRole,
        note: request.note,
        submittedAt: request.submitted_at,
      }];
    }),
  };
}

export async function updatePlatformAthlete(
  session: RequestSession,
  athleteProfileId: string,
  input: UpdatePlatformAthleteInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.records.edit");
  const adminClient = createAdminSupabaseClient(env);
  const { data: current, error: currentError } = await adminClient
    .from("athlete_profiles")
    .select("id,first_name,last_name,display_name,date_of_birth,primary_email,city,country_code,status")
    .eq("id", athleteProfileId)
    .is("merged_into_athlete_profile_id", null)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw notFound("Athlete profile not found.");

  const patch = {
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    display_name: input.displayName.trim(),
    date_of_birth: nullableTrimmed(input.dateOfBirth),
    primary_email: nullableTrimmed(input.primaryEmail)?.toLowerCase() ?? null,
    city: nullableTrimmed(input.city),
    country_code: nullableTrimmed(input.countryCode)?.toUpperCase() ?? null,
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  const changedFields = Object.entries(patch)
    .filter(([key, value]) => key !== "updated_at" && current[key as keyof typeof current] !== value)
    .map(([key]) => key);
  if (!changedFields.length) return { updated: false, athleteProfileId };

  const { error } = await adminClient.from("athlete_profiles").update(patch).eq("id", athleteProfileId);
  if (error) throw error;
  const { error: auditError } = await adminClient.from("audit_log").insert({
    actor_user_id: session.account.userId,
    entity_type: "athlete_profile",
    entity_id: athleteProfileId,
    action: "platform.athlete_updated",
    metadata_json: { changedFields },
  });
  if (auditError) throw auditError;
  return { updated: true, athleteProfileId };
}

export async function updatePlatformClub(
  session: RequestSession,
  clubId: string,
  input: UpdatePlatformClubInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.records.edit");
  const adminClient = createAdminSupabaseClient(env);
  const { data: current, error: currentError } = await adminClient
    .from("clubs")
    .select("id,name,city,region,country_code,status,verification_status")
    .eq("id", clubId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw notFound("Club not found.");

  const patch = {
    name: input.name.trim(),
    city: nullableTrimmed(input.city),
    region: nullableTrimmed(input.region),
    country_code: nullableTrimmed(input.countryCode)?.toUpperCase() ?? null,
    status: input.status,
    verification_status: input.verificationStatus,
    updated_at: new Date().toISOString(),
  };
  const changedFields = Object.entries(patch)
    .filter(([key, value]) => key !== "updated_at" && current[key as keyof typeof current] !== value)
    .map(([key]) => key);
  if (!changedFields.length) return { updated: false, clubId };

  const { error } = await adminClient.from("clubs").update(patch).eq("id", clubId);
  if (error) throw error;
  const { error: auditError } = await adminClient.from("audit_log").insert({
    actor_user_id: session.account.userId,
    entity_type: "club",
    entity_id: clubId,
    action: "platform.club_updated",
    metadata_json: { changedFields },
  });
  if (auditError) throw auditError;
  return { updated: true, clubId };
}

export async function setPlatformIntegrityCheckState(
  session: RequestSession,
  checkType: PlatformIntegrityCheckType,
  checkKey: string,
  state: PlatformIntegrityCheckState,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_set_platform_integrity_check_state", {
    p_actor_user_id: session.account.userId,
    p_check_type: checkType,
    p_check_key: checkKey,
    p_state: state,
  });
  if (error) throwGovernanceRpcError(error);
  return data as { checkType: PlatformIntegrityCheckType; checkKey: string; state: PlatformIntegrityCheckState };
}

export async function deletePlatformClub(
  session: RequestSession,
  clubId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_delete_platform_club", {
    p_actor_user_id: session.account.userId,
    p_club_id: clubId,
  });
  if (error) throwGovernanceRpcError(error);
  return data as {
    deleted: boolean;
    clubId: string;
    detachedMemberships: number;
    detachedRegistrations: number;
    detachedResults: number;
  };
}

export async function decideAthleteProfileClaim(
  session: RequestSession,
  claimId: string,
  decision: GovernanceRequestDecision,
  note: string,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_decide_athlete_profile_claim", {
    p_actor_user_id: session.account.userId,
    p_claim_id: claimId,
    p_decision: decision,
    p_note: note.trim(),
  });
  if (error) throwGovernanceRpcError(error);
  return data;
}

export async function decideClubAdminRoleRequest(
  session: RequestSession,
  requestId: string,
  decision: GovernanceRequestDecision,
  note: string,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_decide_club_admin_role_request", {
    p_actor_user_id: session.account.userId,
    p_request_id: requestId,
    p_decision: decision,
    p_note: note.trim(),
  });
  if (error) throwGovernanceRpcError(error);
  return data;
}
