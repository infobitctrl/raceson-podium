import { createHash, randomUUID } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { loadServerEnv, type ServerEnv } from "../env.js";
import { requireAthleteProfileId, requireVerifiedEmail } from "../permissions.js";
import { createAdminSupabaseClient } from "../supabase.js";
import {
  buildTrackAttemptAnalysisReport,
  compareTrackAttemptRoutes,
  resampleRoute,
  type TrackAttemptAnalysisReport,
  type RoutePoint,
  type TrackAttemptComparison,
} from "./track-attempt-analysis.js";
import {
  parseTrackAttemptGpx,
  sanitizeTrackAttemptGpxFileName,
  type ParsedTrackAttemptGpx,
  type ParsedTrackAttemptSplit,
} from "./track-attempt-gpx.js";
import {
  fetchStravaActivityEvidence,
  type StravaActivityEvidence,
} from "./strava.js";

export type TrackAttemptVerificationStatus = "draft" | "submitted" | "verified" | "rejected";
export type TrackAttemptSource = "manual" | "gpx_upload" | "strava" | "imported";

export type TrackAttemptActivityEvidence = {
  source: "gpx_upload" | "strava";
  activityId: string | null;
  activityName: string;
  athleteName: string | null;
  sportType: string | null;
  startedAt: string | null;
  localStartedAt: string | null;
  timezone: string | null;
  elapsedTimeSeconds: number | null;
  movingTimeSeconds: number | null;
  distanceMeters: number;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  calories: number | null;
  deviceName: string | null;
  description: string | null;
  originalFileName: string | null;
  timestampCoveragePercent: number;
  timingAnomalyCount: number;
  route: RoutePoint[];
  splits: ParsedTrackAttemptSplit[];
  importedAt: string;
};

export type TrackAttemptReviewItem = {
  id: string;
  trackTemplateId: string;
  trackVersionId: string | null;
  trackSlug: string;
  trackName: string;
  athleteProfileId: string;
  athleteName: string;
  source: TrackAttemptSource;
  verificationStatus: TrackAttemptVerificationStatus;
  stravaUrl: string;
  gpxFileName: string | null;
  submittedAt: string;
  startedAt: string | null;
  elapsedTimeMs: number | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  previousReview: {
    decision: "verified" | "rejected";
    reviewedAt: string;
    reviewNote: string | null;
  } | null;
  activityName: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  evidence: TrackAttemptEvidence | null;
};

export type TrackAttemptEvidence = {
  analysisVersion: 2;
  status: "ready";
  source: "gpx_upload" | "strava";
  activity: TrackAttemptActivityEvidence;
  sitrailTrack: {
    distanceMeters: number | null;
    elevationGainMeters: number | null;
    route: RoutePoint[];
  };
  comparison: TrackAttemptComparison;
  report: TrackAttemptAnalysisReport;
};

export type ReviewTrackAttemptInput = {
  attemptId: string;
  decision: "verified" | "rejected";
  reviewNote?: string | null;
  startedAt?: string | null;
  elapsedTimeMs?: number | null;
  activityName?: string | null;
  distanceKm?: number | null;
  elevationGainM?: number | null;
};

type TrackAttemptRow = {
  id: string;
  track_template_id: string;
  track_version_id: string | null;
  athlete_profile_id: string;
  source: TrackAttemptSource;
  verification_status: TrackAttemptVerificationStatus;
  strava_url: string | null;
  submitted_at: string;
  started_at: string | null;
  elapsed_time_ms: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  result_json: Record<string, unknown> | null;
};

type TrackAttemptEvidenceRow = {
  track_attempt_id: string;
  source: "gpx_upload" | "strava";
  original_file_name: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_sha256: string | null;
  evidence_json: Record<string, unknown>;
};

type TrackAttemptReviewRow = {
  track_attempt_id: string;
  decision: "verified" | "rejected";
  review_note: string | null;
  created_at: string;
};

const TRACK_ATTEMPT_COLUMNS = [
  "id",
  "track_template_id",
  "track_version_id",
  "athlete_profile_id",
  "source",
  "verification_status",
  "strava_url",
  "submitted_at",
  "started_at",
  "elapsed_time_ms",
  "reviewed_at",
  "review_note",
  "result_json",
].join(",");

