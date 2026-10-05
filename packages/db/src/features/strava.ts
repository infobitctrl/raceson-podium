import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { ApiHttpError, badRequest, forbidden, notFound } from "../errors.js";
import { loadServerEnv, type ServerEnv } from "../env.js";
import { requireAthleteProfileId, requireVerifiedEmail } from "../permissions.js";
import { createAdminSupabaseClient } from "../supabase.js";
import { resampleRoute, type RoutePoint } from "./track-attempt-analysis.js";

type StravaConnectionRow = {
  user_id: string;
  athlete_profile_id: string;
  strava_athlete_id: number;
  strava_athlete_name: string | null;
  granted_scopes: string[];
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  access_token_expires_at: string;
};

type StravaTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  scope?: unknown;
  athlete?: {
    id?: unknown;
    firstname?: unknown;
    lastname?: unknown;
    username?: unknown;
  };
};

type StravaDetailedActivity = {
  id?: unknown;
  name?: unknown;
  athlete?: { id?: unknown };
  distance?: unknown;
  moving_time?: unknown;
  elapsed_time?: unknown;
  total_elevation_gain?: unknown;
  type?: unknown;
  sport_type?: unknown;
  start_date?: unknown;
  start_date_local?: unknown;
  timezone?: unknown;
  average_speed?: unknown;
  max_speed?: unknown;
  average_heartrate?: unknown;
  max_heartrate?: unknown;
  calories?: unknown;
  device_name?: unknown;
  description?: unknown;
  splits_metric?: unknown;
};

type StravaStream = { data?: unknown };
type StravaStreams = Record<string, StravaStream | undefined>;

export type StravaSplitEvidence = {
  kilometer: number;
  distanceMeters: number;
  elapsedTimeSeconds: number;
  movingTimeSeconds: number;
  paceSecondsPerKm: number | null;
  elevationDifferenceMeters: number | null;
};

export type StravaActivityEvidence = {
  activityId: string;
  activityName: string;
  athleteName: string | null;
  sportType: string | null;
  startedAt: string;
  localStartedAt: string | null;
  timezone: string | null;
  elapsedTimeSeconds: number;
  movingTimeSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  calories: number | null;
  deviceName: string | null;
  description: string | null;
  route: RoutePoint[];
  splits: StravaSplitEvidence[];
  fetchedAt: string;
};

type StravaState = {
  userId: string;
  athleteProfileId: string;
  returnPath: string;
  expiresAt: number;
  nonce: string;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredPositiveNumber(value: unknown, field: string) {
  const parsed = optionalNumber(value);
  if (parsed == null || parsed <= 0) throw badRequest(`Strava did not return a valid ${field}.`);
  return parsed;
}

function safeReturnPath(value: string | null | undefined) {
  const path = value?.trim() || "/athlete";
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) {
    return "/athlete";
  }
  return path;
}

function encryptionKey(env: ServerEnv) {
  const source = env.stravaTokenEncryptionKey;
  if (!source || source.length < 32) {
    throw new ApiHttpError(503, "strava_not_configured", "Strava integration is not configured yet.");
  }
  return createHash("sha256").update(`sitrail-strava-token:${source}`).digest();
}

function stateSigningKey(env: ServerEnv) {
  const source = env.stravaTokenEncryptionKey;
  if (!source || source.length < 32) {
    throw new ApiHttpError(503, "strava_not_configured", "Strava integration is not configured yet.");
  }
  return createHash("sha256").update(`sitrail-strava-state:${source}`).digest();
}

function stravaConfiguration(env: ServerEnv) {
  if (
    !env.stravaClientId
    || !/^\d+$/.test(env.stravaClientId)
    || !env.stravaClientSecret
    || !env.stravaTokenEncryptionKey
    || !env.appBaseUrl
  ) {
    throw new ApiHttpError(503, "strava_not_configured", "Strava integration is not configured yet.");
  }
  return {
    clientId: env.stravaClientId,
    clientSecret: env.stravaClientSecret,
    callbackUrl: `${env.appBaseUrl.replace(/\/$/, "")}/api/v1/integrations/strava/callback`,
  };
}

