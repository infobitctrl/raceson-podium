import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { apiRequest } from "@/lib/api";
import { authRedirectUrl, parseRequestedAppRoles } from "@/lib/auth-security";
import { publicEnv } from "@/lib/public-env";
import { getSupabaseBrowserClient, getSupabaseStorageKey, hasSupabaseConfig } from "@/lib/supabase";
import { resolveBrowserLocale } from "@/shared/i18n/browser-locale";
import { clearPlatformSupportOrganizationId } from "@/shared/platform/platformSupportWorkspace";

export type AppRole = "athlete" | "organizer" | "timer" | "sponsor";
export type AccountTypeSelection = "athlete" | "athlete-organizer" | "organizer";
export type PlatformRole = "super_admin" | "site_admin";
export type PlatformTestingRole = "test_admin" | "test_timer" | "test_organizer";
export type OrganizationMembershipType = "permanent" | "temporary";
export type OrganizationPermission =
  | "organization.manage"
  | "team.manage"
  | "events.manage"
  | "entrants.manage"
  | "race_day.manage"
  | "checkpoint_timing.enter"
  | "results.manage"
  | "communications.manage"
  | "safety.manage"
  | "logistics.manage"
  | "finance.manage";

export function athleteProfileBootstrapRoles(): AppRole[] {
  return ["athlete"];
}

export type OrganizationAccess = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  organizationKind: "organizer" | "club";
  linkedClubId: string | null;
  linkedClubSlug: string | null;
  linkedClubName: string | null;
  role: string;
  membershipType: OrganizationMembershipType;
  loginUsername: string | null;
  permissions: OrganizationPermission[];
  expiresAt: string | null;
};

export type EventAccess = {
  assignmentId: string;
  eventEditionId: string;
  organizationId: string;
  eventCategoryId: string | null;
  checkpointId: string | null;
  roleTitle: string;
  permissions: OrganizationPermission[];
  startsAt: string;
  endsAt: string;
};

export type AuthAccountContext = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  authProviders: string[];
  requestedRoles: AppRole[];
  organizerSetupEnabled: boolean;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: "F" | "M" | "U" | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  jobTitle: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  shirtSize: string | null;
  mealPreference?: string | null;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  defaultRole: AppRole | null;
  primaryAthleteProfileId: string | null;
  primaryAthleteSlug: string | null;
  organizationIds: string[];
  organizationSlugs: string[];
  organizationNames: string[];
  organizationRoles: string[];
  organizations: OrganizationAccess[];
  eventAccess: EventAccess[];
  isMasterAdmin: boolean;
  platformRole: PlatformRole | null;
  canManagePlatformAdmins: boolean;
  testingRole: PlatformTestingRole | null;
  hasTestingAccess: boolean;
  accountType: "master_admin" | "testing" | "owner" | "permanent" | "temporary" | "athlete";
  loginUsername: string | null;
  usernameChangeAvailableAt: string | null;
  hasAthleteAccess: boolean;
  hasOrganizerAccess: boolean;
};

export const ORGANIZATION_PERMISSIONS = [
  "organization.manage",
  "team.manage",
  "events.manage",
  "entrants.manage",
  "race_day.manage",
  "checkpoint_timing.enter",
  "results.manage",
  "communications.manage",
  "safety.manage",
  "logistics.manage",
  "finance.manage",
] as const satisfies readonly OrganizationPermission[];

export function hasOrganizationPermission(
  account: AuthAccountContext | null | undefined,
  permission: OrganizationPermission,
) {
  if (!account?.hasOrganizerAccess) return false;
  if (account.isMasterAdmin) return true;
  return account.organizations.some(
    (organization) =>
      organization.membershipType === "permanent"
      &&
      (
        organization.role === "owner"
        || (
          organization.role === "admin"
          && organization.permissions.includes(permission)
        )
      ),
  );
}