export function canReviewTrackAttempts(platformRole: string | null | undefined) {
  return platformRole === "super_admin";
}

export function canResubmitRejectedTrackAttempt(
  attempt: Pick<TrackAttemptRow, "athlete_profile_id" | "track_template_id" | "verification_status">,
  athleteProfileId: string,
  trackTemplateId: string,
) {
  return attempt.verification_status === "rejected"
    && attempt.athlete_profile_id === athleteProfileId
    && attempt.track_template_id === trackTemplateId;
}

function requireSuperAdministrator(session: RequestSession) {
  if (!canReviewTrackAttempts(session.account.platformRole)) {
    throw forbidden("Only the super administrator can review route attempts.");
  }
}

export function normalizeStravaActivityUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw badRequest("Enter a valid Strava activity URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const activityMatch = /^\/activities\/(\d+)\/?$/.exec(parsed.pathname);
  if (
    parsed.protocol !== "https:"
    || !["strava.com", "www.strava.com"].includes(hostname)
    || !activityMatch
  ) {
    throw badRequest("Use a public Strava activity URL such as https://www.strava.com/activities/123456.");
  }

  return `https://www.strava.com/activities/${activityMatch[1]}`;
}

export function stravaActivityIdFromUrl(value: string) {
  return normalizeStravaActivityUrl(value).split("/").at(-1)!;
}

function routePointsFromJson(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const candidate = point as { lat?: unknown; lng?: unknown };
    return typeof candidate.lat === "number" && typeof candidate.lng === "number"
      ? [{ lat: candidate.lat, lng: candidate.lng }]
      : [];
  });
}

function genericStravaActivity(activity: StravaActivityEvidence): TrackAttemptActivityEvidence {
  return {
    source: "strava",
    activityId: activity.activityId,
    activityName: activity.activityName,
    athleteName: activity.athleteName,
    sportType: activity.sportType,
    startedAt: activity.startedAt,
    localStartedAt: activity.localStartedAt,
    timezone: activity.timezone,
    elapsedTimeSeconds: activity.elapsedTimeSeconds,
    movingTimeSeconds: activity.movingTimeSeconds,
    distanceMeters: activity.distanceMeters,
    elevationGainMeters: activity.elevationGainMeters,
    elevationLossMeters: null,
    averageSpeedMetersPerSecond: activity.averageSpeedMetersPerSecond,
    maxSpeedMetersPerSecond: activity.maxSpeedMetersPerSecond,
    averageHeartRate: activity.averageHeartRate,
    maxHeartRate: activity.maxHeartRate,
    calories: activity.calories,
    deviceName: activity.deviceName,
    description: activity.description,
    originalFileName: null,
    timestampCoveragePercent: 100,
    timingAnomalyCount: 0,
    route: activity.route,
    splits: activity.splits,
    importedAt: activity.fetchedAt,
  };
}

function attemptEvidence(
  result: Record<string, unknown> | null,
  storedEvidence: TrackAttemptEvidenceRow | null = null,
) {
  const privateEvidence = storedEvidence?.evidence_json;
  if (
    privateEvidence?.analysisVersion === 2
    && privateEvidence.status === "ready"
    && privateEvidence.activity
    && privateEvidence.sitrailTrack
    && privateEvidence.comparison
    && privateEvidence.report
  ) {
    return privateEvidence as unknown as TrackAttemptEvidence;
  }
  // The privacy migration moves legacy v1 analyses into private evidence too.
  if (privateEvidence?.analysisVersion === 1) result = privateEvidence;
  if (
    result?.analysisVersion !== 1
    || result.status !== "ready"
    || !result.stravaActivity
    || !result.sitrailTrack
    || !result.comparison
  ) {
    return null;
  }
  const legacy = result as unknown as {
    stravaActivity: StravaActivityEvidence;
    sitrailTrack: TrackAttemptEvidence["sitrailTrack"];
    comparison: TrackAttemptComparison;
  };
  const activity = genericStravaActivity(legacy.stravaActivity);
  return {
    analysisVersion: 2,
    status: "ready",
    source: "strava",
    activity,
    sitrailTrack: legacy.sitrailTrack,
    comparison: legacy.comparison,
    report: buildTrackAttemptAnalysisReport({
      comparison: legacy.comparison,
      timestampCoveragePercent: activity.timestampCoveragePercent,
      timingAnomalyCount: activity.timingAnomalyCount,
      maxSpeedMetersPerSecond: activity.maxSpeedMetersPerSecond,
    }),
  } satisfies TrackAttemptEvidence;
}

