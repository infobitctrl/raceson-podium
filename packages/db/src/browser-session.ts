import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppRole, AthleteGender, RequestSession } from "@raceson/domain/auth";
import {
  logAuthSecurityEvent,
  normalizeEmailAddress,
  requestPasswordResetEmail,
  resolveAuthRedirectUrl,
} from "./auth-security.js";
import {
  findActiveAccountUsernameReservation,
  findAccountLoginIdentifier,
  normalizeAccountUsername,
  normalizeOptionalAccountEmail,
  resolveAccountLoginAuthEmail,
} from "./account-login.js";
import {
  bootstrapCurrentUserAccount,
  loadAccountContextForAccessToken,
  parseRequestedRoles,
  updateCurrentUserAccountType,
} from "./account.js";
import { submitCurrentUserAthleteProfileClaim } from "./identity-governance.js";
import {
  deriveTemporaryOrganizationPassword,
  resolveOrganizationLoginCredential,
  TEMPORARY_ACCOUNT_PASSWORD_MODE,
} from "./organization-team.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  accountAlreadyExists,
  ApiHttpError,
  unauthorized,
} from "./errors.js";
import {
  createAdminSupabaseClient,
  createServerAuthSupabaseClient,
} from "./supabase.js";
import { publicAuthProviderError } from "./auth-provider-errors.js";

export type BrowserAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresIn: number;
  tokenType: string;
  userId: string;
};

export type BrowserSessionEnvelope = {
  session: BrowserAuthSession;
  account: Awaited<ReturnType<typeof loadAccountContextForAccessToken>>;
};

export type BrowserSignUpResult =
  | (BrowserSessionEnvelope & { needsEmailVerification: false })
  | {
      session: null;
      account: null;
      needsEmailVerification: true;
      pendingSignUp: { userId: string; cancelToken: string };
    };

export type FinalizedBrowserSignUp = {
  account: Awaited<ReturnType<typeof loadAccountContextForAccessToken>>;
  claimRequested: boolean;
};

export type UsernameAccountSignUpInput = {
  registrationPurpose?: "sponsor";
  username: string;
  email?: string | null;
  password: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  roles: AppRole[];
  dateOfBirth?: string | null;
  gender?: AthleteGender | null;
  phone?: string | null;
  shirtSize?: string | null;
  locale?: string;
  timezone?: string;
  claimAthleteProfileId?: string | null;
  nextPath?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type UsernameAccountCredentialAvailability = {
  hasAccountIdentifier: boolean;
  hasOrganizationUsername: boolean;
  hasProfileEmail: boolean;
  hasReservedUsername: boolean;
};

export function normalizeBrowserSignInLookupError(error: unknown) {
  if (
    error instanceof ApiHttpError
    && error.status === 403
    && error.message === "Invalid username or password"
  ) {
    return unauthorized("Invalid username or password");
  }
  return error;
}

export function usernameAccountNeedsEmailVerification(input: {
  accountEmail: string | null;
  requestedRoles: readonly AppRole[];
  athleteEmailMatchStatus: string;
}) {
  return Boolean(input.accountEmail);
}

export function resolvePostVerificationAuthPath(nextPath: string | null | undefined) {
  const candidate = nextPath?.trim() ?? "";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/auth";
  }

  try {
    const parsed = new URL(candidate, "https://raceson.invalid");
    if (parsed.origin !== "https://raceson.invalid" || parsed.pathname === "/auth") {
      return "/auth";
    }
    const safeNextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `/auth?${new URLSearchParams({ next: safeNextPath }).toString()}`;
  } catch {
    return "/auth";
  }
}

export function assertUsernameAccountCredentialsAvailable(
  availability: UsernameAccountCredentialAvailability,
) {
  if (
    availability.hasAccountIdentifier
    || availability.hasOrganizationUsername
    || availability.hasProfileEmail
    || availability.hasReservedUsername
  ) {
    throw accountAlreadyExists();
  }
}