export function hasEventPermission(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
  permission: OrganizationPermission,
) {
  if (!account?.hasOrganizerAccess) return false;
  if (hasOrganizationPermission(account, permission)) return true;
  return Boolean(
    account?.eventAccess.some(
      (assignment) =>
        assignment.eventEditionId === eventEditionId
        && assignment.permissions.includes(permission),
    ),
  );
}

export function hasAnyOrganizationPermission(
  account: AuthAccountContext | null | undefined,
  permissions: readonly OrganizationPermission[],
) {
  return permissions.some((permission) =>
    hasOrganizationPermission(account, permission),
  );
}

export function hasOrganizerWorkspaceAccess(
  account: AuthAccountContext | null | undefined,
) {
  return Boolean(
    account?.hasOrganizerAccess
    || account?.organizerSetupEnabled,
  );
}

type SignInInput = {
  identifier: string;
  password: string;
};

type SignUpInput = {
  username: string;
  email?: string;
  password: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  roles: AppRole[];
  dateOfBirth?: string;
  gender?: "F" | "M" | "U";
  phone?: string;
  shirtSize?: string;
  claimAthleteProfileId?: string | null;
  nextPath?: string | null;
};

export type SignUpResult = {
  account: AuthAccountContext | null;
  username: string;
  email: string | null;
  needsEmailVerification: boolean;
  pendingSignUp: { userId: string; cancelToken: string } | null;
};

type PasswordSessionResponse = {
  account: AuthAccountContext;
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
};

type SignUpSessionResponse =
  | (PasswordSessionResponse & { needsEmailVerification: false })
  | {
      account: null;
      session: null;
      needsEmailVerification: true;
      pendingSignUp: { userId: string; cancelToken: string };
    };

type DeleteAccountResult = {
  deleted: boolean;
  cleanupSummary?: Record<string, unknown> | null;
};

type UpdateAccountSettingsInput = {
  displayName: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: "F" | "M" | "U" | null;
  city?: string;
  countryCode?: string;
  phone?: string;
  jobTitle?: string;
  bio?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  youtubeUrl?: string;
  tiktokUrl?: string;
  xUrl?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  shirtSize?: string;
  mealPreference?: string;
  locale?: string;
  timezone?: string;
  avatarUrl?: string;
  coverImageUrl?: string;
  organizerSetupEnabled?: boolean;
};

type AuthContextValue = {
  hasSupabase: boolean;
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  account: AuthAccountContext | null;
  signIn: (input: SignInInput) => Promise<AuthAccountContext | null>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  checkSignUpAvailability: (input: Pick<SignUpInput, "username" | "email">) => Promise<void>;
  cancelPendingSignUp: (input: { userId: string; cancelToken: string }) => Promise<void>;
  requestPasswordReset: (identifier: string) => Promise<{
    accepted: boolean;
    rateLimited?: boolean;
  }>;
  resendVerificationEmail: (email: string) => Promise<void>;
  finalizePendingSignUp: () => Promise<{ account: AuthAccountContext; claimRequested: boolean }>;
  changeEmail: (email: string, confirmationPath?: string) => Promise<string>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  changeUsername: (username: string, currentPassword: string) => Promise<AuthAccountContext>;
  updatePassword: (password: string) => Promise<void>;
  updateAccountSettings: (input: UpdateAccountSettingsInput) => Promise<AuthAccountContext>;
  updateAccountType: (accountType: AccountTypeSelection) => Promise<AuthAccountContext>;
  enableAthleteProfile: () => Promise<AuthAccountContext>;
  deleteAccount: (confirmation: string) => Promise<void>;
  refreshAccountContext: () => Promise<AuthAccountContext | null>;
  signOut: () => Promise<void>;
  getDefaultRoute: (account?: AuthAccountContext | null) => string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function clearAuthBoundQueryCache(queryClient: Pick<QueryClient, "clear">) {
  queryClient.clear();
}

export function AuthIdentityCacheBoundary({
  cacheEpoch,
  children,
}: {
  cacheEpoch: number;
  children: ReactNode;
}) {
  return <Fragment key={cacheEpoch}>{children}</Fragment>;
}

function currentLocale() {
  return resolveBrowserLocale();
}

function currentTimezone() {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved || "Europe/Zagreb";
  } catch {
    return "Europe/Zagreb";
  }
}