function numericResultValue(result: Record<string, unknown> | null, key: string) {
  const value = result?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function publicTrackAttemptSummary(result: Record<string, unknown> | null) {
  const summary: Record<string, unknown> = {};
  for (const key of ["submissionSource", "activityName"]) {
    if (typeof result?.[key] === "string" || result?.[key] === null) summary[key] = result[key];
  }
  for (const key of ["distanceKm", "elevationGainM", "timestampCoveragePercent", "submissionCount"]) {
    if ((typeof result?.[key] === "number" && Number.isFinite(result[key])) || result?.[key] === null) summary[key] = result[key];
  }
  if (typeof result?.resubmittedAfterRejection === "boolean") summary.resubmittedAfterRejection = result.resubmittedAfterRejection;
  const analysis = result?.analysisSummary;
  if (analysis && typeof analysis === "object" && !Array.isArray(analysis)) {
    const values = analysis as Record<string, unknown>;
    const bounded: Record<string, unknown> = {};
    if (["approve", "reject", "manual_review"].includes(String(values.recommendation))) bounded.recommendation = values.recommendation;
    for (const key of ["courseCoveragePercent", "activityOnCoursePercent", "distanceDeltaPercent"]) {
      if ((typeof values[key] === "number" && Number.isFinite(values[key])) || values[key] === null) bounded[key] = values[key];
    }
    if (Object.keys(bounded).length) summary.analysisSummary = bounded;
  }
  return summary;
}

async function mapAttemptRows(
  rows: TrackAttemptRow[],
  env: ServerEnv,
): Promise<TrackAttemptReviewItem[]> {
  if (!rows.length) return [];
  const adminClient = createAdminSupabaseClient(env);
  const trackIds = Array.from(new Set(rows.map((row) => row.track_template_id)));
  const athleteIds = Array.from(new Set(rows.map((row) => row.athlete_profile_id)));
  const attemptIds = rows.map((row) => row.id);
  const [tracksResult, athletesResult, reviewsResult, evidenceResult] = await Promise.all([
    adminClient
      .from("track_templates")
      .select("id,slug,name")
      .in("id", trackIds)
      .returns<Array<{ id: string; slug: string; name: string }>>(),
    adminClient
      .from("athlete_profiles")
      .select("id,display_name")
      .in("id", athleteIds)
      .returns<Array<{ id: string; display_name: string }>>(),
    adminClient
      .from("track_attempt_reviews")
      .select("track_attempt_id,decision,review_note,created_at")
      .in("track_attempt_id", attemptIds)
      .order("created_at", { ascending: false })
      .returns<TrackAttemptReviewRow[]>(),
    adminClient
      .from("track_attempt_evidence")
      .select("track_attempt_id,source,original_file_name,storage_bucket,storage_path,file_sha256,evidence_json")
      .in("track_attempt_id", attemptIds)
      .returns<TrackAttemptEvidenceRow[]>(),
  ]);
  if (tracksResult.error) throw tracksResult.error;
  if (athletesResult.error) throw athletesResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;

  const tracks = new Map((tracksResult.data ?? []).map((track) => [track.id, track]));
  const athletes = new Map((athletesResult.data ?? []).map((athlete) => [athlete.id, athlete]));
  const previousReviewByAttemptId = new Map<string, TrackAttemptReviewRow>();
  const evidenceByAttemptId = new Map(
    (evidenceResult.data ?? []).map((evidence) => [evidence.track_attempt_id, evidence]),
  );
  for (const review of reviewsResult.data ?? []) {
    if (!previousReviewByAttemptId.has(review.track_attempt_id)) {
      previousReviewByAttemptId.set(review.track_attempt_id, review);
    }
  }
  return rows.map((row) => {
    const result = row.result_json ?? {};
    const track = tracks.get(row.track_template_id);
    const previousReview = previousReviewByAttemptId.get(row.id) ?? null;
    return {
      id: row.id,
      trackTemplateId: row.track_template_id,
      trackVersionId: row.track_version_id,
      trackSlug: track?.slug ?? "unknown-track",
      trackName: track?.name ?? "Route",
      athleteProfileId: row.athlete_profile_id,
      athleteName: athletes.get(row.athlete_profile_id)?.display_name ?? "Athlete",
      source: row.source,
      verificationStatus: row.verification_status,
      stravaUrl: row.strava_url ?? "",
      gpxFileName: evidenceByAttemptId.get(row.id)?.original_file_name ?? null,
      submittedAt: row.submitted_at,
      startedAt: row.started_at,
      elapsedTimeMs: row.elapsed_time_ms,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      previousReview: previousReview ? {
        decision: previousReview.decision,
        reviewedAt: previousReview.created_at,
        reviewNote: previousReview.review_note,
      } : null,
      activityName: typeof result.activityName === "string" ? result.activityName : null,
      distanceKm: numericResultValue(result, "distanceKm"),
      elevationGainM: numericResultValue(result, "elevationGainM"),
      evidence: attemptEvidence(result, evidenceByAttemptId.get(row.id) ?? null),
    };
  });
}

async function buildStravaTrackAttemptEvidence(input: {
  activityId: string;
  userId?: string;
  athleteProfileId?: string;
  trackVersionId: string;
  trackDistanceMeters: number | null;
  trackElevationGainMeters: number | null;
}, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const [activity, renderCacheResult] = await Promise.all([
    fetchStravaActivityEvidence({
      activityId: input.activityId,
      userId: input.userId,
      athleteProfileId: input.athleteProfileId,
    }, env),
    adminClient
      .from("track_render_cache")
      .select("polyline_json")
      .eq("track_version_id", input.trackVersionId)
      .maybeSingle<{ polyline_json: unknown }>(),
  ]);
  if (renderCacheResult.error) throw renderCacheResult.error;
  const sitrailRoute = routePointsFromJson(renderCacheResult.data?.polyline_json);
  if (sitrailRoute.length < 2) {
    throw badRequest("This route does not have usable GPX geometry for attempt verification.");
  }
  const comparison = compareTrackAttemptRoutes({
    sitrailRoute,
    activityRoute: activity.route,
    sitrailDistanceMeters: input.trackDistanceMeters,
    activityDistanceMeters: activity.distanceMeters,
  });
  const genericActivity = genericStravaActivity(activity);
  const evidence: TrackAttemptEvidence = {
    analysisVersion: 2,
    status: "ready",
    source: "strava",
    activity: genericActivity,
    sitrailTrack: {
      distanceMeters: input.trackDistanceMeters,
      elevationGainMeters: input.trackElevationGainMeters,
      route: resampleRoute(sitrailRoute, 10, 1_000),
    },
    comparison,
    report: buildTrackAttemptAnalysisReport({
      comparison,
      timestampCoveragePercent: genericActivity.timestampCoveragePercent,
      timingAnomalyCount: genericActivity.timingAnomalyCount,
      maxSpeedMetersPerSecond: genericActivity.maxSpeedMetersPerSecond,
    }),
  };
  return evidence;
}

async function buildGpxTrackAttemptEvidence(input: {
  parsedActivity: ParsedTrackAttemptGpx;
  originalFileName: string;
  trackVersionId: string;
  trackDistanceMeters: number | null;
  trackElevationGainMeters: number | null;
}, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: renderCache, error } = await adminClient
    .from("track_render_cache")
    .select("polyline_json")
    .eq("track_version_id", input.trackVersionId)
    .maybeSingle<{ polyline_json: unknown }>();
  if (error) throw error;
  const sitrailRoute = routePointsFromJson(renderCache?.polyline_json);
  if (sitrailRoute.length < 2) {
    throw badRequest("This route does not have usable GPX geometry for attempt verification.");
  }
  const comparison = compareTrackAttemptRoutes({
    sitrailRoute,
    activityRoute: input.parsedActivity.route,
    sitrailDistanceMeters: input.trackDistanceMeters,
    activityDistanceMeters: input.parsedActivity.distanceMeters,
  });
  const activity: TrackAttemptActivityEvidence = {
    source: "gpx_upload",
    activityId: null,
    activityName: input.parsedActivity.activityName,
    athleteName: null,
    sportType: "GPX activity",
    startedAt: input.parsedActivity.startedAt,
    localStartedAt: null,
    timezone: null,
    elapsedTimeSeconds: input.parsedActivity.elapsedTimeSeconds,
    movingTimeSeconds: input.parsedActivity.movingTimeSeconds,
    distanceMeters: input.parsedActivity.distanceMeters,
    elevationGainMeters: input.parsedActivity.elevationGainMeters,
    elevationLossMeters: input.parsedActivity.elevationLossMeters,
    averageSpeedMetersPerSecond: input.parsedActivity.averageSpeedMetersPerSecond,
    maxSpeedMetersPerSecond: input.parsedActivity.maxSpeedMetersPerSecond,
    averageHeartRate: null,
    maxHeartRate: null,
    calories: null,
    deviceName: null,
    description: null,
    originalFileName: input.originalFileName,
    timestampCoveragePercent: input.parsedActivity.timestampCoveragePercent,
    timingAnomalyCount: input.parsedActivity.timingAnomalyCount,
    route: resampleRoute(input.parsedActivity.route, 10, 2_000),
    splits: input.parsedActivity.splits,
    importedAt: new Date().toISOString(),
  };
  return {
    analysisVersion: 2,
    status: "ready",
    source: "gpx_upload",
    activity,
    sitrailTrack: {
      distanceMeters: input.trackDistanceMeters,
      elevationGainMeters: input.trackElevationGainMeters,
      route: resampleRoute(sitrailRoute, 10, 1_000),
    },
    comparison,
    report: buildTrackAttemptAnalysisReport({
      comparison,
      timestampCoveragePercent: activity.timestampCoveragePercent,
      timingAnomalyCount: activity.timingAnomalyCount,
      maxSpeedMetersPerSecond: activity.maxSpeedMetersPerSecond,
    }),
  } satisfies TrackAttemptEvidence;
}