export async function assertUsernameAccountSignUpCredentialsAvailable(
  input: { username: string; email?: string | null },
  env: ServerEnv = loadServerEnv(),
) {
  const username = normalizeAccountUsername(input.username);
  const accountEmail = normalizeOptionalAccountEmail(input.email);
  const adminClient = createAdminSupabaseClient(env);
  const [
    existingAccountIdentifier,
    existingOrganizationUsername,
    existingProfileEmail,
    existingUsernameReservation,
  ] = await Promise.all([
    findAccountLoginIdentifier(username, env),
    adminClient
      .from("organization_memberships")
      .select("id")
      .eq("login_username", username)
      .neq("status", "removed")
      .maybeSingle<{ id: string }>(),
    accountEmail
      ? adminClient
          .from("user_profiles")
          .select("user_id")
          .eq("email", accountEmail)
          .maybeSingle<{ user_id: string }>()
      : Promise.resolve({ data: null, error: null }),
    findActiveAccountUsernameReservation(username, env),
  ]);

  if (existingOrganizationUsername.error) throw existingOrganizationUsername.error;
  if (existingProfileEmail.error) throw existingProfileEmail.error;
  assertUsernameAccountCredentialsAvailable({
    hasAccountIdentifier: Boolean(existingAccountIdentifier),
    hasOrganizationUsername: Boolean(existingOrganizationUsername.data),
    hasProfileEmail: Boolean(accountEmail && existingProfileEmail.data),
    hasReservedUsername: Boolean(existingUsernameReservation),
  });

  return { username, email: accountEmail };
}

function isInternalUsernameAuthEmail(email: string | null | undefined) {
  return Boolean(email?.trim().toLowerCase().endsWith("@accounts.sitrail.invalid"));
}

function pendingSignUpTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function matchesPendingSignUpToken(token: string, expectedHash: string) {
  const actual = Buffer.from(pendingSignUpTokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function requestBrowserPasswordReset(
  input: {
    identifier: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const identifier = input.identifier.trim().toLowerCase();
  const loginIdentifier = await findAccountLoginIdentifier(identifier, env);
  let authEmail = identifier.includes("@") ? identifier : null;

  if (loginIdentifier) {
    const adminClient = createAdminSupabaseClient(env);
    const { data, error } = await adminClient.auth.admin.getUserById(loginIdentifier.userId);
    if (error) throw error;
    authEmail = data.user?.email?.trim().toLowerCase() ?? null;
  }

  await requestPasswordResetEmail({
    email: authEmail && !isInternalUsernameAuthEmail(authEmail) ? authEmail : null,
    rateLimitIdentifier: identifier,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  }, env);

  // Password recovery is intentionally enumeration-safe. Callers must not be
  // able to distinguish a missing account, a username-only account, or a
  // provider-level email throttle from this public response.
  return { accepted: true };
}

export function currentAccountRecoveryEmail(
  account: Pick<RequestSession["account"], "email" | "emailVerified">,
) {
  const email = account.email?.trim().toLowerCase() ?? null;
  if (!email || !account.emailVerified) {
    throw new ApiHttpError(
      409,
      "recovery_email_unavailable",
      "Confirm an account email before requesting password recovery",
    );
  }
  return email;
}

export async function requestCurrentUserPasswordReset(
  session: RequestSession,
  input: {
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const email = currentAccountRecoveryEmail(session.account);
  return requestPasswordResetEmail({
    email,
    rateLimitIdentifier: email,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  }, env);
}

function authStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function sessionFromAuthData(data: {
  session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in: number;
    token_type: string;
    user: { id: string };
  } | null;
}): BrowserAuthSession {
  const session = data.session;
  if (!session?.access_token || !session.refresh_token || !session.user?.id) {
    throw unauthorized("Authentication session was not created");
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt:
      session.expires_at ??
      Math.floor(Date.now() / 1000) + Math.max(1, session.expires_in),
    expiresIn: Math.max(1, session.expires_in),
    tokenType: session.token_type || "bearer",
    userId: session.user.id,
  };
}

export async function signInBrowserSession(
  input: {
    email?: string;
    identifier?: string;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
): Promise<BrowserSessionEnvelope> {
  const identifier = input.identifier ?? input.email ?? "";
  const accountAuthEmail = await resolveAccountLoginAuthEmail(identifier, env);
  // The isolated copy has only operator-provisioned demo identities. Do not
  // consult organization credentials or expand its database grants on a typo.
  if (env.rewardHostedCopyPreview && !accountAuthEmail) {
    throw unauthorized("Invalid login credentials");
  }
  let organizationCredential = null;
  if (!accountAuthEmail) {
    try {
      organizationCredential = await resolveOrganizationLoginCredential(identifier, env);
    } catch (error) {
      throw normalizeBrowserSignInLookupError(error);
    }
  }
  const email = normalizeEmailAddress(
    accountAuthEmail ?? organizationCredential!.email,
  );
  const password =
    organizationCredential?.passwordMode === TEMPORARY_ACCOUNT_PASSWORD_MODE
    && organizationCredential.passwordSalt
      ? deriveTemporaryOrganizationPassword(
          organizationCredential.passwordSalt,
          input.password,
        )
      : input.password;
  const client = createServerAuthSupabaseClient(env);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    await logAuthSecurityEvent({
      email,
      eventType: "password_sign_in",
      eventStatus: "failure",
      metadata: {
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        statusCode: authStatus(error),
      },
    }, env);
    throw publicAuthProviderError(error, "sign_in");
  }

  const session = sessionFromAuthData(data);
  const account = await loadAccountContextForAccessToken(session.accessToken, env);
  await logAuthSecurityEvent({
    userId: session.userId,
    email,
    eventType: "password_sign_in",
    eventStatus: "success",
    metadata: {
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  }, env);

  return { session, account };
}

export async function signUpUsernameBrowserSession(
  input: UsernameAccountSignUpInput,
  env: ServerEnv = loadServerEnv(),
): Promise<BrowserSignUpResult> {
  const { username, email: accountEmail } =
    await assertUsernameAccountSignUpCredentialsAvailable(input, env);
  const adminClient = createAdminSupabaseClient(env);

  const requestedRoles: AppRole[] = input.registrationPurpose === "sponsor" ? ["sponsor"] : input.roles.length ? input.roles : ["athlete"];
  const requiresEmailVerification = usernameAccountNeedsEmailVerification({
    accountEmail,
    requestedRoles,
    athleteEmailMatchStatus: "not_checked",
  });
  const internalAuthEmail = `user-${randomUUID()}@accounts.sitrail.invalid`;
  const pendingSignUpCancelToken = randomUUID();
  const userMetadata = {
    display_name: input.displayName,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    requested_roles: requestedRoles,
    date_of_birth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    shirt_size: input.shirtSize ?? null,
    locale: input.locale ?? null,
    timezone: input.timezone ?? null,
    claim_athlete_profile_id: input.registrationPurpose === "sponsor" ? null : input.claimAthleteProfileId ?? null,
    raceson_signup_pending: requiresEmailVerification,
    raceson_signup_cancel_hash: requiresEmailVerification
      ? pendingSignUpTokenHash(pendingSignUpCancelToken)
      : null,
  };
  const emailRedirectTo = resolveAuthRedirectUrl(
    resolvePostVerificationAuthPath(input.nextPath),
    env,
  );
  const createdAuthResult = requiresEmailVerification
    ? await createServerAuthSupabaseClient(env).auth.signUp({
        email: accountEmail!,
        password: input.password,
        options: {
          data: userMetadata,
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      })
    : await adminClient.auth.admin.createUser({
        email: internalAuthEmail,
        password: input.password,
        email_confirm: true,
        app_metadata: {
          trail_credential_mode: "username",
        },
        user_metadata: userMetadata,
      });
  const createdAuth = createdAuthResult.data;
  const createdAuthSession = "session" in createdAuth
    ? createdAuth.session
    : null;
  const createAuthError = createdAuthResult.error;

  if (createAuthError || !createdAuth.user) {
    throw createAuthError
      ? publicAuthProviderError(createAuthError, "sign_up")
      : new ApiHttpError(
          503,
          "auth_service_unavailable",
          "Authentication service did not create an account",
        );
  }

  const userId = createdAuth.user.id;
  try {
    if (input.registrationPurpose === "sponsor") {
      const { error: purposeError } = await adminClient.auth.admin.updateUserById(userId, {
        app_metadata: { podium_registration_purpose: "sponsor" },
      });
      if (purposeError) throw purposeError;
    }
    const { error: identifierError } = await adminClient
      .from("account_login_identifiers")
      .insert({
        user_id: userId,
        username,
        email: accountEmail,
        username_changed_at: new Date().toISOString(),
      });
    if (identifierError) {
      if (identifierError.code === "23505") {
        throw accountAlreadyExists();
      }
      throw identifierError;
    }

    const { error: profileError } = await adminClient
      .from("user_profiles")
      .update({
        email: accountEmail,
        email_verified_at: null,
      })
      .eq("user_id", userId);
    if (profileError) throw profileError;

    if (requiresEmailVerification && !createdAuthSession) {
      await logAuthSecurityEvent({
        userId,
        email: accountEmail,
        eventType: "username_account_signup",
        eventStatus: "success",
        metadata: {
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          hasAccountEmail: true,
          needsEmailVerification: true,
          athleteEmailMatch: "not_checked",
        },
      }, env);
      return {
        session: null,
        account: null,
        needsEmailVerification: true,
        pendingSignUp: {
          userId,
          cancelToken: pendingSignUpCancelToken,
        },
      };
    }

    const session = requiresEmailVerification
      ? sessionFromAuthData({ session: createdAuthSession })
      : await (async () => {
          const authClient = createServerAuthSupabaseClient(env);
          const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
            email: internalAuthEmail,
            password: input.password,
          });
          if (signInError) throw publicAuthProviderError(signInError, "sign_in");
          return sessionFromAuthData(signInData);
        })();
    let account = await bootstrapCurrentUserAccount(session.accessToken, {
      roles: requestedRoles,
      displayName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      phone: input.phone,
      shirtSize: input.shirtSize,
      locale: input.locale,
      timezone: input.timezone,
      createAthleteProfile: requestedRoles.includes("athlete"),
    }, env);

    // Personal-profile bootstrap deliberately defaults to athlete-only. Keep
    // the explicit combined workspace choice made during this new signup.
    if (requestedRoles.includes("athlete") && requestedRoles.includes("organizer")) {
      account = await updateCurrentUserAccountType(session.accessToken, { accountType: "athlete-organizer" }, env);
    }

    if (input.registrationPurpose !== "sponsor" && input.claimAthleteProfileId) {
      await submitCurrentUserAthleteProfileClaim({
        accessToken: session.accessToken,
        account,
      }, input.claimAthleteProfileId, env);
    }

    await logAuthSecurityEvent({
      userId,
      email: accountEmail,
      eventType: "username_account_signup",
      eventStatus: "success",
      metadata: {
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        hasAccountEmail: Boolean(accountEmail),
      },
    }, env);

    return { session, account, needsEmailVerification: false };
  } catch (error) {
    try {
      await adminClient.rpc("delete_user_account_data", {
        target_user_id: userId,
        target_email: accountEmail,
      });
    } catch {
      // Best-effort cleanup continues with the Auth user deletion below.
    }
    await adminClient.auth.admin.deleteUser(userId, true).catch(() => undefined);
    throw error;
  }
}

export async function cancelPendingBrowserSignUp(
  input: { userId: string; cancelToken: string },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.auth.admin.getUserById(input.userId);
  const user = data.user;
  if (error || !user) throw unauthorized("Pending sign-up is invalid or expired");
  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? (user.user_metadata as Record<string, unknown>)
    : {};
  const expectedHash = typeof metadata.raceson_signup_cancel_hash === "string"
    ? metadata.raceson_signup_cancel_hash
    : "";
  if (
    user.email_confirmed_at
    || metadata.raceson_signup_pending !== true
    || !/^[a-f0-9]{64}$/.test(expectedHash)
    || !matchesPendingSignUpToken(input.cancelToken, expectedHash)
  ) {
    throw unauthorized("Pending sign-up is invalid or expired");
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id, true);
  if (deleteError) throw deleteError;
  const { error: cleanupError } = await adminClient.rpc("delete_user_account_data", {
    target_user_id: user.id,
    target_email: user.email ?? null,
  });
  if (cleanupError) throw cleanupError;
  // Auth soft deletion does not cascade to the username/email reservation.
  // A cancelled, unverified signup must be able to correct its email and retry.
  const { error: identifierError } = await adminClient
    .from("account_login_identifiers")
    .delete()
    .eq("user_id", user.id);
  if (identifierError) throw identifierError;
  return { cancelled: true as const };
}

function optionalMetadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function finalizeVerifiedBrowserSignUp(
  accessToken: string,
  env: ServerEnv = loadServerEnv(),
): Promise<FinalizedBrowserSignUp> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.auth.getUser(accessToken);
  const user = data.user;
  if (error || !user) throw unauthorized("Authentication session is invalid");

  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? (user.user_metadata as Record<string, unknown>)
    : {};
  if (metadata.raceson_signup_pending !== true) {
    return {
      account: await loadAccountContextForAccessToken(accessToken, env),
      claimRequested: false,
    };
  }
  if (!user.email_confirmed_at) {
    throw unauthorized("Verify the account email before finishing sign up");
  }

  const isSponsor = user.app_metadata?.podium_registration_purpose === "sponsor";
  const roles = isSponsor ? ["sponsor" as const] : parseRequestedRoles(
    Array.isArray(metadata.requested_roles) ? metadata.requested_roles : [],
  );
  let account = await bootstrapCurrentUserAccount(accessToken, {
    roles,
    displayName: optionalMetadataText(metadata, "display_name") ?? "RacesOn User",
    firstName: optionalMetadataText(metadata, "first_name"),
    lastName: optionalMetadataText(metadata, "last_name"),
    dateOfBirth: optionalMetadataText(metadata, "date_of_birth"),
    gender: metadata.gender === "F" || metadata.gender === "M" || metadata.gender === "U"
      ? metadata.gender
      : undefined,
    phone: optionalMetadataText(metadata, "phone"),
    shirtSize: optionalMetadataText(metadata, "shirt_size"),
    locale: optionalMetadataText(metadata, "locale"),
    timezone: optionalMetadataText(metadata, "timezone"),
    createAthleteProfile: roles.includes("athlete"),
  }, env);

  if (roles.includes("athlete") && roles.includes("organizer")) {
    account = await updateCurrentUserAccountType(accessToken, { accountType: "athlete-organizer" }, env);
  }

  const claimAthleteProfileId = isSponsor ? undefined : optionalMetadataText(metadata, "claim_athlete_profile_id");
  const claimRequested = Boolean(
    claimAthleteProfileId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimAthleteProfileId)
    && account.primaryAthleteProfileId !== claimAthleteProfileId,
  );
  if (claimRequested) {
    await submitCurrentUserAthleteProfileClaim({ accessToken, account }, claimAthleteProfileId!, env);
  }

  const { error: metadataError } = await adminClient.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...metadata,
      claim_athlete_profile_id: null,
      raceson_signup_cancel_hash: null,
      raceson_signup_pending: false,
    },
  });
  if (metadataError) throw metadataError;

  account = await loadAccountContextForAccessToken(accessToken, env);
  return { account, claimRequested };
}

export async function refreshBrowserSession(
  refreshToken: string,
  env: ServerEnv = loadServerEnv(),
): Promise<BrowserSessionEnvelope> {
  const client = createServerAuthSupabaseClient(env);
  const { data, error } = await client.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error) {
    if (authStatus(error) != null && authStatus(error)! >= 400 && authStatus(error)! < 500) {
      throw unauthorized("Session refresh failed");
    }
    throw error;
  }

  const session = sessionFromAuthData(data);
  const account = await loadAccountContextForAccessToken(session.accessToken, env);
  return { session, account };
}

export async function signOutBrowserSession(
  input: {
    accessToken: string | null;
    refreshToken: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  if (!input.accessToken || !input.refreshToken) {
    return { revoked: false };
  }

  const client = createServerAuthSupabaseClient(env);
  const setSessionResult = await client.auth.setSession({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
  });
  if (setSessionResult.error) {
    return { revoked: false };
  }
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error && authStatus(error) !== 401 && authStatus(error) !== 403) {
    throw new ApiHttpError(502, "auth_provider_error", "Unable to revoke the current session");
  }
  return { revoked: !error };
}