function isStaleRefreshTokenError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("refresh token") &&
    (message.includes("already used") ||
      message.includes("invalid") ||
      message.includes("revoked") ||
      message.includes("not found"))
  );
}

function isSupabaseNetworkError(error: unknown) {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror");
}

function formatSupabaseNetworkError(action: string) {
  const configuredUrl = publicEnv.supabaseUrl;
  const target = configuredUrl || "the configured Supabase auth endpoint";
  return new Error(
    `Unable to ${action} because Supabase auth at ${target} is unreachable. Start the local Supabase stack or update NEXT_PUBLIC_SUPABASE_URL in apps/web/.env.local.`,
  );
}

function publicFacingAuthUser(user: User | null) {
  if (!user || user.app_metadata?.trail_credential_mode !== "username") {
    return user;
  }

  return {
    ...user,
    email: undefined,
  };
}

function authMetadataDisplayName(user: Pick<User, "user_metadata"> | null | undefined) {
  const metadata =
    user?.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : null;

  if (!metadata) return null;

  const displayName = typeof metadata.display_name === "string"
    ? metadata.display_name.trim()
    : "";
  if (displayName) return displayName;

  const firstName = typeof metadata.first_name === "string"
    ? metadata.first_name.trim()
    : "";
  const lastName = typeof metadata.last_name === "string"
    ? metadata.last_name.trim()
    : "";
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined || null;
}

function authMetadataValue(
  user: Pick<User, "user_metadata"> | null | undefined,
  key: string,
) {
  const metadata =
    user?.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : null;

  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function normalizeGender(value: unknown): "F" | "M" | "U" | null {
  return value === "F" || value === "M" || value === "U" ? value : null;
}

function authMetadataRequestedRoles(user: Pick<User, "user_metadata"> | null | undefined): AppRole[] {
  const metadata =
    user?.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : null;

  return parseRequestedAppRoles(metadata?.requested_roles);
}

function accountBootstrapDisplayName(
  user: Pick<User, "email" | "user_metadata">,
  account?: AuthAccountContext | null,
) {
  return (
    authMetadataDisplayName(user) ??
    account?.displayName ??
    user.email?.split("@")[0] ??
    "RacesOn User"
  );
}

function applyPreferredDisplayName(
  account: AuthAccountContext | null,
  user: Pick<User, "user_metadata"> | null | undefined,
) {
  if (!account) return account;

  const preferredDisplayName = authMetadataDisplayName(user);
  if (!preferredDisplayName || account.displayName.trim().length > 0) return account;

  return {
    ...account,
    displayName: preferredDisplayName,
  };
}

async function clearBrokenBrowserSession(client: SupabaseClient) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(getSupabaseStorageKey());
    }
  }
}

async function bootstrapCurrentUserAccount(
  _client: SupabaseClient,
  input: {
    roles: AppRole[];
    displayName: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string | null;
    gender?: "F" | "M" | "U" | null;
    phone?: string | null;
    shirtSize?: string | null;
  },
  session?: Session | null,
) {
  const nextSession =
    session ??
    (await _client.auth.getSession()).data.session;

  if (!nextSession?.access_token) {
    throw new Error("A signed-in session is required to set up this account.");
  }

  return apiRequest<AuthAccountContext>({
    path: "/v1/account/bootstrap",
    method: "POST",
    accessToken: nextSession.access_token,
    body: {
      roles: input.roles,
      displayName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      phone: input.phone,
      shirtSize: input.shirtSize,
      locale: currentLocale(),
      timezone: currentTimezone(),
      createAthleteProfile: input.roles.includes("athlete"),
    },
  });
}

