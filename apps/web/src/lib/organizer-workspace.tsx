import {
  createContext,
  useContext,
} from "react";
import {
  useAuth,
  type AuthAccountContext,
  type OrganizationAccess,
} from "@/lib/auth";

export type OrganizerWorkspaceContextValue = {
  account: AuthAccountContext | null;
  unscopedAccount: AuthAccountContext | null;
  organizations: OrganizationAccess[];
  selectedOrganization: OrganizationAccess | null;
  selectedOrganizationId: string | null;
  defaultOrganizationId: string | null;
  isPlatformSupportMode: boolean;
  platformSupportOrganizationId: string | null;
  platformSupportOrganizationName: string | null;
  selectOrganization: (organizationId: string) => void;
  setDefaultOrganization: (organizationId: string) => void;
  exitPlatformSupportMode: () => void;
};

export const OrganizerWorkspaceContext = createContext<OrganizerWorkspaceContextValue | null>(null);

export function organizerWorkspaceStorageKey(userId: string) {
  return `sitrail.organizer-workspace.${userId}`;
}

export function organizerWorkspaceSessionStorageKey(userId: string) {
  return `sitrail.organizer-workspace-current.${userId}`;
}

export function resolveDefaultOrganizerWorkspace(
  account: AuthAccountContext | null,
) {
  if (!account?.organizations?.length) return null;
  if (typeof window === "undefined") return account.organizations[0];

  const storedId = window.localStorage.getItem(organizerWorkspaceStorageKey(account.userId));
  return account.organizations.find(
    (organization) => organization.organizationId === storedId,
  ) ?? account.organizations[0];
}

export function scopeOrganizerAccount(
  account: AuthAccountContext | null,
  organization: OrganizationAccess | null,
) {
  if (!account || !organization) return account;

  return {
    ...account,
    organizationIds: [organization.organizationId],
    organizationSlugs: [organization.organizationSlug],
    organizationNames: [organization.organizationName],
    organizationRoles: [organization.role],
    organizations: [organization],
    eventAccess: account.eventAccess.filter(
      (assignment) => assignment.organizationId === organization.organizationId,
    ),
    accountType:
      account.isMasterAdmin
        ? "master_admin"
        : organization.role === "owner"
          ? "owner"
          : organization.membershipType,
  } satisfies AuthAccountContext;
}

export function useOrganizerWorkspace() {
  const context = useContext(OrganizerWorkspaceContext);
  const { account } = useAuth();

  if (context) return context;

  const defaultOrganization = resolveDefaultOrganizerWorkspace(account);

  return {
    account,
    unscopedAccount: account,
    organizations: account?.organizations ?? [],
    selectedOrganization: defaultOrganization,
    selectedOrganizationId: defaultOrganization?.organizationId ?? null,
    defaultOrganizationId: defaultOrganization?.organizationId ?? null,
    isPlatformSupportMode: false,
    platformSupportOrganizationId: null,
    platformSupportOrganizationName: null,
    selectOrganization: () => undefined,
    setDefaultOrganization: () => undefined,
    exitPlatformSupportMode: () => undefined,
  } satisfies OrganizerWorkspaceContextValue;
}

export function useOrganizerAuth() {
  const auth = useAuth();
  const context = useContext(OrganizerWorkspaceContext);
  return {
    ...auth,
    account: context?.account ?? auth.account,
  };
}
