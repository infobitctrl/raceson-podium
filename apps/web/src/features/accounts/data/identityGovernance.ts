import { apiRequest } from "@/lib/api";

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

export type EmailVerifiedAthleteProfileClaimResult = {
  claim: {
    athleteProfileId: string;
    athleteSlug: string;
    claimed: boolean;
  };
  account: {
    primaryAthleteProfileId: string | null;
    primaryAthleteSlug: string | null;
  };
};

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

export function findAthleteProfileMatches(input: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string | null;
}) {
  return apiRequest<AthleteProfileMatch[]>({
    path: "/v1/public/athlete-profile-matches",
    method: "POST",
    accessToken: null,
    body: input,
  });
}

export function getAthleteProfileClaimAvailability(athleteSlug: string) {
  return apiRequest<AthleteProfileClaimAvailability>({
    path: `/v1/public/athlete-profile-claim/${encodeURIComponent(athleteSlug)}`,
    accessToken: null,
  });
}

export function requestAthleteProfileClaim(athleteProfileId: string) {
  return apiRequest<{ requestId: string; athleteProfileId: string; status: string }>({
    path: "/v1/me/athlete-profile-claims",
    method: "POST",
    body: { athleteProfileId },
  });
}

export function requestAthleteProfileClaimEmail(athleteSlug: string) {
  return apiRequest<{ accepted: boolean; maskedEmail: string | null; rateLimited: boolean }>({
    path: `/v1/public/athlete-profile-claim/${encodeURIComponent(athleteSlug)}/email`,
    method: "POST",
    accessToken: null,
  });
}

export function completeAthleteProfileEmailClaim(athleteSlug: string) {
  return apiRequest<EmailVerifiedAthleteProfileClaimResult>({
    path: "/v1/me/athlete-profile-email-claim",
    method: "POST",
    body: { athleteSlug },
  });
}

export function getClubAdminRequestStates(
  requestedRoleKey: ClubAccessRequestRole = "administrator",
) {
  return apiRequest<Record<string, "pending" | "approved" | "rejected" | "withdrawn">>({
    path: `/v1/me/club-admin-requests?requestedRoleKey=${encodeURIComponent(requestedRoleKey)}`,
  });
}

export function requestClubAdminRole(
  clubId: string,
  note?: string | null,
  requestedRoleKey: ClubAccessRequestRole = "administrator",
) {
  return apiRequest<{
    requestId: string;
    clubId: string;
    requestedRoleKey: ClubAccessRequestRole;
    status: string;
    submittedAt: string;
  }>({
    path: `/v1/me/clubs/${encodeURIComponent(clubId)}/admin-request`,
    method: "POST",
    body: { note: note?.trim() || null, requestedRoleKey },
  });
}

export function getIdentityGovernanceInbox(accessToken?: string) {
  return apiRequest<IdentityGovernanceInbox>({
    path: "/v1/platform/identity-governance",
    accessToken,
  });
}

export function getIdentityGovernanceRequests(accessToken?: string) {
  return apiRequest<IdentityGovernanceRequests>({
    path: "/v1/platform/identity-requests",
    accessToken,
  });
}

export function decideGovernanceRequest(input: {
  type: "athlete" | "club_admin";
  requestId: string;
  decision: "approved" | "rejected";
  note: string;
  accessToken?: string;
}) {
  const path = input.type === "athlete"
    ? `/v1/platform/athlete-claims/${encodeURIComponent(input.requestId)}/decision`
    : `/v1/platform/club-admin-requests/${encodeURIComponent(input.requestId)}/decision`;
  return apiRequest({
    path,
    method: "POST",
    accessToken: input.accessToken,
    body: { decision: input.decision, note: input.note },
  });
}

export function updatePlatformAthleteRecord(input: {
  athleteProfileId: string;
  values: UpdatePlatformAthleteInput;
  accessToken?: string;
}) {
  return apiRequest<{ updated: boolean; athleteProfileId: string }>({
    path: `/v1/platform/athletes/${encodeURIComponent(input.athleteProfileId)}`,
    method: "PATCH",
    accessToken: input.accessToken,
    body: input.values,
  });
}

export function updatePlatformClubRecord(input: {
  clubId: string;
  values: UpdatePlatformClubInput;
  accessToken?: string;
}) {
  return apiRequest<{ updated: boolean; clubId: string }>({
    path: `/v1/platform/clubs/${encodeURIComponent(input.clubId)}`,
    method: "PATCH",
    accessToken: input.accessToken,
    body: input.values,
  });
}

export function setPlatformIntegrityCheckState(input: {
  checkType: PlatformIntegrityCheckType;
  checkKey: string;
  state: PlatformIntegrityCheckState;
  accessToken?: string;
}) {
  return apiRequest<{ checkType: PlatformIntegrityCheckType; checkKey: string; state: PlatformIntegrityCheckState }>({
    path: `/v1/platform/integrity-checks/${input.checkType}/${encodeURIComponent(input.checkKey)}`,
    method: "PATCH",
    accessToken: input.accessToken,
    body: { state: input.state },
  });
}

export function deletePlatformClubRecord(input: { clubId: string; accessToken?: string }) {
  return apiRequest<{
    deleted: boolean;
    clubId: string;
    detachedMemberships: number;
    detachedRegistrations: number;
    detachedResults: number;
  }>({
    path: `/v1/platform/clubs/${encodeURIComponent(input.clubId)}`,
    method: "DELETE",
    accessToken: input.accessToken,
  });
}
