import { ApiError } from "@/lib/api";

export const EXISTING_ACCOUNT_SIGN_UP_WARNING =
  "An account with these credentials already exists. Sign in or reset your password.";

export function isExistingAccountSignUpError(error: unknown) {
  return error instanceof ApiError
    && error.status === 409
    && error.code === "account_exists";
}
