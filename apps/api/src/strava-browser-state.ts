import type { IncomingMessage, ServerResponse } from "node:http";
import { applyPrivateSessionHeaders, readRequestCookies } from "./browser-session.js";
import { ApiHttpError, type ServerEnv } from "@raceson/db";

export const STRAVA_STATE_COOKIE = "raceson_strava_state_v1";
const CALLBACK_PATH = "/api/v1/integrations/strava/callback";

const PUBLIC_APP_ORIGINS = [
  "https://raceson.com", "https://www.raceson.com",
  "https://staging.raceson.com", "https://raceson-staging.vercel.app",
];

export function resolveStravaCallbackOrigin(
  req: Pick<IncomingMessage, "headers">,
  env: Pick<ServerEnv, "appBaseUrl" | "apiCorsOrigin" | "stravaCallbackBaseUrl">,
) {
  const configured = [env.appBaseUrl, env.apiCorsOrigin, env.stravaCallbackBaseUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value));
  const allowed = new Set(configured.map((url) => url.origin));
  if (PUBLIC_APP_ORIGINS.some((origin) => allowed.has(origin))) {
    PUBLIC_APP_ORIGINS.forEach((origin) => allowed.add(origin));
  }
  const host = req.headers.host?.toLowerCase();
  if (host) {
    // Trust only configured/project-owned origins, not forwarded host/proto or
    // a caller-supplied return URL. The callback must receive this host's cookie.
    for (const origin of allowed) {
      if (new URL(origin).host === host) return origin;
    }
    const local = /^((?:localhost|127\.0\.0\.1))(?::\d{1,5})?$/.exec(host);
    if (local && configured.some((url) => ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return new URL(`http://${host}`).origin;
    }
  }
  throw new ApiHttpError(400, "strava_callback_host", "Start Strava authorization on the configured application or API host.");
}

export function readStravaBrowserState(req: IncomingMessage) {
  return readRequestCookies(req).get(STRAVA_STATE_COOKIE) ?? null;
}

export function writeStravaBrowserState(res: ServerResponse, value: string | null, secure: boolean) {
  res.setHeader("Set-Cookie", [
    `${STRAVA_STATE_COOKIE}=${encodeURIComponent(value ?? "")}; Path=${CALLBACK_PATH}; Max-Age=${value ? 600 : 0}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  ]);
  applyPrivateSessionHeaders(res);
}
