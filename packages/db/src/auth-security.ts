import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "./supabase.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { publicAuthProviderError } from "./auth-provider-errors.js";

type AuthSecurityEventInput = {
  userId?: string | null;
  email?: string | null;
  eventType: string;
  eventStatus: string;
  metadata?: Record<string, unknown> | null;
};

const PUBLIC_AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;
const publicAuthRateLimits = new Map<string, { count: number; resetAt: number }>();

function compactMetadata(metadata: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([, value]) => value !== undefined),
  );
}

function pruneExpiredPublicAuthRateLimits(now: number) {
  for (const [key, value] of publicAuthRateLimits.entries()) {
    if (value.resetAt <= now) {
      publicAuthRateLimits.delete(key);
    }
  }
}

function publicAuthRateLimitKey(action: string, email: string, ipAddress: string | null) {
  return createHash("sha256")
    .update([action, ipAddress?.trim() || "unknown", email].join(":"))
    .digest("hex");
}

function authErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function authErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown auth error";
}

function isSafePublicAuthError(error: unknown) {
  const status = authErrorStatus(error);
  return status !== null && status >= 400 && status < 500;
}

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

export function resolveAuthRedirectUrl(path: string, env: ServerEnv = loadServerEnv()) {
  const baseUrl = String(env.appBaseUrl ?? env.apiCorsOrigin ?? "").trim();
  if (!baseUrl) {
    return undefined;
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function consumeInMemoryPublicAuthRateLimit(input: {
  action: string;
  email: string;
  ipAddress?: string | null;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  if (publicAuthRateLimits.size > 2000) {
    pruneExpiredPublicAuthRateLimits(now);
  }

  const key = publicAuthRateLimitKey(input.action, input.email, input.ipAddress ?? null);
  const current = publicAuthRateLimits.get(key);

  if (!current || current.resetAt <= now) {
    publicAuthRateLimits.set(key, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return {
      allowed: true,
      retryAfterSeconds: null,
    };
  }

  if (current.count >= input.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  publicAuthRateLimits.set(key, {
    count: current.count + 1,
    resetAt: current.resetAt,
  });

  return {
    allowed: true,
    retryAfterSeconds: null,
  };
}

function isMissingDurableRateLimitRpc(error: { code?: string; message?: string }) {
  return error.code === "PGRST202"
    || error.code === "42883"
    || Boolean(error.message?.includes("service_consume_public_auth_rate_limit"));
}

export async function consumePublicAuthRateLimit(
  input: {
    action: string;
    email: string;
    ipAddress?: string | null;
    limit?: number;
    windowMs?: number;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const limit = input.limit ?? PUBLIC_AUTH_RATE_LIMIT_MAX_ATTEMPTS;
  const windowMs = input.windowMs ?? PUBLIC_AUTH_RATE_LIMIT_WINDOW_MS;
  const bucketKey = publicAuthRateLimitKey(
    input.action,
    input.email,
    input.ipAddress ?? null,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_consume_public_auth_rate_limit",
    {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    },
  );

  if (!error) {
    const result = data as { allowed?: unknown; retryAfterSeconds?: unknown } | null;
    return {
      allowed: result?.allowed === true,
      retryAfterSeconds:
        typeof result?.retryAfterSeconds === "number"
          ? result.retryAfterSeconds
          : null,
    };
  }
  if (!isMissingDurableRateLimitRpc(error)) throw error;

  return consumeInMemoryPublicAuthRateLimit({
    ...input,
    limit,
    windowMs,
  });
}

export async function logAuthSecurityEvent(
  input: AuthSecurityEventInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.from("auth_security_events").insert({
    user_id: input.userId ?? null,
    email: input.email ?? null,
    event_type: input.eventType,
    event_status: input.eventStatus,
    metadata_json: compactMetadata(input.metadata),
  });

  if (error) {
    console.warn("Unable to write auth security race", error);
  }
}

export async function requestPasswordResetEmail(
  input: {
    email: string | null;
    rateLimitIdentifier?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const email = input.email ? normalizeEmailAddress(input.email) : null;
  const rateLimitIdentifier = normalizeEmailAddress(
    input.rateLimitIdentifier ?? email ?? "unknown",
  );
  const metadata = compactMetadata({
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  const rateLimit = await consumePublicAuthRateLimit({
    action: "password_reset_requested",
    email: rateLimitIdentifier,
    ipAddress: input.ipAddress ?? null,
  }, env);

  if (!rateLimit.allowed) {
    await logAuthSecurityEvent({
      email,
      eventType: "password_reset_requested",
      eventStatus: "info",
      metadata: {
        ...metadata,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    }, env);
    return {
      accepted: true,
      rateLimited: true,
    };
  }

  if (!email) {
    await logAuthSecurityEvent({
      eventType: "password_reset_requested",
      eventStatus: "info",
      metadata: {
        ...metadata,
        recoveryAvailable: false,
      },
    }, env);
    return {
      accepted: true,
      rateLimited: false,
    };
  }

  const redirectTo = resolveAuthRedirectUrl("/auth/reset", env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : {},
  );

  if (error) {
    await logAuthSecurityEvent({
      email,
      eventType: "password_reset_requested",
      eventStatus: authErrorStatus(error) === 429 ? "info" : "failure",
      metadata: {
        ...metadata,
        reason: authErrorMessage(error),
        statusCode: authErrorStatus(error),
      },
    }, env);

    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && ["email_address_not_authorized", "email_provider_disabled", "provider_disabled"]
        .includes(String(error.code))
    ) {
      throw publicAuthProviderError(error, "send_email");
    }

    if (isSafePublicAuthError(error)) {
      return {
        accepted: true,
        rateLimited: authErrorStatus(error) === 429,
      };
    }

    throw error;
  }

  await logAuthSecurityEvent({
    email,
    eventType: "password_reset_requested",
    eventStatus: "success",
    metadata: {
      ...metadata,
      redirectTo,
    },
  }, env);

  return {
    accepted: true,
    rateLimited: false,
  };
}

export async function resendSignupVerificationEmail(
  input: {
    email: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const email = normalizeEmailAddress(input.email);
  const metadata = compactMetadata({
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  const rateLimit = await consumePublicAuthRateLimit({
    action: "verification_resend_requested",
    email,
    ipAddress: input.ipAddress ?? null,
  }, env);

  if (!rateLimit.allowed) {
    await logAuthSecurityEvent({
      email,
      eventType: "verification_resend_requested",
      eventStatus: "info",
      metadata: {
        ...metadata,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    }, env);
    return {
      accepted: true,
      rateLimited: true,
    };
  }

  const emailRedirectTo = resolveAuthRedirectUrl("/auth", env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.auth.resend({
    type: "signup",
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  if (error) {
    await logAuthSecurityEvent({
      email,
      eventType: "verification_resend_requested",
      eventStatus: authErrorStatus(error) === 429 ? "info" : "failure",
      metadata: {
        ...metadata,
        reason: authErrorMessage(error),
        statusCode: authErrorStatus(error),
      },
    }, env);

    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && ["email_address_not_authorized", "email_provider_disabled", "provider_disabled"]
        .includes(String(error.code))
    ) {
      throw publicAuthProviderError(error, "send_email");
    }

    if (isSafePublicAuthError(error)) {
      return {
        accepted: true,
        rateLimited: authErrorStatus(error) === 429,
      };
    }

    throw error;
  }

  await logAuthSecurityEvent({
    email,
    eventType: "verification_resend_requested",
    eventStatus: "success",
    metadata: {
      ...metadata,
      emailRedirectTo,
    },
  }, env);

  return {
    accepted: true,
    rateLimited: false,
  };
}
