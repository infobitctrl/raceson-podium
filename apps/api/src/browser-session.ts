import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserAuthSession } from "@raceson/db";

export const ACCESS_COOKIE_NAME = "trail_alt_access_v1";
export const REFRESH_COOKIE_NAME = "trail_alt_refresh_v1";

const REFRESH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function encodedCookieValue(value: string) {
  return encodeURIComponent(value);
}

function cookieAttributes(input: {
  path: string;
  maxAge: number;
  secure: boolean;
}) {
  return [
    `Path=${input.path}`,
    `Max-Age=${Math.max(0, Math.floor(input.maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
    input.secure ? "Secure" : null,
    "Priority=High",
  ].filter(Boolean).join("; ");
}

export function browserSessionSetCookies(
  session: BrowserAuthSession,
  secure: boolean,
) {
  return [
    `${ACCESS_COOKIE_NAME}=${encodedCookieValue(session.accessToken)}; ${cookieAttributes({
      path: "/api/v1",
      maxAge: session.expiresIn,
      secure,
    })}`,
    `${REFRESH_COOKIE_NAME}=${encodedCookieValue(session.refreshToken)}; ${cookieAttributes({
      path: "/api/v1/public/auth",
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
      secure,
    })}`,
  ];
}

export function browserSessionClearCookies(secure: boolean) {
  return [
    `${ACCESS_COOKIE_NAME}=; ${cookieAttributes({
      path: "/api/v1",
      maxAge: 0,
      secure,
    })}`,
    `${REFRESH_COOKIE_NAME}=; ${cookieAttributes({
      path: "/api/v1/public/auth",
      maxAge: 0,
      secure,
    })}`,
  ];
}

export function readRequestCookies(req: IncomingMessage) {
  const rawCookie = req.headers.cookie;
  const cookies = new Map<string, string>();
  for (const part of rawCookie?.split(";") ?? []) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!name || rawValue.length > 8_192) continue;
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

export function readBrowserSessionCookies(req: IncomingMessage) {
  const cookies = readRequestCookies(req);
  return {
    accessToken: cookies.get(ACCESS_COOKIE_NAME) ?? null,
    refreshToken: cookies.get(REFRESH_COOKIE_NAME) ?? null,
  };
}

export function writeBrowserSessionCookies(
  res: ServerResponse,
  session: BrowserAuthSession,
  secure: boolean,
) {
  res.setHeader("Set-Cookie", browserSessionSetCookies(session, secure));
  applyPrivateSessionHeaders(res);
}

export function clearBrowserSessionCookies(
  res: ServerResponse,
  secure: boolean,
) {
  res.setHeader("Set-Cookie", browserSessionClearCookies(secure));
  applyPrivateSessionHeaders(res);
}

export function applyPrivateSessionHeaders(res: ServerResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function requestUsesSecureCookies(
  req: IncomingMessage,
  configuredAppBaseUrl: string | null,
) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (protocol?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.startsWith("https://")) return true;
  return configuredAppBaseUrl?.startsWith("https://") ?? false;
}