export function isStravaConfigured(env: ServerEnv = loadServerEnv()) {
  try {
    stravaConfiguration(env);
    encryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

function encryptToken(value: string, userId: string, kind: "access" | "refresh", env: ServerEnv) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(`strava:${userId}:${kind}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

function decryptToken(value: string, userId: string, kind: "access" | "refresh", env: ServerEnv) {
  const [version, ivValue, encryptedValue, tagValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue || !tagValue) {
    throw new Error("Invalid encrypted Strava token envelope.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(Buffer.from(`strava:${userId}:${kind}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function signState(payload: StravaState, env: ServerEnv) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", stateSigningKey(env)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(value: string, env: ServerEnv): StravaState {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra !== undefined || value.length > 4096) throw badRequest("Invalid Strava authorization state.");
  const expected = createHmac("sha256", stateSigningKey(env)).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw badRequest("Invalid Strava authorization state.");
  }
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<StravaState>;
  if (
    typeof parsed.userId !== "string"
    || typeof parsed.athleteProfileId !== "string"
    || typeof parsed.returnPath !== "string"
    || typeof parsed.expiresAt !== "number"
    || !Number.isFinite(parsed.expiresAt)
    || parsed.expiresAt <= Date.now()
    || typeof parsed.nonce !== "string"
    || !/^[a-f0-9]{64}$/.test(parsed.nonce)
  ) {
    throw badRequest("Strava authorization state has expired.");
  }
  return parsed as StravaState;
}

async function stravaJson<T>(url: string, init: RequestInit, message: string): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiHttpError(
      response.status === 401 ? 401 : 502,
      "strava_api_error",
      message,
      { providerStatus: response.status },
    );
  }
  return payload as T;
}

function tokenFields(payload: StravaTokenResponse, acceptedScope?: string | null) {
  const accessToken = optionalString(payload.access_token);
  const refreshToken = optionalString(payload.refresh_token);
  const expiresAt = optionalNumber(payload.expires_at);
  const scope = optionalString(payload.scope) ?? acceptedScope ?? "";
  const grantedScopes = scope.split(/[\s,]+/).filter(Boolean);
  if (!accessToken || !refreshToken || !expiresAt) {
    throw new ApiHttpError(502, "strava_api_error", "Strava did not return usable authorization tokens.");
  }
  if (!grantedScopes.includes("activity:read") && !grantedScopes.includes("activity:read_all")) {
    throw forbidden("Strava activity read access is required to verify attempts.");
  }
  return { accessToken, refreshToken, expiresAt, grantedScopes };
}

export async function getStravaConnectionStatus(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = session.account.primaryAthleteProfileId;
  if (!athleteProfileId) {
    return { configured: isStravaConfigured(env), connected: false, athleteName: null, grantedScopes: [] };
  }
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("athlete_strava_connections")
    .select("strava_athlete_name,granted_scopes")
    .eq("user_id", session.account.userId)
    .eq("athlete_profile_id", athleteProfileId)
    .maybeSingle<{ strava_athlete_name: string | null; granted_scopes: string[] }>();
  if (error?.code !== "42P01" && error) throw error;
  return {
    configured: isStravaConfigured(env),
    connected: Boolean(data),
    athleteName: data?.strava_athlete_name ?? null,
    grantedScopes: data?.granted_scopes ?? [],
  };
}

