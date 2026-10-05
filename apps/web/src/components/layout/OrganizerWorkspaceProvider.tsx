import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  getPlatformOrganizationSupportContext,
} from "@/features/accounts/data/platformOrganizations";
import {
  ORGANIZATION_PERMISSIONS,
  useAuth,
  type OrganizationAccess,
} from "@/lib/auth";
import {
  OrganizerWorkspaceContext,
  organizerWorkspaceSessionStorageKey,
  organizerWorkspaceStorageKey,
  scopeOrganizerAccount,
} from "@/lib/organizer-workspace";
import {
  clearPlatformSupportOrganizationId,
  readPlatformSupportOrganizationId,
  setPlatformSupportOrganizationId,
} from "@/shared/platform/platformSupportWorkspace";

const EMPTY_ORGANIZATIONS: OrganizationAccess[] = [];

export default function OrganizerWorkspaceProvider({ children }: { children: ReactNode }) {
  const { account, session } = useAuth();
  const location = useLocation();
  const membershipOrganizations = account?.organizations ?? EMPTY_ORGANIZATIONS;
  const requestedSupportOrganizationId = new URLSearchParams(location.search)
    .get("supportOrganization");
  const leavesSupportWorkspace = !requestedSupportOrganizationId && (
    location.pathname === "/organizer/site-admins"
    || location.pathname === "/organizer/requests"
  );
  const supportRequestDenied = Boolean(
    requestedSupportOrganizationId
    && account
    && !account.platformRole,
  );
  const [platformSupportOrganizationId, setPlatformSupportOrganizationIdState] = useState<string | null>(() => (
    requestedSupportOrganizationId
    ?? (leavesSupportWorkspace ? null : readPlatformSupportOrganizationId())
  ));
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [defaultOrganizationId, setDefaultOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    if (!account?.userId) {
      setPlatformSupportOrganizationIdState(null);
      return;
    }
    if (!account.platformRole) {
      clearPlatformSupportOrganizationId();
      setPlatformSupportOrganizationIdState(null);
      return;
    }
    if (requestedSupportOrganizationId) {
      setPlatformSupportOrganizationId(requestedSupportOrganizationId);
      setPlatformSupportOrganizationIdState(requestedSupportOrganizationId);
      return;
    }
    if (leavesSupportWorkspace) {
      clearPlatformSupportOrganizationId();
      setPlatformSupportOrganizationIdState(null);
      return;
    }
    setPlatformSupportOrganizationIdState(readPlatformSupportOrganizationId());
  }, [
    account?.platformRole,
    account?.userId,
    leavesSupportWorkspace,
    requestedSupportOrganizationId,
  ]);

  const supportOrganizationQuery = useQuery({
    queryKey: ["platform-organization-support-context", platformSupportOrganizationId],
    queryFn: () => getPlatformOrganizationSupportContext({
      organizationId: platformSupportOrganizationId ?? "",
      accessToken: session?.access_token,
    }),
    enabled: Boolean(
      platformSupportOrganizationId
      && Boolean(account?.platformRole)
      && session?.access_token,
    ),
    staleTime: 60_000,
  });
  const platformSupportOrganization = useMemo<OrganizationAccess | null>(() => {
    const organization = supportOrganizationQuery.data;
    if (!organization || !platformSupportOrganizationId) return null;
    return {
      organizationId: organization.organizationId,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      organizationKind: organization.kind,
      linkedClubId: null,
      linkedClubSlug: null,
      linkedClubName: null,
      role: "platform_support",
      membershipType: "permanent",
      loginUsername: null,
      permissions: [...ORGANIZATION_PERMISSIONS],
      expiresAt: null,
    };
  }, [platformSupportOrganizationId, supportOrganizationQuery.data]);
  const isPlatformSupportMode = Boolean(
    platformSupportOrganizationId
    && platformSupportOrganization,
  );
  const organizations = useMemo(
    () => isPlatformSupportMode && platformSupportOrganization
      ? [platformSupportOrganization]
      : membershipOrganizations,
    [isPlatformSupportMode, membershipOrganizations, platformSupportOrganization],
  );

  useEffect(() => {
    if (platformSupportOrganizationId) {
      setSelectedOrganizationId(platformSupportOrganizationId);
      setDefaultOrganizationId(null);
      return;
    }
    if (!account?.userId || !membershipOrganizations.length) {
      setSelectedOrganizationId(null);
      setDefaultOrganizationId(null);
      return;
    }

    const storedId = window.localStorage.getItem(organizerWorkspaceStorageKey(account.userId));
    const nextId = membershipOrganizations.some((organization) => organization.organizationId === storedId)
      ? storedId
      : membershipOrganizations[0].organizationId;
    const sessionId = window.sessionStorage.getItem(organizerWorkspaceSessionStorageKey(account.userId));
    setDefaultOrganizationId(nextId);
    setSelectedOrganizationId(
      membershipOrganizations.some((organization) => organization.organizationId === sessionId)
        ? sessionId
        : nextId
    );
  }, [account?.userId, membershipOrganizations, platformSupportOrganizationId]);

  const selectedOrganization = useMemo(
    () =>
      organizations.find(
        (organization) => organization.organizationId === selectedOrganizationId,
      ) ?? organizations[0] ?? null,
    [organizations, selectedOrganizationId],
  );
  const accountForWorkspace = useMemo(
    () => scopeOrganizerAccount(account, selectedOrganization),
    [account, selectedOrganization],
  );

  function selectOrganization(organizationId: string) {
    if (isPlatformSupportMode) return;
    if (!account?.userId) return;
    if (!organizations.some((organization) => organization.organizationId === organizationId)) {
      return;
    }
    // Native-route transitions can remount this provider. Keep the user's
    // current workspace in this tab without changing their saved default.
    window.sessionStorage.setItem(organizerWorkspaceSessionStorageKey(account.userId), organizationId);
    setSelectedOrganizationId(organizationId);
  }

  function setDefaultOrganization(organizationId: string) {
    if (isPlatformSupportMode) return;
    if (!account?.userId) return;
    if (!organizations.some((organization) => organization.organizationId === organizationId)) {
      return;
    }
    window.localStorage.setItem(organizerWorkspaceStorageKey(account.userId), organizationId);
    setDefaultOrganizationId(organizationId);
  }

  function exitPlatformSupportMode() {
    clearPlatformSupportOrganizationId();
    setPlatformSupportOrganizationIdState(null);
  }

  if (supportRequestDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-soft">
          <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 font-display text-xl font-bold">Platform administrator access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Organization support mode is limited to platform administrators.
          </p>
          <Button asChild className="mt-5"><Link to="/organizer/site-admins?section=organizations">Return to platform administration</Link></Button>
        </div>
      </div>
    );
  }

  if (platformSupportOrganizationId && !account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading support workspace…
        </div>
      </div>
    );
  }

  if (
    platformSupportOrganizationId
    && Boolean(account?.platformRole)
    && (!session?.access_token || supportOrganizationQuery.isLoading)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading support workspace…
        </div>
      </div>
    );
  }

  if (
    platformSupportOrganizationId
    && Boolean(account?.platformRole)
    && (supportOrganizationQuery.error || !platformSupportOrganization)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-soft">
          <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 font-display text-xl font-bold">Support workspace unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The selected organization could not be opened. It may no longer exist or may not be an organizer workspace.
          </p>
          <Button asChild className="mt-5"><Link to="/organizer/site-admins?section=organizations" onClick={exitPlatformSupportMode}>Return to organizations</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <OrganizerWorkspaceContext.Provider
      value={{
        account: accountForWorkspace,
        unscopedAccount: account,
        organizations,
        selectedOrganization,
        selectedOrganizationId: selectedOrganization?.organizationId ?? null,
        defaultOrganizationId: isPlatformSupportMode ? null : defaultOrganizationId,
        isPlatformSupportMode,
        platformSupportOrganizationId: platformSupportOrganization?.organizationId ?? null,
        platformSupportOrganizationName: platformSupportOrganization?.organizationName ?? null,
        selectOrganization,
        setDefaultOrganization,
        exitPlatformSupportMode,
      }}
    >
      {children}
    </OrganizerWorkspaceContext.Provider>
  );
}
