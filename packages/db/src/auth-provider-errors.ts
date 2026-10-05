import {
  accountAlreadyExists,
  ApiHttpError,
  badRequest,
  unauthorized,
} from "./errors.js";

export type PublicAuthOperation = "sign_in" | "sign_up" | "send_email";

function authErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function authErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function authWeakPasswordReasons(error: unknown) {
  if (!error || typeof error !== "object" || !("reasons" in error)) return [];
  const reasons = (error as { reasons?: unknown }).reasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
}

function publicWeakPasswordError(error: unknown) {
  const reasons = authWeakPasswordReasons(error);

  if (reasons.includes("pwned")) {
    return new ApiHttpError(
      400,
      "weak_password_pwned",
      "Password is known to be weak or compromised",
    );
  }
  if (reasons.includes("length")) {
    return new ApiHttpError(
      400,
      "weak_password_length",
      "Password does not meet the minimum length requirement",
    );
  }
  if (reasons.includes("characters")) {
    return new ApiHttpError(
      400,
      "weak_password_characters",
      "Password does not meet the required character rules",
    );
  }

  return new ApiHttpError(
    400,
    "weak_password",
    "Password does not meet the authentication service security requirements",
  );
}

export function publicAuthProviderError(
  error: unknown,
  operation: PublicAuthOperation,
): ApiHttpError {
  const code = authErrorCode(error);
  const status = authErrorStatus(error);

  if (code === "weak_password") {
    return publicWeakPasswordError(error);
  }

  if (
    code === "email_address_not_authorized"
    || code === "email_provider_disabled"
    || code === "provider_disabled"
  ) {
    return new ApiHttpError(
      503,
      "email_delivery_unavailable",
      "Email confirmation delivery is not available",
      { authProviderCode: code },
    );
  }

  if (operation === "sign_in") {
    if (code === "email_not_confirmed") {
      return new ApiHttpError(
        403,
        "email_not_confirmed",
        "Confirm your email address before signing in",
      );
    }
    if (code === "over_request_rate_limit" || status === 429) {
      return new ApiHttpError(
        429,
        "rate_limited",
        "Too many sign-in attempts. Wait a few minutes and try again",
      );
    }
    if (status !== null && status >= 400 && status < 500) {
      return unauthorized("Invalid username or password");
    }
  }

  if (operation === "sign_up") {
    if (code === "email_exists" || code === "user_already_exists") {
      return accountAlreadyExists();
    }
    if (code === "email_address_invalid") {
      return new ApiHttpError(
        400,
        "invalid_email",
        "Use a valid email address",
      );
    }
  }

  if (
    code === "over_email_send_rate_limit"
    || code === "over_request_rate_limit"
    || status === 429
  ) {
    return new ApiHttpError(
      429,
      "rate_limited",
      "Too many authentication requests. Wait a few minutes and try again",
    );
  }

  if (status !== null && status >= 400 && status < 500) {
    return badRequest("Authentication request was rejected", {
      authProviderCode: code,
    });
  }

  return new ApiHttpError(
    503,
    "auth_service_unavailable",
    "Authentication service is temporarily unavailable",
    { authProviderCode: code },
  );
}