async function ensureDemoRoleAccess(
  client: SupabaseClient,
  role: AppRole,
  user: Pick<User, "id" | "email" | "user_metadata" | "app_metadata" | "email_confirmed_at">,
  session: Session | null,
  account: AuthAccountContext | null,
) {
  const hasRequestedAccess =
    role === "athlete"
      ? account?.hasAthleteAccess
      : account?.hasOrganizerAccess;

  if (hasRequestedAccess) {
    return account;
  }

  await bootstrapCurrentUserAccount(
    client,
    {
      roles: [role],
      displayName: accountBootstrapDisplayName(user, account),
    },
    session,
  );

  return fetchUserAccountContext(client, user, session);
}

async function loadUserAccountContextFromApi(session: Session | null | undefined) {
  if (!session?.access_token) return null;
  return apiRequest<AuthAccountContext>({
    path: "/v1/account/context",
    accessToken: session.access_token,
  });
}

async function fetchUserAccountContext(
  client: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata" | "app_metadata" | "email_confirmed_at">,
  session?: Session | null,
): Promise<AuthAccountContext> {
  const nextSession =
    session ??
    (await client.auth.getSession()).data.session;

  if (!nextSession?.access_token) {
    throw new Error("A signed-in session is required to load this account.");
  }

  const account = await loadUserAccountContextFromApi(nextSession);
  if (!account) throw new Error("Unable to load the signed-in account.");
  return applyPreferredDisplayName(account, user);
}

async function ensureCurrentUserAccountContext(
  client: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata" | "app_metadata" | "email_confirmed_at">,
  session: Session | null,
  account: AuthAccountContext,
) {
  if (account.hasAthleteAccess || account.hasOrganizerAccess) {
    return account;
  }

  await bootstrapCurrentUserAccount(
    client,
    {
      roles: authMetadataRequestedRoles(user),
      displayName: accountBootstrapDisplayName(user, account),
      dateOfBirth: authMetadataValue(user, "date_of_birth"),
      gender: normalizeGender(authMetadataValue(user, "gender")),
      phone: authMetadataValue(user, "phone"),
      shirtSize: authMetadataValue(user, "shirt_size"),
    },
    session,
  );

  return fetchUserAccountContext(client, user, session);
}

export async function loadUserAccountContext(
  client: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata" | "app_metadata" | "email_confirmed_at">,
  session?: Session | null,
): Promise<AuthAccountContext> {
  const nextSession =
    session ??
    (await client.auth.getSession()).data.session;

  const account = await fetchUserAccountContext(client, user, nextSession);

  if (
    !account.hasAthleteAccess
    && !account.hasOrganizerAccess
    && !account.hasTestingAccess
    // Verified Podium sponsors already have an account. Do not run the
    // sporting-role bootstrap merely because they have no athlete role.
    && !(publicEnv.rewardDemo && user.app_metadata?.podium_registration_purpose === "sponsor")
    && nextSession?.access_token
  ) {
    try {
      return await ensureCurrentUserAccountContext(client, user, nextSession, account);
    } catch (error) {
      console.warn("Unable to auto-bootstrap current user account", error);
    }
  }

  return account;
}

export async function resolveCurrentUserAccountContext() {
  const client = getSupabaseBrowserClient();
  if (!client) return null;

  const [
    {
      data: { user },
    },
    sessionResult,
  ] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);

  if (sessionResult.error && isStaleRefreshTokenError(sessionResult.error)) {
    await clearBrokenBrowserSession(client);
    return null;
  }

  const session = sessionResult.data.session;

  if (!user) return null;
  return loadUserAccountContext(client, user, session);
}