const TRACK_ATTEMPT_GPX_BUCKET = "track-attempt-gpx";

export async function submitTrackAttempt(
  session: RequestSession,
  input: { trackSlug: string; gpxFileName: string; gpxXml: string },
  env: ServerEnv = loadServerEnv(),
): Promise<TrackAttemptReviewItem> {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const originalFileName = sanitizeTrackAttemptGpxFileName(input.gpxFileName);
  const parsedActivity = parseTrackAttemptGpx(input.gpxXml, originalFileName);
  const fileSha256 = createHash("sha256").update(input.gpxXml, "utf8").digest("hex");
  const adminClient = createAdminSupabaseClient(env);

  const { data: track, error: trackError } = await adminClient
    .from("track_templates")
    .select("id,slug,name")
    .eq("slug", input.trackSlug)
    .maybeSingle<{ id: string; slug: string; name: string }>();
  if (trackError) throw trackError;
  if (!track) throw notFound("Route not found.");

  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("id,distance_km,elevation_gain_m")
    .eq("track_template_id", track.id)
    .not("published_at", "is", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; distance_km: number | null; elevation_gain_m: number | null }>();
  if (versionError) throw versionError;
  if (!version) throw badRequest("Attempts can only be submitted for a published route.");

  const { data: duplicateEvidence, error: duplicateEvidenceError } = await adminClient
    .from("track_attempt_evidence")
    .select("track_attempt_id,source,original_file_name,storage_bucket,storage_path,file_sha256,evidence_json")
    .eq("file_sha256", fileSha256)
    .maybeSingle<TrackAttemptEvidenceRow>();
  if (duplicateEvidenceError) throw duplicateEvidenceError;
  let existingAttempt: TrackAttemptRow | null = null;
  if (duplicateEvidence) {
    const { data, error } = await adminClient
      .from("track_attempts")
      .select(TRACK_ATTEMPT_COLUMNS)
      .eq("id", duplicateEvidence.track_attempt_id)
      .maybeSingle<TrackAttemptRow>();
    if (error) throw error;
    existingAttempt = data;
  }
  if (
    existingAttempt
    && !canResubmitRejectedTrackAttempt(existingAttempt, athleteProfileId, track.id)
  ) {
    throw conflict("This GPX activity has already been submitted.");
  }

  const evidence = await buildGpxTrackAttemptEvidence({
    parsedActivity,
    originalFileName,
    trackVersionId: version.id,
    trackDistanceMeters: version.distance_km == null ? null : version.distance_km * 1_000,
    trackElevationGainMeters: version.elevation_gain_m,
  }, env);
  const activity = evidence.activity;
  const attemptId = existingAttempt?.id ?? randomUUID();
  const storagePath = `${athleteProfileId}/${attemptId}/${fileSha256}.gpx`;
  const uploadResult = await adminClient.storage
    .from(TRACK_ATTEMPT_GPX_BUCKET)
    .upload(storagePath, Buffer.from(input.gpxXml, "utf8"), {
      contentType: "application/gpx+xml",
      upsert: Boolean(existingAttempt),
    });
  if (uploadResult.error) throw uploadResult.error;
  const resultJson = {
    submissionSource: "gpx_upload",
    activityName: activity.activityName,
    distanceKm: activity.distanceMeters / 1_000,
    elevationGainM: activity.elevationGainMeters,
    timestampCoveragePercent: activity.timestampCoveragePercent,
    analysisSummary: {
      recommendation: evidence.report.recommendation,
      courseCoveragePercent: evidence.comparison.courseCoveragePercent,
      activityOnCoursePercent: evidence.comparison.activityOnCoursePercent,
      distanceDeltaPercent: evidence.comparison.distanceDeltaPercent,
    },
  };

  if (existingAttempt) {
    const previousSubmissionCount = numericResultValue(existingAttempt.result_json, "submissionCount") ?? 1;
    const evidenceUpdate = await adminClient
      .from("track_attempt_evidence")
      .update({
        source: "gpx_upload",
        original_file_name: originalFileName,
        storage_bucket: TRACK_ATTEMPT_GPX_BUCKET,
        storage_path: storagePath,
        evidence_json: evidence,
      })
      .eq("track_attempt_id", existingAttempt.id);
    if (evidenceUpdate.error) throw evidenceUpdate.error;
    const { data, error } = await adminClient
      .from("track_attempts")
      .update({
        track_version_id: version.id,
        source: "gpx_upload",
        verification_status: "submitted",
        submitted_at: new Date().toISOString(),
        started_at: activity.startedAt,
        finished_at: null,
        elapsed_time_ms: activity.elapsedTimeSeconds == null ? null : activity.elapsedTimeSeconds * 1_000,
        reviewed_at: null,
        reviewed_by_user_id: null,
        review_note: null,
        result_json: {
          ...resultJson,
          submissionCount: previousSubmissionCount + 1,
          resubmittedAfterRejection: true,
        },
      })
      .eq("id", existingAttempt.id)
      .eq("verification_status", "rejected")
      .select(TRACK_ATTEMPT_COLUMNS)
      .maybeSingle<TrackAttemptRow>();
    if (error) throw error;
    if (!data) throw conflict("This GPX activity has already been resubmitted.");
    const [attempt] = await mapAttemptRows([data], env);
    return attempt;
  }

  const { data, error } = await adminClient
    .from("track_attempts")
    .insert({
      id: attemptId,
      track_template_id: track.id,
      track_version_id: version.id,
      athlete_profile_id: athleteProfileId,
      source: "gpx_upload",
      verification_status: "submitted",
      started_at: activity.startedAt,
      elapsed_time_ms: activity.elapsedTimeSeconds == null ? null : activity.elapsedTimeSeconds * 1_000,
      strava_url: null,
      result_json: { ...resultJson, submissionCount: 1 },
    })
    .select(TRACK_ATTEMPT_COLUMNS)
    .single<TrackAttemptRow>();
  if (error?.code === "23505") {
    await adminClient.storage.from(TRACK_ATTEMPT_GPX_BUCKET).remove([storagePath]);
    throw conflict("This GPX activity has already been submitted.");
  }
  if (error) {
    await adminClient.storage.from(TRACK_ATTEMPT_GPX_BUCKET).remove([storagePath]);
    throw error;
  }

  const evidenceInsert = await adminClient
    .from("track_attempt_evidence")
    .insert({
      track_attempt_id: attemptId,
      source: "gpx_upload",
      original_file_name: originalFileName,
      storage_bucket: TRACK_ATTEMPT_GPX_BUCKET,
      storage_path: storagePath,
      file_sha256: fileSha256,
      evidence_json: evidence,
    });
  if (evidenceInsert.error) {
    await Promise.all([
      adminClient.from("track_attempts").delete().eq("id", attemptId),
      adminClient.storage.from(TRACK_ATTEMPT_GPX_BUCKET).remove([storagePath]),
    ]);
    if (evidenceInsert.error.code === "23505") {
      throw conflict("This GPX activity has already been submitted.");
    }
    throw evidenceInsert.error;
  }

  const [attempt] = await mapAttemptRows([data], env);
  return attempt;
}