export async function createStravaAuthorizationUrl(
  session: RequestSession,
  returnPath: string | null,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const configuration = stravaConfiguration(env);
  const browserState = randomBytes(32).toString("base64url");
  const nonce = createHash("sha256").update(browserState).digest("hex");
  const expiresAt = Date.now() + 10 * 60_000;
  const { error } = await createAdminSupabaseClient(env).from("athlete_strava_oauth_intents").insert({
    nonce_hash: nonce,
    user_id: session.account.userId,
    athlete_profile_id: athleteProfileId,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (error) throw error;
  const state = signState({
    userId: session.account.userId,
    athleteProfileId,
    returnPath: safeReturnPath(returnPath),
    expiresAt,
    nonce,
  }, env);
  const url = new URL(`${env.stravaOAuthBaseUrl.replace(/\/$/, "")}/authorize`);
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,activity:read_all");
  url.searchParams.set("state", state);
  // browserState is sent only as an HttpOnly cookie, never in the JSON response.
  return { authorizationUrl: url.toString(), browserState };
}

export async function completeStravaAuthorization(
  input: { code: string; state: string; browserState: string | null; acceptedScope?: string | null },
  env: ServerEnv = loadServerEnv(),
) {
  const configuration = stravaConfiguration(env);
  const state = verifyState(input.state, env);
  if (!input.browserState || !/^[A-Za-z0-9_-]{43}$/.test(input.browserState)) {
    throw badRequest("Strava authorization must finish in the initiating browser.");
  }
  const browserHash = createHash("sha256").update(input.browserState).digest();
  if (!timingSafeEqual(browserHash, Buffer.from(state.nonce, "hex"))) {
    throw badRequest("Strava authorization must finish in the initiating browser.");
  }
  const adminClient = createAdminSupabaseClient(env);
  const { data: consumed, error: consumeError } = await adminClient.rpc("consume_strava_oauth_intent", {
    target_nonce_hash: state.nonce,
    target_user_id: state.userId,
    target_athlete_profile_id: state.athleteProfileId,
  });
  if (consumeError) throw consumeError;
  if (consumed !== true) throw badRequest("Strava authorization has expired or was already used.");
  const form = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
  });
  const payload = await stravaJson<StravaTokenResponse>(
    `${env.stravaOAuthBaseUrl.replace(/\/$/, "")}/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form },
    "Unable to complete Strava authorization.",
  );
  const token = tokenFields(payload, input.acceptedScope);
  const stravaAthleteId = requiredPositiveNumber(payload.athlete?.id, "athlete identifier");
  const athleteName = [optionalString(payload.athlete?.firstname), optionalString(payload.athlete?.lastname)]
    .filter(Boolean)
    .join(" ") || optionalString(payload.athlete?.username);
  const { error } = await adminClient.from("athlete_strava_connections").upsert({
    user_id: state.userId,
    athlete_profile_id: state.athleteProfileId,
    strava_athlete_id: stravaAthleteId,
    strava_athlete_name: athleteName,
    granted_scopes: token.grantedScopes,
    encrypted_access_token: encryptToken(token.accessToken, state.userId, "access", env),
    encrypted_refresh_token: encryptToken(token.refreshToken, state.userId, "refresh", env),
    access_token_expires_at: new Date(token.expiresAt * 1_000).toISOString(),
    connected_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return {
    redirectUrl: `${env.appBaseUrl!.replace(/\/$/, "")}${safeReturnPath(state.returnPath)}${state.returnPath.includes("?") ? "&" : "?"}strava=connected`,
  };
}

async function connectionFor(input: { userId?: string; athleteProfileId?: string }, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("athlete_strava_connections")
    .select("user_id,athlete_profile_id,strava_athlete_id,strava_athlete_name,granted_scopes,encrypted_access_token,encrypted_refresh_token,access_token_expires_at");
  if (input.userId) query = query.eq("user_id", input.userId);
  if (input.athleteProfileId) query = query.eq("athlete_profile_id", input.athleteProfileId);
  const { data, error } = await query.maybeSingle<StravaConnectionRow>();
  if (error) throw error;
  if (!data) throw notFound("Connect Strava before submitting or refreshing this activity.");
  return data;
}

async function accessTokenFor(connection: StravaConnectionRow, env: ServerEnv) {
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (expiresAt > Date.now() + 60 * 60_000) {
    return decryptToken(connection.encrypted_access_token, connection.user_id, "access", env);
  }
  const configuration = stravaConfiguration(env);
  const refreshToken = decryptToken(connection.encrypted_refresh_token, connection.user_id, "refresh", env);
  const form = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const payload = await stravaJson<StravaTokenResponse>(
    `${env.stravaOAuthBaseUrl.replace(/\/$/, "")}/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form },
    "Unable to refresh Strava access.",
  );
  const token = tokenFields(payload, connection.granted_scopes.join(","));
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.from("athlete_strava_connections").update({
    encrypted_access_token: encryptToken(token.accessToken, connection.user_id, "access", env),
    encrypted_refresh_token: encryptToken(token.refreshToken, connection.user_id, "refresh", env),
    access_token_expires_at: new Date(token.expiresAt * 1_000).toISOString(),
    granted_scopes: token.grantedScopes,
  }).eq("user_id", connection.user_id);
  if (error) throw error;
  return token.accessToken;
}

