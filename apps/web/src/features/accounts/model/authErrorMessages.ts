import { ApiError } from "@/lib/api";
import type { TranslationKey, TranslationValues } from "@/shared/i18n/messages";

export type AuthErrorAction = "sign_in" | "sign_up" | "send_email" | "update_password";

export type AuthErrorCopy = {
  key: TranslationKey;
  values?: TranslationValues;
};

function publicReference(error: ApiError) {
  if (error.code) return error.code;
  return `HTTP ${error.status}`;
}

export function resolveAuthErrorCopy(
  error: unknown,
  action: AuthErrorAction,
): AuthErrorCopy {
  if (
    !(error instanceof ApiError)
    && typeof error === "object"
    && error !== null
    && "code" in error
  ) {
    const code = typeof error.code === "string" ? error.code : null;
    const status = "status" in error && typeof error.status === "number"
      ? error.status
      : 500;
    return resolveAuthErrorCopy(
      new ApiError("Authentication request failed", { status, code }),
      action,
    );
  }

  if (error instanceof ApiError) {
    if (error.code === "account_exists") {
      return { key: "auth.existing.description" };
    }
    if (
      error.code === "invalid_credentials"
      || (
        action === "sign_in"
        && error.code === "forbidden"
        && error.message.toLowerCase().includes("invalid username or password")
      )
      || (action === "sign_in" && error.status === 401)
    ) {
      return { key: "auth.error.invalidCredentials" };
    }
    if (error.code === "email_not_confirmed") {
      return { key: "auth.error.emailNotConfirmed" };
    }
    if (error.code === "email_delivery_unavailable") {
      return { key: "auth.error.emailDeliveryUnavailable" };
    }
    if (error.code === "recovery_email_unavailable") {
      return { key: "auth.error.recoveryEmailUnavailable" };
    }
    if (
      action === "update_password"
      && [
        "session_not_found",
        "refresh_token_not_found",
        "refresh_token_already_used",
        "otp_expired",
        "bad_jwt",
      ].includes(error.code ?? "")
    ) {
      return { key: "auth.error.recoverySessionExpired" };
    }
    if (error.code === "weak_password_pwned") {
      return { key: "auth.error.weakPasswordPwned" };
    }
    if (error.code === "weak_password_length") {
      return { key: "auth.error.weakPasswordLength" };
    }
    if (error.code === "weak_password_characters") {
      return { key: "auth.error.weakPasswordCharacters" };
    }
    if (error.code === "weak_password") {
      return { key: "auth.error.weakPassword" };
    }
    if (error.code === "invalid_email") {
      return { key: "auth.error.invalidEmail" };
    }
    if (
      error.code === "rate_limited"
      || error.code === "over_request_rate_limit"
      || error.code === "over_email_send_rate_limit"
      || error.status === 429
    ) {
      return { key: "auth.error.rateLimited" };
    }
    if (error.code === "forbidden" && error.status === 403) {
      return { key: "auth.error.originBlocked" };
    }
    if (
      error.code === "validation_error"
      || error.code === "bad_request"
      || error.status === 400
    ) {
      return { key: "auth.error.validation" };
    }
    if (
      error.code === "service_unavailable"
      || error.code === "auth_service_unavailable"
      || error.code === "auth_provider_error"
      || error.code === "internal_error"
      || error.status >= 500
    ) {
      return {
        key: "auth.error.serviceUnavailable",
        values: { reference: publicReference(error) },
      };
    }
    return {
      key: "auth.error.unexpected",
      values: { reference: publicReference(error) },
    };
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    error instanceof TypeError
    || message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("unreachable")
  ) {
    return { key: "auth.error.network" };
  }
  if (message.includes("supabase is not configured")) {
    return { key: "auth.error.configuration" };
  }
  if (
    action === "update_password"
    && (
      message.includes("auth session missing")
      || message.includes("invalid refresh token")
      || message.includes("refresh token not found")
    )
  ) {
    return { key: "auth.error.recoverySessionExpired" };
  }
  if (action === "sign_in" && message.includes("invalid username or password")) {
    return { key: "auth.error.invalidCredentials" };
  }

  return {
    key: "auth.error.unexpected",
    values: { reference: "unknown" },
  };
}

export function formatAuthError(
  error: unknown,
  action: AuthErrorAction,
  translate: (key: TranslationKey, values?: TranslationValues) => string,
) {
  const copy = resolveAuthErrorCopy(error, action);
  return translate(copy.key, copy.values);
}
