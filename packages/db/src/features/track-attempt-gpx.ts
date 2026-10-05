import { badRequest } from "../errors.js";
import {
  distanceBetweenRoutePoints,
  routeDistanceMeters,
  type RoutePoint,
} from "./track-attempt-analysis.js";

export const MAX_TRACK_ATTEMPT_GPX_BYTES = 4 * 1024 * 1024;
export const MAX_TRACK_ATTEMPT_GPX_POINTS = 100_000;

export type ParsedTrackAttemptSplit = {
  kilometer: number;
  distanceMeters: number;
  elapsedTimeSeconds: number;
  movingTimeSeconds: number;
  paceSecondsPerKm: number | null;
  elevationDifferenceMeters: number | null;
};

export type ParsedTrackAttemptGpx = {
  activityName: string;
  startedAt: string | null;
  elapsedTimeSeconds: number | null;
  movingTimeSeconds: number | null;
  distanceMeters: number;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  timestampCoveragePercent: number;
  timingAnomalyCount: number;
  route: RoutePoint[];
  splits: ParsedTrackAttemptSplit[];
};

type ParsedPoint = RoutePoint & {
  elevationMeters: number | null;
  timestampMs: number | null;
  cumulativeDistanceMeters: number;
};

const TRACK_POINT_PATTERN = /<(?:[\w.-]+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?trkpt\s*>)/gi;

function readAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readElementText(body: string | undefined, name: string) {
  if (!body) return null;
  const match = body.match(new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b[^>]*>\\s*([^<]+?)\\s*<\\/(?:[\\w.-]+:)?${name}\\s*>`,
    "i",
  ));
  return match?.[1]?.trim() || null;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function activityNameFromGpx(gpxXml: string, fallbackFileName: string) {
  const trackName = gpxXml.match(
    /<(?:[\w.-]+:)?trk\b[^>]*>[\s\S]*?<(?:[\w.-]+:)?name\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w.-]+:)?name\s*>/i,
  )?.[1];
  const fallback = fallbackFileName.replace(/\.gpx$/i, "").trim() || "GPX activity";
  return decodeXmlText(trackName?.trim() || fallback).slice(0, 200);
}

function roundedPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function interpolatePointAtDistance(points: ParsedPoint[], targetDistanceMeters: number) {
  let upperIndex = 1;
  while (
    upperIndex < points.length - 1
    && points[upperIndex].cumulativeDistanceMeters < targetDistanceMeters
  ) {
    upperIndex += 1;
  }
  const lower = points[Math.max(0, upperIndex - 1)];
  const upper = points[upperIndex];
  const segmentDistance = upper.cumulativeDistanceMeters - lower.cumulativeDistanceMeters;
  const fraction = segmentDistance > 0
    ? Math.min(1, Math.max(0, (targetDistanceMeters - lower.cumulativeDistanceMeters) / segmentDistance))
    : 0;
  const timestampMs = lower.timestampMs != null && upper.timestampMs != null
    ? lower.timestampMs + (upper.timestampMs - lower.timestampMs) * fraction
    : null;
  const elevationMeters = lower.elevationMeters != null && upper.elevationMeters != null
    ? lower.elevationMeters + (upper.elevationMeters - lower.elevationMeters) * fraction
    : null;
  return { timestampMs, elevationMeters };
}

function deriveSplits(points: ParsedPoint[], totalDistanceMeters: number) {
  if (
    totalDistanceMeters <= 0
    || points[0].timestampMs == null
    || points[points.length - 1].timestampMs == null
  ) {
    return [];
  }

  const splits: ParsedTrackAttemptSplit[] = [];
  let startDistance = 0;
  let start = interpolatePointAtDistance(points, 0);
  let kilometer = 1;
  while (startDistance < totalDistanceMeters) {
    const endDistance = Math.min(totalDistanceMeters, kilometer * 1_000);
    const splitDistance = endDistance - startDistance;
    if (splitDistance < 100 && splits.length) break;
    const end = interpolatePointAtDistance(points, endDistance);
    if (start.timestampMs == null || end.timestampMs == null || end.timestampMs <= start.timestampMs) break;
    const elapsedTimeSeconds = (end.timestampMs - start.timestampMs) / 1_000;
    splits.push({
      kilometer,
      distanceMeters: Math.round(splitDistance),
      elapsedTimeSeconds: Math.round(elapsedTimeSeconds),
      movingTimeSeconds: Math.round(elapsedTimeSeconds),
      paceSecondsPerKm: splitDistance > 0
        ? Math.round(elapsedTimeSeconds / (splitDistance / 1_000))
        : null,
      elevationDifferenceMeters:
        start.elevationMeters == null || end.elevationMeters == null
          ? null
          : Math.round(end.elevationMeters - start.elevationMeters),
    });
    startDistance = endDistance;
    start = end;
    kilometer += 1;
  }
  return splits;
}

export function sanitizeTrackAttemptGpxFileName(value: string) {
  const basename = value.trim().split(/[\\/]/).at(-1) ?? "activity.gpx";
  const normalized = basename
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 160)
    .trim();
  return (normalized || "activity.gpx").toLowerCase().endsWith(".gpx")
    ? normalized || "activity.gpx"
    : `${normalized || "activity"}.gpx`;
}

export function parseTrackAttemptGpx(gpxXml: string, fileName = "activity.gpx"): ParsedTrackAttemptGpx {
  if (!gpxXml.trim()) throw badRequest("Select a GPX activity file to submit.");
  if (Buffer.byteLength(gpxXml, "utf8") > MAX_TRACK_ATTEMPT_GPX_BYTES) {
    throw badRequest("The GPX activity file must be 4 MB or smaller.");
  }
  if (!/<(?:[\w.-]+:)?gpx\b/i.test(gpxXml)) {
    throw badRequest("The uploaded file is not a valid GPX document.");
  }

  const points: ParsedPoint[] = [];
  let cumulativeDistanceMeters = 0;
  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  let hasElevation = false;
  let timestampCount = 0;
  let timingAnomalyCount = 0;
  let movingTimeSeconds = 0;
  let maxSpeedMetersPerSecond: number | null = null;

  for (const match of gpxXml.matchAll(TRACK_POINT_PATTERN)) {
    if (points.length >= MAX_TRACK_ATTEMPT_GPX_POINTS) {
      throw badRequest("The GPX activity contains too many route points.");
    }
    const lat = readAttribute(match[1] ?? "", "lat");
    const lng = readAttribute(match[1] ?? "", "lon");
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const elevationText = readElementText(match[2], "ele");
    const elevationMeters = elevationText == null ? null : Number(elevationText);
    const normalizedElevation = elevationMeters != null && Number.isFinite(elevationMeters)
      ? elevationMeters
      : null;
    const timeText = readElementText(match[2], "time");
    const parsedTimestamp = timeText == null ? Number.NaN : Date.parse(timeText);
    const timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
    if (timestampMs != null) timestampCount += 1;

    const previous = points[points.length - 1];
    const segmentDistanceMeters = previous
      ? distanceBetweenRoutePoints(previous, { lat, lng })
      : 0;
    cumulativeDistanceMeters += segmentDistanceMeters;
    if (previous?.elevationMeters != null && normalizedElevation != null) {
      hasElevation = true;
      const delta = normalizedElevation - previous.elevationMeters;
      if (delta > 0) elevationGainMeters += delta;
      if (delta < 0) elevationLossMeters += Math.abs(delta);
    } else if (normalizedElevation != null) {
      hasElevation = true;
    }
    if (previous?.timestampMs != null && timestampMs != null) {
      const deltaSeconds = (timestampMs - previous.timestampMs) / 1_000;
      if (deltaSeconds <= 0) {
        timingAnomalyCount += 1;
      } else {
        if (deltaSeconds <= 300) movingTimeSeconds += deltaSeconds;
        const speed = segmentDistanceMeters / deltaSeconds;
        if (Number.isFinite(speed)) {
          maxSpeedMetersPerSecond = Math.max(maxSpeedMetersPerSecond ?? 0, speed);
        }
      }
    }
    points.push({
      lat,
      lng,
      elevationMeters: normalizedElevation,
      timestampMs,
      cumulativeDistanceMeters,
    });
  }

  if (points.length < 2) {
    throw badRequest("The GPX activity must contain at least two valid route points.");
  }

  const firstTimestamp = points[0].timestampMs;
  const lastTimestamp = points[points.length - 1].timestampMs;
  const elapsedTimeSeconds = firstTimestamp != null && lastTimestamp != null && lastTimestamp > firstTimestamp
    ? Math.round((lastTimestamp - firstTimestamp) / 1_000)
    : null;
  const distanceMeters = routeDistanceMeters(points);
  const normalizedMovingTime = elapsedTimeSeconds == null
    ? null
    : Math.max(1, Math.min(elapsedTimeSeconds, Math.round(movingTimeSeconds || elapsedTimeSeconds)));

  return {
    activityName: activityNameFromGpx(gpxXml, sanitizeTrackAttemptGpxFileName(fileName)),
    startedAt: firstTimestamp == null ? null : new Date(firstTimestamp).toISOString(),
    elapsedTimeSeconds,
    movingTimeSeconds: normalizedMovingTime,
    distanceMeters: Math.round(distanceMeters),
    elevationGainMeters: hasElevation ? Math.round(elevationGainMeters) : null,
    elevationLossMeters: hasElevation ? Math.round(elevationLossMeters) : null,
    averageSpeedMetersPerSecond:
      normalizedMovingTime && distanceMeters > 0
        ? distanceMeters / normalizedMovingTime
        : null,
    maxSpeedMetersPerSecond,
    timestampCoveragePercent: roundedPercent(100 * timestampCount / points.length),
    timingAnomalyCount,
    route: points.map(({ lat, lng }) => ({ lat, lng })),
    splits: deriveSplits(points, distanceMeters),
  };
}