function normalizedSplits(value: unknown): StravaSplitEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const split = item as Record<string, unknown>;
    const distanceMeters = optionalNumber(split.distance);
    const elapsedTimeSeconds = optionalNumber(split.elapsed_time);
    const movingTimeSeconds = optionalNumber(split.moving_time);
    if (!distanceMeters || !elapsedTimeSeconds || movingTimeSeconds == null) return [];
    return [{
      kilometer: index + 1,
      distanceMeters: Math.round(distanceMeters),
      elapsedTimeSeconds: Math.round(elapsedTimeSeconds),
      movingTimeSeconds: Math.round(movingTimeSeconds),
      paceSecondsPerKm: distanceMeters > 0
        ? Math.round(movingTimeSeconds / (distanceMeters / 1_000))
        : null,
      elevationDifferenceMeters: optionalNumber(split.elevation_difference),
    }];
  });
}

export function normalizeStravaActivityEvidence(
  activity: StravaDetailedActivity,
  streams: StravaStreams,
  athleteName: string | null,
): StravaActivityEvidence {
  const latlng = streams.latlng?.data;
  const route = Array.isArray(latlng)
    ? latlng.flatMap((point) =>
        Array.isArray(point)
        && typeof point[0] === "number"
        && typeof point[1] === "number"
          ? [{ lat: point[0], lng: point[1] }]
          : [],
      )
    : [];
  if (route.length < 2) {
    throw badRequest("This Strava activity does not expose enough GPS data for route verification.");
  }
  const activityId = String(requiredPositiveNumber(activity.id, "activity identifier"));
  const activityName = optionalString(activity.name) ?? `Strava activity ${activityId}`;
  const startedAt = optionalString(activity.start_date);
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) {
    throw badRequest("Strava did not return a valid activity start time.");
  }
  return {
    activityId,
    activityName,
    athleteName,
    sportType: optionalString(activity.sport_type) ?? optionalString(activity.type),
    startedAt,
    localStartedAt: optionalString(activity.start_date_local),
    timezone: optionalString(activity.timezone),
    elapsedTimeSeconds: Math.round(requiredPositiveNumber(activity.elapsed_time, "elapsed time")),
    movingTimeSeconds: Math.round(requiredPositiveNumber(activity.moving_time, "moving time")),
    distanceMeters: requiredPositiveNumber(activity.distance, "distance"),
    elevationGainMeters: optionalNumber(activity.total_elevation_gain),
    averageSpeedMetersPerSecond: optionalNumber(activity.average_speed),
    maxSpeedMetersPerSecond: optionalNumber(activity.max_speed),
    averageHeartRate: optionalNumber(activity.average_heartrate),
    maxHeartRate: optionalNumber(activity.max_heartrate),
    calories: optionalNumber(activity.calories),
    deviceName: optionalString(activity.device_name),
    description: optionalString(activity.description),
    route: resampleRoute(route, 10, 1_000),
    splits: normalizedSplits(activity.splits_metric),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchStravaActivityEvidence(
  input: { activityId: string; userId?: string; athleteProfileId?: string },
  env: ServerEnv = loadServerEnv(),
) {
  const connection = await connectionFor(input, env);
  const accessToken = await accessTokenFor(connection, env);
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const encodedActivityId = encodeURIComponent(input.activityId);
  const [activity, streams] = await Promise.all([
    stravaJson<StravaDetailedActivity>(
      `${env.stravaApiBaseUrl.replace(/\/$/, "")}/activities/${encodedActivityId}`,
      { headers },
      "Unable to read this Strava activity. Confirm it belongs to the connected athlete.",
    ),
    stravaJson<StravaStreams>(
      `${env.stravaApiBaseUrl.replace(/\/$/, "")}/activities/${encodedActivityId}/streams?keys=latlng,time,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth&key_by_type=true`,
      { headers },
      "Unable to read the GPS stream for this Strava activity.",
    ),
  ]);
  if (optionalNumber(activity.athlete?.id) !== connection.strava_athlete_id) {
    throw forbidden("The submitted activity does not belong to the connected Strava athlete.");
  }
  const evidence = normalizeStravaActivityEvidence(activity, streams, connection.strava_athlete_name);
  const adminClient = createAdminSupabaseClient(env);
  await adminClient.from("athlete_strava_connections").update({
    last_synced_at: new Date().toISOString(),
  }).eq("user_id", connection.user_id);
  return evidence;
}
