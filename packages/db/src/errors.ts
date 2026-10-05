export class ApiHttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ACCOUNT_EXISTS_ERROR_MESSAGE =
  "An account with these credentials already exists. Sign in or reset your password.";

export function badRequest(message: string, details?: unknown) {
  return new ApiHttpError(400, "bad_request", message, details);
}

export function unauthorized(message = "Authentication required") {
  return new ApiHttpError(401, "unauthorized", message);
}

export function forbidden(message = "Forbidden") {
  return new ApiHttpError(403, "forbidden", message);
}

export function notFound(message = "Not found") {
  return new ApiHttpError(404, "not_found", message);
}

export function conflict(message: string, details?: unknown) {
  return new ApiHttpError(409, "conflict", message, details);
}

export function serviceUnavailable(message: string, details?: unknown) {
  return new ApiHttpError(503, "service_unavailable", message, details);
}

export function accountAlreadyExists(details?: unknown) {
  return new ApiHttpError(
    409,
    "account_exists",
    ACCOUNT_EXISTS_ERROR_MESSAGE,
    details,
  );
}

export function isApiHttpError(error: unknown): error is ApiHttpError {
  return error instanceof ApiHttpError;
}