export async function getCurrentAthleteTrackAttempts(
  session: RequestSession,
  trackSlug: string | null = null,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  let trackTemplateId: string | null = null;
  if (trackSlug) {
    const { data: track, error } = await adminClient
      .from("track_templates")
      .select("id")
      .eq("slug", trackSlug)
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!track) return [];
    trackTemplateId = track.id;
  }

  let query = adminClient
    .from("track_attempts")
    .select(TRACK_ATTEMPT_COLUMNS)
    .eq("athlete_profile_id", athleteProfileId)
    .order("submitted_at", { ascending: false });
  if (trackTemplateId) query = query.eq("track_template_id", trackTemplateId);
  const { data, error } = await query.returns<TrackAttemptRow[]>();
  if (error) throw error;
  return mapAttemptRows(data ?? [], env);
}

export async function listTrackAttemptsForSuperAdmin(
  session: RequestSession,
  status: TrackAttemptVerificationStatus | null = "submitted",
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("track_attempts")
    .select(TRACK_ATTEMPT_COLUMNS)
    .order("submitted_at", { ascending: false })
    .limit(250);
  if (status) query = query.eq("verification_status", status);
  const { data, error } = await query.returns<TrackAttemptRow[]>();
  if (error) throw error;
  return mapAttemptRows(data ?? [], env);
}

