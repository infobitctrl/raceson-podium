export type RoutePoint = {
  lat: number;
  lng: number;
};

export type TrackAttemptComparison = {
  algorithmVersion: 1;
  corridorMeters: number;
  requiredOverlapPercent: number;
  overlapPercent: number;
  courseCoveragePercent: number;
  activityOnCoursePercent: number;
  distanceDeltaPercent: number | null;
  startGapMeters: number;
  endGapMeters: number;
  p95DeviationMeters: number;
  orientation: "forward" | "reverse";
  verdict: "pass" | "review" | "fail";
};

export type TrackAttemptReportCheck = {
  id: "course_coverage" | "activity_adherence" | "start" | "finish" | "distance" | "timestamps" | "speed";
  label: string;
  status: "pass" | "warning" | "fail";
  value: string;
  expected: string;
  conclusion: string;
};

export type TrackAttemptAnalysisReport = {
  recommendation: "approve" | "manual_review" | "reject";
  headline: string;
  summary: string;
  checks: TrackAttemptReportCheck[];
  conclusions: string[];
};

export const TRACK_ATTEMPT_CORRIDOR_METERS = 50;
export const TRACK_ATTEMPT_REQUIRED_OVERLAP_PERCENT = 95;
export const TRACK_ATTEMPT_REQUIRED_ACTIVITY_ON_COURSE_PERCENT = 90;
export const TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS = 150;
export const TRACK_ATTEMPT_MAX_DISTANCE_DELTA_PERCENT = 12;

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number) {
  return value * Math.PI / 180;
}

export function distanceBetweenRoutePoints(a: RoutePoint, b: RoutePoint) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const latitudeDelta = lat2 - lat1;
  const longitudeDelta = toRadians(b.lng - a.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function routeDistanceMeters(points: RoutePoint[]) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += distanceBetweenRoutePoints(points[index - 1], points[index]);
  }
  return distance;
}

function validRoutePoints(points: RoutePoint[]) {
  return points.filter((point) =>
    Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90
    && point.lat <= 90
    && point.lng >= -180
    && point.lng <= 180,
  );
}

export function resampleRoute(
  input: RoutePoint[],
  preferredIntervalMeters = 25,
  maxPoints = 1_500,
) {
  const points = validRoutePoints(input);
  if (points.length <= 2) return points;
  const totalDistance = routeDistanceMeters(points);
  if (totalDistance <= 0) return [points[0], points[points.length - 1]];

  const interval = Math.max(
    1,
    preferredIntervalMeters,
    totalDistance / Math.max(1, maxPoints - 1),
  );
  const sampled: RoutePoint[] = [points[0]];
  let segmentIndex = 1;
  let traversed = 0;
  let segmentStartDistance = 0;
  let segmentDistance = distanceBetweenRoutePoints(points[0], points[1]);

  for (let target = interval; target < totalDistance && sampled.length < maxPoints - 1; target += interval) {
    while (
      segmentIndex < points.length - 1
      && segmentStartDistance + segmentDistance < target
    ) {
      segmentStartDistance += segmentDistance;
      segmentIndex += 1;
      segmentDistance = distanceBetweenRoutePoints(points[segmentIndex - 1], points[segmentIndex]);
    }

    traversed = segmentDistance > 0
      ? Math.min(1, Math.max(0, (target - segmentStartDistance) / segmentDistance))
      : 0;
    const start = points[segmentIndex - 1];
    const end = points[segmentIndex];
    sampled.push({
      lat: start.lat + (end.lat - start.lat) * traversed,
      lng: start.lng + (end.lng - start.lng) * traversed,
    });
  }

  sampled.push(points[points.length - 1]);
  return sampled;
}

function pointToSegmentDistanceMeters(point: RoutePoint, start: RoutePoint, end: RoutePoint) {
  const metersPerLongitudeDegree = 111_320 * Math.cos(toRadians(point.lat));
  const metersPerLatitudeDegree = 110_540;
  const startX = (start.lng - point.lng) * metersPerLongitudeDegree;
  const startY = (start.lat - point.lat) * metersPerLatitudeDegree;
  const endX = (end.lng - point.lng) * metersPerLongitudeDegree;
  const endY = (end.lat - point.lat) * metersPerLatitudeDegree;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength <= 0) return Math.hypot(startX, startY);
  const projection = Math.min(1, Math.max(0, -(startX * deltaX + startY * deltaY) / squaredLength));
  return Math.hypot(startX + projection * deltaX, startY + projection * deltaY);
}

function distanceToPolylineMeters(point: RoutePoint, polyline: RoutePoint[]) {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointToSegmentDistanceMeters(point, polyline[index - 1], polyline[index]),
    );
  }
  return nearest;
}

function roundedPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function compareTrackAttemptRoutes(input: {
  sitrailRoute: RoutePoint[];
  activityRoute: RoutePoint[];
  sitrailDistanceMeters?: number | null;
  activityDistanceMeters?: number | null;
  corridorMeters?: number;
  requiredOverlapPercent?: number;
}): TrackAttemptComparison {
  const sitrailRoute = resampleRoute(input.sitrailRoute);
  const activityRoute = resampleRoute(input.activityRoute);
  if (sitrailRoute.length < 2 || activityRoute.length < 2) {
    throw new Error("Both RacesOn and activity routes need at least two valid GPS points.");
  }

  const corridorMeters = input.corridorMeters ?? TRACK_ATTEMPT_CORRIDOR_METERS;
  const requiredOverlapPercent =
    input.requiredOverlapPercent ?? TRACK_ATTEMPT_REQUIRED_OVERLAP_PERCENT;
  const courseDistances = sitrailRoute.map((point) => distanceToPolylineMeters(point, activityRoute));
  const activityDistances = activityRoute.map((point) => distanceToPolylineMeters(point, sitrailRoute));
  const courseCoveragePercent = roundedPercent(
    100 * courseDistances.filter((distance) => distance <= corridorMeters).length / courseDistances.length,
  );
  const activityOnCoursePercent = roundedPercent(
    100 * activityDistances.filter((distance) => distance <= corridorMeters).length / activityDistances.length,
  );
  const overlapPercent = Math.min(courseCoveragePercent, activityOnCoursePercent);
  const forwardStartGap = distanceBetweenRoutePoints(activityRoute[0], sitrailRoute[0]);
  const forwardEndGap = distanceBetweenRoutePoints(
    activityRoute[activityRoute.length - 1],
    sitrailRoute[sitrailRoute.length - 1],
  );
  const reverseStartGap = distanceBetweenRoutePoints(
    activityRoute[0],
    sitrailRoute[sitrailRoute.length - 1],
  );
  const reverseEndGap = distanceBetweenRoutePoints(
    activityRoute[activityRoute.length - 1],
    sitrailRoute[0],
  );
  const orientation = forwardStartGap + forwardEndGap <= reverseStartGap + reverseEndGap
    ? "forward"
    : "reverse";
  const sitrailDistance = input.sitrailDistanceMeters ?? routeDistanceMeters(sitrailRoute);
  const activityDistance = input.activityDistanceMeters ?? routeDistanceMeters(activityRoute);
  const distanceDeltaPercent = sitrailDistance > 0
    ? roundedPercent(100 * Math.abs(activityDistance - sitrailDistance) / sitrailDistance)
    : null;
  const p95DeviationMeters = Math.round(percentile(activityDistances, 0.95));
  const verdict = overlapPercent >= requiredOverlapPercent
    ? "pass"
    : overlapPercent >= 85
      ? "review"
      : "fail";

  return {
    algorithmVersion: 1,
    corridorMeters,
    requiredOverlapPercent,
    overlapPercent,
    courseCoveragePercent,
    activityOnCoursePercent,
    distanceDeltaPercent,
    startGapMeters: Math.round(orientation === "forward" ? forwardStartGap : reverseStartGap),
    endGapMeters: Math.round(orientation === "forward" ? forwardEndGap : reverseEndGap),
    p95DeviationMeters,
    orientation,
    verdict,
  };
}

function checkStatus(pass: boolean, fail: boolean): TrackAttemptReportCheck["status"] {
  if (pass) return "pass";
  return fail ? "fail" : "warning";
}