export function defaultRouteForAccount(account: AuthAccountContext | null | undefined) {
  // The isolated Podium app owns its landing page regardless of sporting role.
  if (publicEnv.rewardDemo) return "/rewards";
  if (!account) return "/athlete/dashboard";
  if (account.testingRole) {
    return "/organizer/testing";
  }
  if (account.organizerSetupEnabled && !account.hasOrganizerAccess) {
    return "/organizer/dashboard";
  }
  const hasOrganizationAdminAccess = account.hasOrganizerAccess && (
    account.isMasterAdmin || account.organizations.some(
      (organization) =>
        organization.membershipType === "permanent"
        && ["owner", "admin", "master_admin"].includes(organization.role),
    )
  );
  if (hasOrganizationAdminAccess) return "/organizer/dashboard";
  if (
    account.accountType === "temporary"
    || (account.defaultRole === "timer" && account.hasOrganizerAccess)
  ) {
    return "/organizer/race-operations?phase=race";
  }
  if (
    account.hasOrganizerAccess
    && !hasOrganizationAdminAccess
    && account.eventAccess.length
  ) {
    return account.eventAccess.some((assignment) =>
      assignment.permissions.some((permission) =>
        [
          "entrants.manage",
          "race_day.manage",
          "checkpoint_timing.enter",
          "safety.manage",
          "logistics.manage",
        ].includes(
          permission,
        )
      )
    )
      ? "/organizer/race-operations?phase=race"
      : "/organizer/timing-results";
  }
  if (account.defaultRole === "organizer" && account.hasOrganizerAccess) {
    return "/organizer/dashboard";
  }
  if (account.hasAthleteAccess) {
    return "/athlete/dashboard";
  }
  if (hasOrganizerWorkspaceAccess(account)) {
    return "/organizer/dashboard";
  }
  return "/athlete/dashboard";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [queryCacheEpoch, setQueryCacheEpoch] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<AuthAccountContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resetAuthBoundQueryCache = useCallback(() => {
    clearAuthBoundQueryCache(queryClient);
    setQueryCacheEpoch((current) => current + 1);
  }, [queryClient]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let activeUserId: string | null = null;

    async function resolveAccount(nextUser: User, nextSession: Session | null) {
      try {
        const nextAccount = await loadUserAccountContext(client, nextUser, nextSession);
        if (!isMounted) return;
        setAccount(nextAccount);
      } catch (error) {
        console.warn("Unable to load account context", error);
        if (!isMounted) return;
        setAccount((current) => (current?.userId === nextUser.id ? current : null));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    async function initialize() {
      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.error && isStaleRefreshTokenError(sessionResult.error)) {
          await clearBrokenBrowserSession(client);
        }
        const nextSession = sessionResult.data.session;
        const nextUser = nextSession?.user ?? null;

        if (!isMounted) return;

        const nextUserId = nextUser?.id ?? null;
        if (activeUserId !== nextUserId) resetAuthBoundQueryCache();
        activeUserId = nextUserId;
        setSession(nextSession);
        setUser(publicFacingAuthUser(nextUser));

        if (!nextUser) {
          setAccount(null);
          setIsLoading(false);
          return;
        }

        setIsLoading(true);
        await resolveAccount(nextUser, nextSession);
      } catch (error) {
        console.warn("Unable to initialize auth state", error);
        if (!isMounted) return;
        setSession(null);
        setUser(null);
        setAccount(null);
        setIsLoading(false);
      }
    }

    initialize();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      const nextUser = nextSession?.user ?? null;
      const previousUserId = activeUserId;
      activeUserId = nextUser?.id ?? null;
      if (previousUserId !== activeUserId) resetAuthBoundQueryCache();
      setSession(nextSession);
      setUser(publicFacingAuthUser(nextUser));

      if (!nextUser) {
        setAccount(null);
        setIsLoading(false);
        return;
      }

      // initialize() owns the first account-context load. Supabase may also emit
      // INITIAL_SESSION for that same session, and routine token refreshes can
      // emit SIGNED_IN again. Reloading the account for those same-user events
      // interrupts in-progress forms and briefly disables their submit actions.
      if (
        event === "INITIAL_SESSION"
        || event === "TOKEN_REFRESHED"
        || (event === "SIGNED_IN" && previousUserId === nextUser.id)
      ) {
        return;
      }

      setIsLoading(true);
      void resolveAccount(nextUser, nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient, resetAuthBoundQueryCache]);

  async function signIn(input: SignInInput) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    let result: PasswordSessionResponse;
    try {
      result = await apiRequest<PasswordSessionResponse>({
        path: "/v1/public/auth/sign-in",
        method: "POST",
        accessToken: null,
        body: input,
      });
    } catch (caughtError) {
      if (isSupabaseNetworkError(caughtError)) {
        throw formatSupabaseNetworkError("sign in");
      }
      throw caughtError;
    }

    resetAuthBoundQueryCache();
    const { error: setSessionError } = await client.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });
    if (setSessionError) throw setSessionError;

    setAccount(result.account);
    return result.account;
  }

  async function signUp(input: SignUpInput) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    let result: SignUpSessionResponse;
    try {
      result = await apiRequest<SignUpSessionResponse>({
        path: "/v1/public/auth/sign-up",
        method: "POST",
        accessToken: null,
        body: {
          ...input,
          email: input.email?.trim() || null,
          locale: currentLocale(),
          timezone: currentTimezone(),
        },
      });
    } catch (caughtError) {
      if (isSupabaseNetworkError(caughtError)) {
        throw formatSupabaseNetworkError("create an account");
      }
      throw caughtError;
    }

    if (result.needsEmailVerification) {
      return {
        account: null,
        username: input.username.trim().toLowerCase(),
        email: input.email?.trim().toLowerCase() || null,
        needsEmailVerification: true,
        pendingSignUp: result.pendingSignUp,
      };
    }

    resetAuthBoundQueryCache();
    const { error: setSessionError } = await client.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });
    if (setSessionError) throw setSessionError;

    setAccount(result.account);
    return {
      account: result.account,
      username: input.username.trim().toLowerCase(),
      email: input.email?.trim().toLowerCase() || null,
      needsEmailVerification: false,
      pendingSignUp: null,
    };
  }

  async function checkSignUpAvailability(
    input: Pick<SignUpInput, "username" | "email">,
  ) {
    await apiRequest<{ available: true }>({
      path: "/v1/public/auth/sign-up-availability",
      method: "POST",
      accessToken: null,
      body: {
        username: input.username.trim().toLowerCase(),
        email: input.email?.trim().toLowerCase() || null,
      },
    });
  }

  async function cancelPendingSignUp(input: { userId: string; cancelToken: string }) {
    await apiRequest<{ cancelled: true }>({
      path: "/v1/public/auth/cancel-pending-sign-up",
      method: "POST",
      accessToken: null,
      body: input,
    });
  }

  async function signOut() {
    clearPlatformSupportOrganizationId();
    resetAuthBoundQueryCache();
    setSession(null);
    setUser(null);
    setAccount(null);
    const client = getSupabaseBrowserClient();
    if (!client) return;
    await apiRequest<{ revoked: boolean }>({
      path: "/v1/public/auth/sign-out",
      method: "POST",
      accessToken: null,
    }).catch(() => undefined);
    await client.auth.signOut({ scope: "local" });
  }

  async function updateAccountSettings(input: UpdateAccountSettingsInput) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!currentSession?.access_token) {
      throw new Error("You need to be signed in to update account settings.");
    }

    const updatedAccount = await apiRequest<AuthAccountContext>({
      path: "/v1/account/settings",
      method: "POST",
      accessToken: currentSession.access_token,
      body: {
        displayName: input.displayName.trim(),
        firstName: input.firstName?.trim() ? input.firstName.trim() : null,
        lastName: input.lastName?.trim() ? input.lastName.trim() : null,
        dateOfBirth: input.dateOfBirth?.trim() ? input.dateOfBirth.trim() : null,
        gender: input.gender ?? null,
        city: input.city?.trim() ? input.city.trim() : null,
        countryCode: input.countryCode?.trim() ? input.countryCode.trim().toUpperCase() : null,
        phone: input.phone?.trim() ? input.phone.trim() : null,
        jobTitle: input.jobTitle?.trim() ? input.jobTitle.trim() : null,
        bio: input.bio?.trim() ? input.bio.trim() : null,
        websiteUrl: input.websiteUrl?.trim() ? input.websiteUrl.trim() : null,
        instagramUrl: input.instagramUrl?.trim() ? input.instagramUrl.trim() : null,
        facebookUrl: input.facebookUrl?.trim() ? input.facebookUrl.trim() : null,
        linkedinUrl: input.linkedinUrl?.trim() ? input.linkedinUrl.trim() : null,
        youtubeUrl: input.youtubeUrl?.trim() ? input.youtubeUrl.trim() : null,
        tiktokUrl: input.tiktokUrl?.trim() ? input.tiktokUrl.trim() : null,
        xUrl: input.xUrl?.trim() ? input.xUrl.trim() : null,
        emergencyContactName: input.emergencyContactName?.trim() ? input.emergencyContactName.trim() : null,
        emergencyContactPhone: input.emergencyContactPhone?.trim() ? input.emergencyContactPhone.trim() : null,
        shirtSize: input.shirtSize?.trim() ? input.shirtSize.trim().toUpperCase() : null,
        mealPreference: input.mealPreference === undefined ? undefined : input.mealPreference.trim() || null,
        locale: input.locale?.trim() ? input.locale.trim() : null,
        timezone: input.timezone?.trim() ? input.timezone.trim() : null,
        avatarUrl: input.avatarUrl?.trim() ? input.avatarUrl.trim() : null,
        coverImageUrl: input.coverImageUrl?.trim() ? input.coverImageUrl.trim() : null,
        organizerSetupEnabled: input.organizerSetupEnabled,
      },
    });

    setAccount(updatedAccount);
    return updatedAccount;
  }

  async function updateAccountType(accountType: AccountTypeSelection) {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");
    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!currentSession?.access_token) {
      throw new Error("You need to be signed in to change the account type.");
    }

    const updatedAccount = await apiRequest<AuthAccountContext>({
      path: "/v1/account/type",
      method: "POST",
      accessToken: currentSession.access_token,
      body: { accountType },
    });
    setAccount(updatedAccount);
    return updatedAccount;
  }

  async function enableAthleteProfile() {
    return updateAccountType(
      account?.organizerSetupEnabled || account?.hasOrganizerAccess
        ? "athlete-organizer"
        : "athlete",
    );
  }

  async function deleteAccount(confirmation: string) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!currentSession?.access_token) {
      throw new Error("You need to be signed in to delete this account.");
    }

    await apiRequest<DeleteAccountResult>({
      path: "/v1/account/delete",
      method: "POST",
      accessToken: currentSession.access_token,
      body: {
        confirmation,
      },
    });

    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      await clearBrokenBrowserSession(client);
    }
    await apiRequest<{ revoked: boolean }>({
      path: "/v1/public/auth/sign-out",
      method: "POST",
      accessToken: null,
    }).catch(() => undefined);

    resetAuthBoundQueryCache();
    setSession(null);
    setUser(null);
    setAccount(null);
  }

  async function refreshAccountContext() {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return null;
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const nextUser = currentSession?.user ?? null;
    setSession(currentSession);
    setUser(publicFacingAuthUser(nextUser));

    if (!nextUser) {
      setAccount(null);
      return null;
    }

    const nextAccount = await loadUserAccountContext(client, nextUser, currentSession);
    setAccount(nextAccount);
    return nextAccount;
  }

  async function requestPasswordReset(identifier: string) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();
    const accountIdentifiers = [account?.email, account?.loginUsername]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());
    const useAuthenticatedRecovery = Boolean(
      session?.access_token && accountIdentifiers.includes(normalizedIdentifier),
    );

    return apiRequest<{ accepted: boolean; rateLimited?: boolean }>({
      path: useAuthenticatedRecovery
        ? "/v1/account/password-reset"
        : "/v1/public/auth/password-reset",
      method: "POST",
      accessToken: useAuthenticatedRecovery ? session?.access_token : undefined,
      body: useAuthenticatedRecovery ? undefined : { identifier: normalizedIdentifier },
    });
  }

  async function resendVerificationEmail(email: string) {
    if (!getSupabaseBrowserClient()) {
      throw new Error("Supabase is not configured");
    }

    await apiRequest<{ accepted: boolean }>({
      path: "/v1/public/auth/resend-verification",
      method: "POST",
      body: { email },
    });
  }

  async function finalizePendingSignUp() {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");
    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!currentSession?.access_token) {
      throw new Error("A verified sign-in session is required to finish sign up.");
    }

    const result = await apiRequest<{
      account: AuthAccountContext;
      claimRequested: boolean;
    }>({
      path: "/v1/account/finalize-sign-up",
      method: "POST",
      accessToken: currentSession.access_token,
    });
    setAccount(result.account);
    return result;
  }

  async function changeEmail(email: string, confirmationPath = "/athlete/account?view=edit#athlete-security") {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Enter a valid email address.");
    }

    const currentEmail = (account?.email ?? user?.email ?? "").trim().toLowerCase();
    if (normalizedEmail === currentEmail) {
      throw new Error("Enter a different email address.");
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }
    if (!currentSession?.user) {
      throw new Error("You need to be signed in to change your email address.");
    }

    let updatedUser: User | null = null;
    let updateError;
    try {
      const result = await client.auth.updateUser(
        { email: normalizedEmail },
        { emailRedirectTo: authRedirectUrl(confirmationPath) },
      );
      updatedUser = result.data.user;
      updateError = result.error;
    } catch (caughtError) {
      if (isSupabaseNetworkError(caughtError)) {
        throw formatSupabaseNetworkError("request an email change");
      }
      throw caughtError;
    }

    if (updateError) throw updateError;
    if (!updatedUser) {
      throw new Error("Unable to start the email change.");
    }

    setUser(publicFacingAuthUser(updatedUser));
    return updatedUser.new_email?.trim().toLowerCase() || normalizedEmail;
  }

  async function updatePassword(password: string) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    let error;
    try {
      ({ error } = await client.auth.updateUser({ password }));
    } catch (caughtError) {
      if (isSupabaseNetworkError(caughtError)) {
        throw formatSupabaseNetworkError("update the password");
      }
      throw caughtError;
    }
    if (error) throw error;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }
    if (!currentSession?.access_token) {
      throw new Error("You need to be signed in to change your password.");
    }

    await apiRequest<{ changed: boolean }>({
      path: "/v1/account/password",
      method: "POST",
      accessToken: currentSession.access_token,
      body: {
        currentPassword,
        newPassword,
      },
    });
  }

  async function changeUsername(username: string, currentPassword: string) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      throw new Error("Supabase is not configured");
    }

    const {
      data: { session: currentSession },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }
    if (!currentSession?.access_token) {
      throw new Error("You need to be signed in to change your username.");
    }

    const updatedAccount = await apiRequest<AuthAccountContext>({
      path: "/v1/account/username",
      method: "POST",
      accessToken: currentSession.access_token,
      body: {
        username: username.trim().toLowerCase(),
        currentPassword,
      },
    });
    setAccount(updatedAccount);
    return updatedAccount;
  }

  return (
    <AuthContext.Provider
      value={{
        hasSupabase: hasSupabaseConfig(),
        isLoading,
        session,
        user,
        account,
        signIn,
        signUp,
        checkSignUpAvailability,
        cancelPendingSignUp,
        requestPasswordReset,
        resendVerificationEmail,
        finalizePendingSignUp,
        changeEmail,
        changePassword,
        changeUsername,
        updatePassword,
        updateAccountSettings,
        updateAccountType,
        enableAthleteProfile,
        deleteAccount,
        refreshAccountContext,
        signOut,
        getDefaultRoute: defaultRouteForAccount,
      }}
    >
      <AuthIdentityCacheBoundary cacheEpoch={queryCacheEpoch}>
        {children}
      </AuthIdentityCacheBoundary>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
