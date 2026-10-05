import type { RequestSession } from "@raceson/domain/auth";
import { logAuthSecurityEvent } from "./auth-security.js";
import { badRequest, conflict, forbidden } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  createAdminSupabaseClient,
  createServerAuthSupabaseClient,
} from "./supabase.js";

export const ACCOUNT_USERNAME_CHANGE_COOLDOWN_DAYS = 30;
export const ACCOUNT_USERNAME_RESERVATION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "help",
  "login",
  "logout",
  "master",
  "root",
  "security",
  "signin",
  "signup",
  "sitrail",
  "support",
  "system",
  "trailportal",
]);

export type AccountLoginIdentifier = {
  userId: string;
  username: string;
  email: string | null;
  usernameChangedAt: string | null;
};

type AccountLoginIdentifierRow = {
  user_id: string;
  username: string;
  email: string | null;
  username_changed_at: string | null;
};

type AccountUsernameReservationRow = {
  username: string;
  user_id: string;
  reserved_until: string;
};

export function normalizeAccountUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(username)) {
    throw badRequest(
      "Username must be 3–48 characters and use letters, numbers, dots, underscores, or hyphens",
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw conflict("This username is reserved");
  }
  return username;
}
export function normalizeOptionalAccountEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return email || null;
}

function identifierFromRow(row: AccountLoginIdentifierRow): AccountLoginIdentifier {
  return {
    userId: row.user_id,
    username: row.username,
    email: row.email,
    usernameChangedAt: row.username_changed_at,
  };
}

export function accountUsernameChangeAvailableAt(usernameChangedAt: string | null) {
  if (!usernameChangedAt) return null;
  const changedAt = Date.parse(usernameChangedAt);
  if (Number.isNaN(changedAt)) return null;
  return new Date(
    changedAt + ACCOUNT_USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS,
  ).toISOString();
}

export async function loadAccountLoginIdentifierForUser(
  userId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("account_login_identifiers")
    .select("user_id,username,email,username_changed_at")
    .eq("user_id", userId)
    .maybeSingle<AccountLoginIdentifierRow>();

  if (error) throw error;
  return data ? identifierFromRow(data) : null;
}

export async function findAccountLoginIdentifier(
  identifier: string,
  env: ServerEnv = loadServerEnv(),
) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;

  const adminClient = createAdminSupabaseClient(env);
  const query = adminClient
    .from("account_login_identifiers")
    .select("user_id,username,email,username_changed_at");
  const { data, error } = normalized.includes("@")
    ? await query.eq("email", normalized).maybeSingle<AccountLoginIdentifierRow>()
    : await query.eq("username", normalized).maybeSingle<AccountLoginIdentifierRow>();

  if (error) throw error;
  return data ? identifierFromRow(data) : null;
}

export async function findActiveAccountUsernameReservation(
  username: string,
  env: ServerEnv = loadServerEnv(),
) {
  const normalized = normalizeAccountUsername(username);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("account_username_history")
    .select("username,user_id,reserved_until")
    .eq("username", normalized)
    .gt("reserved_until", new Date().toISOString())
    .maybeSingle<AccountUsernameReservationRow>();

  if (error) throw error;
  return data
    ? {
        username: data.username,
        userId: data.user_id,
        reservedUntil: data.reserved_until,
      }
    : null;
}

export async function resolveAccountLoginAuthEmail(
  identifier: string,
  env: ServerEnv = loadServerEnv(),
) {
  const accountIdentifier = await findAccountLoginIdentifier(identifier, env);
  if (!accountIdentifier) return null;

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.auth.admin.getUserById(
    accountIdentifier.userId,
  );
  if (error) throw error;
  return data.user?.email?.trim().toLowerCase() ?? null;
}

