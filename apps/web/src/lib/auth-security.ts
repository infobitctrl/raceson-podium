import { publicEnv } from "@/lib/public-env";

const VALID_APP_ROLES = ["athlete", "organizer", "timer", "sponsor"] as const;

export type BrowserAppRole = (typeof VALID_APP_ROLES)[number];

const localRewardDemo = publicEnv.rewardDemo?.mode === "local"
  || publicEnv.rewardDemo?.mode === "local-testnet";
// Match the isolated local Auth configuration; ordinary portal rules are unchanged.
export const MIN_PASSWORD_LENGTH = localRewardDemo ? 12 : 8;
export const MAX_PASSWORD_LENGTH = 72;

const PASSWORD_RECOVERY_INTENT_KEY = "raceson-password-recovery-intent";
const PASSWORD_RECOVERY_INTENT_MAX_AGE_MS = 60 * 60 * 1_000;

export function parseRequestedAppRoles(input: unknown): BrowserAppRole[] {
  if (!Array.isArray(input)) {
    return ["athlete"];
  }

  const roles = input
    .map((value) =>
      typeof value === "string" && (VALID_APP_ROLES as readonly string[]).includes(value)
        ? (value as BrowserAppRole)
        : null,
    )
    .filter((value): value is BrowserAppRole => value !== null);

  return roles.length ? Array.from(new Set(roles)) : ["athlete"];
}

export function validatePasswordStrength(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  return null;
}

export function authRedirectUrl(path: string) {
  const configuredBaseUrl = publicEnv.authRedirectBaseUrl;
  const baseUrl = configuredBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");

  if (!baseUrl) return undefined;

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function localAuthInboxUrl() {
  if (typeof window === "undefined") return null;

  if (publicEnv.rewardDemo) {
    // Only the canonical disposable demo stack owns this inbox. Hosted demos
    // and arbitrary loopback databases must not link to another stack's mail.
    return localRewardDemo
      && window.location.origin === publicEnv.rewardDemo.origin
      && publicEnv.supabaseUrl === "http://127.0.0.1:55321"
      ? "http://127.0.0.1:55324" : null;
  }

  const { hostname } = window.location;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return null;
  }

  const inboxHost = hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
  return `http://${inboxHost}:54324`;
}

export function hasPasswordRecoveryParams(search: string, hash: string) {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const candidateParams = [searchParams, hashParams];

  return candidateParams.some((params) =>
    params.has("token_hash") ||
    params.has("access_token") ||
    params.has("code"),
  );
}

function isPasswordResetPath(pathname: string) {
  return pathname.replace(/\/$/, "") === "/auth/reset";
}

function passwordRecoveryStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPasswordRecoveryIntent(now = Date.now()) {
  try {
    passwordRecoveryStorage()?.setItem(PASSWORD_RECOVERY_INTENT_KEY, String(now));
  } catch {
    // A valid recovery link still works through the in-memory route state when
    // browser storage is unavailable.
  }
}

export function clearPasswordRecoveryIntent() {
  try {
    passwordRecoveryStorage()?.removeItem(PASSWORD_RECOVERY_INTENT_KEY);
  } catch {
    // Storage may be blocked by the browser; there is no persisted marker then.
  }
}

function hasStoredPasswordRecoveryIntent(now = Date.now()) {
  const storage = passwordRecoveryStorage();
  let storedAt = Number.NaN;
  try {
    storedAt = Number(storage?.getItem(PASSWORD_RECOVERY_INTENT_KEY));
  } catch {
    return false;
  }
  if (!Number.isFinite(storedAt) || storedAt <= 0) return false;

  if (now - storedAt > PASSWORD_RECOVERY_INTENT_MAX_AGE_MS) {
    storage?.removeItem(PASSWORD_RECOVERY_INTENT_KEY);
    return false;
  }

  return true;
}

export function hasPasswordRecoveryIntent(
  pathname: string,
  search: string,
  hash: string,
) {
  if (!isPasswordResetPath(pathname)) return false;

  if (hasPasswordRecoveryParams(search, hash)) {
    rememberPasswordRecoveryIntent();
    return true;
  }

  return hasStoredPasswordRecoveryIntent();
}

export function hasPasswordRecoveryCallbackError(search: string, hash: string) {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const candidateParams = [searchParams, hashParams];

  return candidateParams.some((params) =>
    params.has("error") || params.has("error_code") || params.has("error_description"),
  ) || (
    candidateParams.some((params) => params.get("type") === "recovery")
    && !hasPasswordRecoveryParams(search, hash)
  );
}