export function buildTrackAttemptAnalysisReport(input: {
  comparison: TrackAttemptComparison;
  timestampCoveragePercent: number;
  timingAnomalyCount: number;
  maxSpeedMetersPerSecond: number | null;
}): TrackAttemptAnalysisReport {
  const { comparison } = input;
  const checks: TrackAttemptReportCheck[] = [
    {
      id: "course_coverage",
      label: "Official route covered",
      status: checkStatus(
        comparison.courseCoveragePercent >= TRACK_ATTEMPT_REQUIRED_OVERLAP_PERCENT,
        comparison.courseCoveragePercent < 85,
      ),
      value: `${comparison.courseCoveragePercent.toFixed(1)}%`,
      expected: `At least ${TRACK_ATTEMPT_REQUIRED_OVERLAP_PERCENT}% within ${comparison.corridorMeters} m`,
      conclusion: comparison.courseCoveragePercent >= TRACK_ATTEMPT_REQUIRED_OVERLAP_PERCENT
        ? "The activity covers the official route sufficiently."
        : "A meaningful part of the official route is not represented in the activity.",
    },
    {
      id: "activity_adherence",
      label: "Activity follows route",
      status: checkStatus(
        comparison.activityOnCoursePercent >= TRACK_ATTEMPT_REQUIRED_ACTIVITY_ON_COURSE_PERCENT,
        comparison.activityOnCoursePercent < 75,
      ),
      value: `${comparison.activityOnCoursePercent.toFixed(1)}%`,
      expected: `At least ${TRACK_ATTEMPT_REQUIRED_ACTIVITY_ON_COURSE_PERCENT}% within ${comparison.corridorMeters} m`,
      conclusion: comparison.activityOnCoursePercent >= TRACK_ATTEMPT_REQUIRED_ACTIVITY_ON_COURSE_PERCENT
        ? "Most recorded activity points stay inside the route corridor."
        : "The recording contains substantial off-route distance or additional travel.",
    },
    {
      id: "start",
      label: "Start proximity",
      status: checkStatus(
        comparison.startGapMeters <= TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS,
        comparison.startGapMeters > 1_000,
      ),
      value: `${comparison.startGapMeters} m`,
      expected: `Within ${TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS} m`,
      conclusion: comparison.startGapMeters <= TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS
        ? "The recorded activity starts near the official route endpoint."
        : "The activity start requires administrator review.",
    },
    {
      id: "finish",
      label: "Finish proximity",
      status: checkStatus(
        comparison.endGapMeters <= TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS,
        comparison.endGapMeters > 1_000,
      ),
      value: `${comparison.endGapMeters} m`,
      expected: `Within ${TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS} m`,
      conclusion: comparison.endGapMeters <= TRACK_ATTEMPT_MAX_START_FINISH_GAP_METERS
        ? "The recorded activity finishes near the official route endpoint."
        : "The activity finish requires administrator review.",
    },
    {
      id: "distance",
      label: "Distance difference",
      status: comparison.distanceDeltaPercent == null
        ? "warning"
        : checkStatus(
          comparison.distanceDeltaPercent <= TRACK_ATTEMPT_MAX_DISTANCE_DELTA_PERCENT,
          comparison.distanceDeltaPercent > 30,
        ),
      value: comparison.distanceDeltaPercent == null ? "Unavailable" : `${comparison.distanceDeltaPercent.toFixed(1)}%`,
      expected: `No more than ${TRACK_ATTEMPT_MAX_DISTANCE_DELTA_PERCENT}%`,
      conclusion: comparison.distanceDeltaPercent != null
        && comparison.distanceDeltaPercent <= TRACK_ATTEMPT_MAX_DISTANCE_DELTA_PERCENT
        ? "Recorded and official route distances are reasonably consistent."
        : "The distance difference should be checked against the map overlay.",
    },
    {
      id: "timestamps",
      label: "Timing data",
      status: checkStatus(
        input.timestampCoveragePercent >= 95 && input.timingAnomalyCount === 0,
        input.timestampCoveragePercent < 50 || input.timingAnomalyCount > 10,
      ),
      value: `${input.timestampCoveragePercent.toFixed(1)}% timestamped`,
      expected: "At least 95% with chronological timestamps",
      conclusion: input.timestampCoveragePercent >= 95 && input.timingAnomalyCount === 0
        ? "The GPX contains sufficiently complete chronological timing data."
        : "Timing information is incomplete or contains ordering anomalies.",
    },
    {
      id: "speed",
      label: "Recorded speed",
      status: input.maxSpeedMetersPerSecond == null
        ? "warning"
        : checkStatus(input.maxSpeedMetersPerSecond <= 12, input.maxSpeedMetersPerSecond > 20),
      value: input.maxSpeedMetersPerSecond == null
        ? "Unavailable"
        : `${(input.maxSpeedMetersPerSecond * 3.6).toFixed(1)} km/h maximum`,
      expected: "No implausible GPS speed spikes",
      conclusion: input.maxSpeedMetersPerSecond != null && input.maxSpeedMetersPerSecond <= 12
        ? "No unusual maximum-speed signal was detected."
        : "Inspect the GPX timing and route for GPS jumps or non-running travel.",
    },
  ];
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warning");
  const routePasses = checks
    .filter((check) => ["course_coverage", "activity_adherence", "start", "finish", "distance"].includes(check.id))
    .every((check) => check.status === "pass");
  const recommendation = failedChecks.length
    ? "reject"
    : routePasses && warningChecks.length === 0
      ? "approve"
      : "manual_review";
  const headline = recommendation === "approve"
    ? "Route match supports approval"
    : recommendation === "reject"
      ? "Route evidence has major conflicts"
      : "Route match needs administrator judgment";
  const conclusions = checks
    .filter((check) => check.status !== "pass")
    .map((check) => check.conclusion);
  conclusions.push(
    "A GPX file can be edited; this automated report supports but does not replace the administrator's decision.",
  );
  return {
    recommendation,
    headline,
    summary: failedChecks.length
      ? `${failedChecks.length} major check${failedChecks.length === 1 ? "" : "s"} failed and should be resolved before approval.`
      : warningChecks.length
        ? `${warningChecks.length} check${warningChecks.length === 1 ? "" : "s"} need manual review before a decision.`
        : "All configured route, timing, and plausibility checks passed.",
    checks,
    conclusions,
  };
}