export async function refreshTrackAttemptEvidenceAsSuperAdmin(
  session: RequestSession,
  attemptId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data: attempt, error: attemptError } = await adminClient
    .from("track_attempts")
    .select(TRACK_ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle<TrackAttemptRow>();
  if (attemptError) throw attemptError;
  if (!attempt) throw notFound("Route attempt not found.");
  if (attempt.source !== "strava") {
    throw badRequest("GPX evidence is analyzed automatically when the athlete uploads the file.");
  }
  if (!attempt.track_version_id) throw badRequest("This attempt has no route version to compare.");
  const activityId = stravaActivityIdFromUrl(attempt.strava_url ?? "");
  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("distance_km,elevation_gain_m")
    .eq("id", attempt.track_version_id)
    .maybeSingle<{ distance_km: number | null; elevation_gain_m: number | null }>();
  if (versionError) throw versionError;
  if (!version) throw notFound("Route version not found.");
  const evidence = await buildStravaTrackAttemptEvidence({
    activityId,
    athleteProfileId: attempt.athlete_profile_id,
    trackVersionId: attempt.track_version_id,
    trackDistanceMeters: version.distance_km == null ? null : version.distance_km * 1_000,
    trackElevationGainMeters: version.elevation_gain_m,
  }, env);
  const activity = evidence.activity;
  const summaryResult = publicTrackAttemptSummary(attempt.result_json);
  const evidenceUpsert = await adminClient
    .from("track_attempt_evidence")
    .upsert({
      track_attempt_id: attempt.id,
      source: "strava",
      original_file_name: null,
      storage_bucket: null,
      storage_path: null,
      file_sha256: null,
      evidence_json: evidence,
    }, { onConflict: "track_attempt_id" });
  if (evidenceUpsert.error) throw evidenceUpsert.error;
  const { data, error } = await adminClient
    .from("track_attempts")
    .update({
      started_at: activity.startedAt,
      elapsed_time_ms: activity.elapsedTimeSeconds == null ? null : activity.elapsedTimeSeconds * 1_000,
      result_json: {
        ...summaryResult,
        activityName: activity.activityName,
        distanceKm: activity.distanceMeters / 1_000,
        elevationGainM: activity.elevationGainMeters,
        analysisSummary: {
          recommendation: evidence.report.recommendation,
          courseCoveragePercent: evidence.comparison.courseCoveragePercent,
          activityOnCoursePercent: evidence.comparison.activityOnCoursePercent,
          distanceDeltaPercent: evidence.comparison.distanceDeltaPercent,
        },
      },
    })
    .eq("id", attemptId)
    .select(TRACK_ATTEMPT_COLUMNS)
    .single<TrackAttemptRow>();
  if (error) throw error;
  const [mapped] = await mapAttemptRows([data], env);
  return mapped;
}

