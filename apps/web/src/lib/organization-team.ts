import { apiRequest } from "@/lib/api";
import type {
  OrganizationMembershipType,
  OrganizationPermission,
} from "@/lib/auth";

export type OrganizationAccountTemplateKey =
  | "organization-admin"
  | "race-day-operator"
  | "checkpoint-timer";

export type OrganizationProfileVisibility = "public" | "members";

export type OrganizationRoleDefinition = {
  id: string;
  key: string;
  title: string;
  description: string;
  permissions: OrganizationPermission[];
  version: number;
  isSystem: false;
};

export type OrganizationWorkspaceProfileInput = {
  name: string;
  forceCreateNew?: boolean;
  legalName?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
  xUrl?: string | null;
  logoImageUrl?: string | null;
  profileVisibility?: OrganizationProfileVisibility;
  memberDirectoryVisibility?: OrganizationProfileVisibility;
  contactDetailsVisibility?: OrganizationProfileVisibility;
};

export type OrganizationWorkspaceProfile = Required<
  Omit<
    OrganizationWorkspaceProfileInput,
    | "forceCreateNew"
    | "legalName"
    | "countryCode"
    | "region"
    | "city"
    | "description"
    | "contactEmail"
    | "contactPhone"
    | "websiteUrl"
    | "instagramUrl"
    | "facebookUrl"
    | "linkedinUrl"
    | "youtubeUrl"
    | "tiktokUrl"
    | "xUrl"
    | "logoImageUrl"
  >
> & {
  organizationId: string;
  slug: string;
  legalName: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  logoImageUrl: string | null;
  updatedAt: string;
};

export type OrganizationTeamMember = {
  membershipId: string;
  organizationId: string;
  userId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: string;
  membershipType: OrganizationMembershipType;
  templateKey: OrganizationAccountTemplateKey | null;
  customRoleId: string | null;
  loginUsername: string | null;
  permissions: OrganizationPermission[];
  status: "invited" | "active" | "suspended" | "removed";
  expiresAt: string | null;
  joinedAt: string | null;
  assignments: Array<{
    assignmentId: string;
    eventEditionId: string;
    eventName: string;
    roleTitle: string;
    assignmentState: string;
    startsAt: string;
    endsAt: string;
  }>;
};

export function createOrganizerWorkspace(input: OrganizationWorkspaceProfileInput) {
  return apiRequest<{
    organizationId: string;
    organizationSlug: string;
    workspaceCreated: boolean;
  }>({
    path: "/v1/organizer/organizations",
    method: "POST",
    body: input,
  });
}

export function getOrganizationWorkspaceProfile(organizationId: string) {
  return apiRequest<OrganizationWorkspaceProfile>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/profile`,
  });
}

export function updateOrganizationWorkspaceProfile(
  organizationId: string,
  input: OrganizationWorkspaceProfileInput,
) {
  return apiRequest<OrganizationWorkspaceProfile>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/profile`,
    method: "POST",
    body: input,
  });
}

export function deleteUnusedOrganizerWorkspace(
  organizationId: string,
  confirmationName: string,
) {
  return apiRequest<{
    organizationId: string;
    organizationName: string;
    deleted: true;
  }>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}`,
    method: "DELETE",
    body: { confirmationName },
  });
}

export function getOrganizationTeam(organizationId: string) {
  return apiRequest<OrganizationTeamMember[]>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/team`,
  });
}

export function getOrganizationRoles(organizationId: string) {
  return apiRequest<OrganizationRoleDefinition[]>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/roles`,
  });
}

export function saveOrganizationRole(
  organizationId: string,
  input: {
    roleKey: string;
    title: string;
    description: string;
    permissions: OrganizationPermission[];
  },
) {
  return apiRequest<OrganizationRoleDefinition>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/roles`,
    method: "POST",
    body: input,
  });
}

export function createOrganizationAccount(
  organizationId: string,
  input: {
    accountMode?: "existing" | "new";
    templateKey?: OrganizationAccountTemplateKey | null;
    customRoleId?: string | null;
    membershipType: OrganizationMembershipType;
    displayName: string;
    email?: string | null;
    username?: string | null;
    initialPassword?: string | null;
    permissions: OrganizationPermission[];
    expiresAt?: string | null;
    jobTitle?: string | null;
  },
) {
  return apiRequest<{
    membershipId: string;
    userId: string;
    username: string | null;
    email: string | null;
    membershipType: OrganizationMembershipType;
    invitationSent: boolean;
  }>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/accounts`,
    method: "POST",
    body: input,
  });
}

export function updateOrganizationAccount(
  organizationId: string,
  membershipId: string,
  input: {
    templateKey?: OrganizationAccountTemplateKey | null;
    customRoleId?: string | null;
    displayName: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    username?: string | null;
    permissions: OrganizationPermission[];
    status: "active" | "suspended" | "removed";
    expiresAt?: string | null;
  },
) {
  return apiRequest<{ updated: boolean }>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/accounts/${encodeURIComponent(membershipId)}`,
    method: "POST",
    body: input,
  });
}

export function transferOrganizationOwnership(
  organizationId: string,
  input: {
    currentOwnerMembershipId: string;
    newOwnerMembershipId: string;
  },
) {
  return apiRequest<{
    organizationId: string;
    previousOwnerMembershipId: string;
    newOwnerMembershipId: string;
    previousOwnerRetired: true;
  }>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/ownership-transfer`,
    method: "POST",
    body: input,
  });
}

export function resetOrganizationAccountPassword(
  organizationId: string,
  membershipId: string,
  newPassword: string,
) {
  return apiRequest<{ updated: boolean }>({
    path: `/v1/organizer/organizations/${encodeURIComponent(organizationId)}/accounts/${encodeURIComponent(membershipId)}/password`,
    method: "POST",
    body: { newPassword },
  });
}
