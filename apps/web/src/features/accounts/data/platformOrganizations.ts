import { apiRequest } from "@/lib/api";

export type PlatformOrganization = {
  organizationId: string;
  slug: string;
  name: string;
  kind: "organizer";
  status: string;
  contactEmail: string | null;
  countryCode: string | null;
  city: string | null;
  administrators: Array<{
    userId: string;
    displayName: string;
    email: string | null;
    role: string;
  }>;
  memberCount: number;
  eventCount: number;
  upcomingEventCount: number;
  lastActivityAt: string;
  createdAt: string;
};

export type PlatformOrganizationSupportContext = Pick<
  PlatformOrganization,
  "organizationId" | "slug" | "name" | "kind" | "status"
>;

export function getPlatformOrganizations(accessToken?: string | null) {
  return apiRequest<PlatformOrganization[]>({
    path: "/v1/platform/organizations",
    accessToken,
  });
}

export function getPlatformOrganizationSupportContext(input: {
  organizationId: string;
  accessToken?: string | null;
}) {
  return apiRequest<PlatformOrganizationSupportContext>({
    path: `/v1/platform/organizations/${encodeURIComponent(input.organizationId)}`,
    accessToken: input.accessToken,
  });
}

export function updatePlatformOrganization(input: {
  organizationId: string;
  expectedSlug: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  contactEmail: string | null;
  countryCode: string | null;
  city: string | null;
  reason: string;
  accessToken?: string | null;
}) {
  return apiRequest<{ organizationId: string; name: string; slug: string; status: string; updated: true }>({
    path: `/v1/platform/organizations/${encodeURIComponent(input.organizationId)}`,
    method: "PATCH",
    accessToken: input.accessToken,
    body: {
      expectedSlug: input.expectedSlug,
      name: input.name,
      slug: input.slug,
      status: input.status,
      contactEmail: input.contactEmail,
      countryCode: input.countryCode,
      city: input.city,
      reason: input.reason,
    },
  });
}

export function deletePlatformOrganization(input: {
  organizationId: string;
  confirmationName: string;
  reason: string;
  accessToken?: string | null;
}) {
  return apiRequest<{
    organizationId: string;
    organizationName: string;
    deleted: true;
    cleanup: {
      memberships: number;
      temporaryAccounts: number;
      customRoles: number;
      accessEvents: number;
      auditEntriesDetached: number;
      disposedTemporaryAccounts: number;
      retainedTemporaryAccounts: number;
      failedTemporaryAccounts: number;
    };
  }>({
    path: `/v1/platform/organizations/${encodeURIComponent(input.organizationId)}`,
    method: "DELETE",
    accessToken: input.accessToken,
    body: {
      confirmationName: input.confirmationName,
      reason: input.reason,
    },
  });
}