export async function reviewTrackAttemptAsSuperAdmin(
  session: RequestSession,
  input: ReviewTrackAttemptInput,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const reviewNote = input.reviewNote?.trim() || null;
  if (input.decision === "rejected" && !reviewNote) {
    throw badRequest("Add a reason before rejecting this attempt.");
  }
  if (
    input.decision === "verified"
    && (!input.startedAt || !input.elapsedTimeMs || input.elapsedTimeMs <= 0)
  ) {
    throw badRequest("Verified attempts require the activity start time and elapsed time.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const [currentAttemptResult, storedEvidenceResult] = await Promise.all([
    adminClient
      .from("track_attempts")
      .select("result_json")
      .eq("id", input.attemptId)
      .maybeSingle<{ result_json: Record<string, unknown> | null }>(),
    adminClient
      .from("track_attempt_evidence")
      .select("track_attempt_id,source,original_file_name,storage_bucket,storage_path,file_sha256,evidence_json")
      .eq("track_attempt_id", input.attemptId)
      .maybeSingle<TrackAttemptEvidenceRow>(),
  ]);
  const { data: currentAttempt, error: currentAttemptError } = currentAttemptResult;
  if (currentAttemptError) throw currentAttemptError;
  if (storedEvidenceResult.error) throw storedEvidenceResult.error;
  if (!currentAttempt) throw notFound("Route attempt not found.");
  const evidence = attemptEvidence(currentAttempt.result_json, storedEvidenceResult.data);
  if (
    input.decision === "verified"
    && evidence
    && evidence.report.recommendation !== "approve"
    && !reviewNote
  ) {
    throw badRequest(
      `The analysis recommends ${evidence.report.recommendation.replace("_", " ")}. Add a review note to explain the approval decision.`,
    );
  }
  const resultJson = {
    ...publicTrackAttemptSummary(currentAttempt.result_json),
    activityName: input.activityName?.trim() || null,
    distanceKm: input.distanceKm ?? null,
    elevationGainM: input.elevationGainM ?? null,
  };
  const { data, error } = await adminClient.rpc("review_track_attempt", {
    p_attempt_id: input.attemptId,
    p_reviewer_user_id: session.account.userId,
    p_decision: input.decision,
    p_review_note: reviewNote,
    p_started_at: input.startedAt ?? null,
    p_elapsed_time_ms: input.elapsedTimeMs ?? null,
    p_result_json: resultJson,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw notFound("Route attempt not found.");
  const [attempt] = await mapAttemptRows([row as TrackAttemptRow], env);
  return attempt;
}