export async function changeCurrentUserAccountUsername(
  session: RequestSession,
  input: {
    username: string;
    currentPassword: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  if (session.account.accountType === "temporary") {
    throw forbidden("Temporary account usernames are managed by an organization administrator");
  }
  if (!input.currentPassword) {
    throw badRequest("Enter your current password to change the username");
  }

  const username = normalizeAccountUsername(input.username);
  const adminClient = createAdminSupabaseClient(env);
  const currentIdentifier = await loadAccountLoginIdentifierForUser(
    session.account.userId,
    env,
  );
  if (currentIdentifier?.username === username) {
    throw badRequest("Choose a different username");
  }

  const availableAt = accountUsernameChangeAvailableAt(
    currentIdentifier?.usernameChangedAt ?? null,
  );
  if (availableAt && Date.parse(availableAt) > Date.now()) {
    throw conflict("Username can only be changed once every 30 days", {
      availableAt,
    });
  }

  const { data: authUser, error: authUserError } =
    await adminClient.auth.admin.getUserById(session.account.userId);
  if (authUserError || !authUser.user?.email) {
    throw forbidden("Password sign-in is unavailable for this account");
  }

  const authClient = createServerAuthSupabaseClient(env);
  const { error: passwordError } = await authClient.auth.signInWithPassword({
    email: authUser.user.email,
    password: input.currentPassword,
  });
  if (passwordError) {
    throw forbidden("Current password is incorrect");
  }

  const [existingIdentifier, existingOrganizationUsername, activeReservation] =
    await Promise.all([
      findAccountLoginIdentifier(username, env),
      adminClient
        .from("organization_memberships")
        .select("id")
        .eq("login_username", username)
        .neq("status", "removed")
        .maybeSingle<{ id: string }>(),
      findActiveAccountUsernameReservation(username, env),
    ]);
  if (existingOrganizationUsername.error) {
    throw existingOrganizationUsername.error;
  }
  if (
    (existingIdentifier && existingIdentifier.userId !== session.account.userId)
    || existingOrganizationUsername.data
    || (activeReservation && activeReservation.userId !== session.account.userId)
  ) {
    throw conflict("This username is already in use");
  }

  const changedAt = new Date();
  const changedAtIso = changedAt.toISOString();
  if (currentIdentifier) {
    const { error: reservationError } = await adminClient
      .from("account_username_history")
      .upsert({
        username: currentIdentifier.username,
        user_id: session.account.userId,
        reserved_until: new Date(
          changedAt.getTime() + ACCOUNT_USERNAME_RESERVATION_DAYS * DAY_MS,
        ).toISOString(),
        created_at: changedAtIso,
      }, {
        onConflict: "username",
      });
    if (reservationError) throw reservationError;

    const identifierUpdate = adminClient
      .from("account_login_identifiers")
      .update({
        username,
        username_changed_at: changedAtIso,
      })
      .eq("user_id", session.account.userId)
      .eq("username", currentIdentifier.username);
    const guardedIdentifierUpdate = currentIdentifier.usernameChangedAt
      ? identifierUpdate.eq("username_changed_at", currentIdentifier.usernameChangedAt)
      : identifierUpdate.is("username_changed_at", null);
    const { data: updatedIdentifier, error: updateError } =
      await guardedIdentifierUpdate
        .select("user_id")
        .maybeSingle<{ user_id: string }>();
    if (updateError) {
      if (updateError.code === "23505") {
        throw conflict("This username is already in use");
      }
      throw updateError;
    }
    if (!updatedIdentifier) {
      throw conflict("The username changed in another session. Reload your account and try again");
    }
  } else {
    const { error: insertError } = await adminClient
      .from("account_login_identifiers")
      .insert({
        user_id: session.account.userId,
        username,
        email: session.account.email,
        username_changed_at: changedAtIso,
      });
    if (insertError) {
      if (insertError.code === "23505") {
        throw conflict("This username is already in use");
      }
      throw insertError;
    }
  }

  await logAuthSecurityEvent({
    userId: session.account.userId,
    email: session.account.email,
    eventType: "account_username_changed",
    eventStatus: "success",
    metadata: {
      previousUsername: currentIdentifier?.username ?? null,
      username,
    },
  }, env);

  return {
    username,
    usernameChangeAvailableAt: accountUsernameChangeAvailableAt(changedAtIso),
  };
}
