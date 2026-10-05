export type PublicLocationPoint = {
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
};

const coordinatePattern = /(-?\d{1,2}(?:\.\d+)?)\s*[,/]\s*(-?\d{1,3}(?:\.\d+)?)/;
const genericRouteLabelPattern = /^(start(?: point)?|finish|cp\s*\d+|checkpoint\s*\d*|route point|weather(?: area)?|forecast(?: area)?|location|point)$/i;

export function normalizeLocationLabel(label: string | null | undefined) {
  return typeof label === "string" ? label.replace(/\s+/g, " ").trim() : "";
}

function hasValidCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat ?? 0) <= 90 && Math.abs(lng ?? 0) <= 180;
}

export function parseCoordinatesFromLabel(label: string | null | undefined) {
  const normalized = normalizeLocationLabel(label);
  if (!normalized) return null;

  const match = normalized.match(coordinatePattern);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return hasValidCoordinates(lat, lng) ? { lat, lng } : null;
}

export function isGenericRouteLabel(label: string | null | undefined) {
  const normalized = normalizeLocationLabel(label);
  return normalized ? genericRouteLabelPattern.test(normalized) : false;
}

export function isCoordinateLikeLabel(label: string | null | undefined) {
  const normalized = normalizeLocationLabel(label);
  if (!normalized) return false;

  const coordinates = parseCoordinatesFromLabel(normalized);
  if (!coordinates) return false;

  const remainder = normalized
    .replace(coordinatePattern, " ")
    .replace(/[|()]/g, " ")
    .replace(/[·:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return !remainder || isGenericRouteLabel(remainder);
}

export function formatPlaceName(label: string | null | undefined) {
  const normalized = normalizeLocationLabel(label);
  if (!normalized || isCoordinateLikeLabel(normalized) || isGenericRouteLabel(normalized)) return "";

  const match = normalized.match(/^(start(?: point)?|finish|cp\s*\d+|checkpoint\s*\d*)\s*[—-]\s*(.+)$/i);
  const candidate = normalizeLocationLabel(match?.[2] ?? normalized);

  if (!candidate || isCoordinateLikeLabel(candidate) || isGenericRouteLabel(candidate)) return "";
  return candidate;
}

function distanceBetweenPointsMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRadians(right.lat - left.lat);
  const dLng = toRadians(right.lng - left.lng);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);

  const haversine =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return 2 * earthRadiusM * Math.asin(Math.sqrt(haversine));
}

export function findNearestNamedPoint(
  points: PublicLocationPoint[],
  position: { lat: number; lng: number },
) {
  const namedPoints = points.filter((point) => (
    hasValidCoordinates(point.lat, point.lng) && formatPlaceName(point.name).length > 0
  )) as Array<Required<Pick<PublicLocationPoint, "lat" | "lng">> & PublicLocationPoint>;

  if (!namedPoints.length) return null;

  return namedPoints.reduce((nearest, point) => (
    distanceBetweenPointsMeters(
      { lat: point.lat, lng: point.lng },
      position,
    ) < distanceBetweenPointsMeters(
      { lat: nearest.lat, lng: nearest.lng },
      position,
    ) ? point : nearest
  ));
}

export function resolvePublicLocationLabel(
  label: string | null | undefined,
  options: {
    points?: PublicLocationPoint[];
    fallbackLabel?: string | null | undefined;
    position?: { lat: number; lng: number } | null;
  } = {},
) {
  const normalized = normalizeLocationLabel(label);

  if (normalized && !isCoordinateLikeLabel(normalized) && !isGenericRouteLabel(normalized)) {
    return formatPlaceName(normalized) || normalized;
  }

  const position = options.position ?? parseCoordinatesFromLabel(normalized);
  const nearestPoint = position ? findNearestNamedPoint(options.points ?? [], position) : null;
  const nearestPlaceName = formatPlaceName(nearestPoint?.name);
  if (nearestPlaceName) return nearestPlaceName;

  const fallbackNormalized = normalizeLocationLabel(options.fallbackLabel);
  if (fallbackNormalized && !isCoordinateLikeLabel(fallbackNormalized) && !isGenericRouteLabel(fallbackNormalized)) {
    return formatPlaceName(fallbackNormalized) || fallbackNormalized;
  }

  return fallbackNormalized || normalized || "Croatia";
}

function buildCheckpointPrefix(
  label: string | null | undefined,
  index: number,
  totalCount: number,
  type?: string | null,
) {
  const normalized = normalizeLocationLabel(label);
  const explicitPrefix = normalized.match(/^(cp\s*\d+|checkpoint\s*\d+)/i)?.[1];
  if (explicitPrefix) return explicitPrefix.replace(/\s+/g, " ").trim();

  if ((type ?? "").toLowerCase() === "start" || index === 0) return "Start";
  if ((type ?? "").toLowerCase() === "finish" || index === Math.max(totalCount - 1, 0)) return "Finish";
  return `Checkpoint ${index + 1}`;
}

export function buildPublicCheckpointName(input: {
  label: string | null | undefined;
  index: number;
  totalCount: number;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  points?: PublicLocationPoint[];
  fallbackLabel?: string | null | undefined;
}) {
  const normalized = normalizeLocationLabel(input.label);
  if (normalized && !isCoordinateLikeLabel(normalized) && !isGenericRouteLabel(normalized)) {
    return normalized;
  }

  const prefix = buildCheckpointPrefix(normalized, input.index, input.totalCount, input.type);
  const placeName = resolvePublicLocationLabel(normalized, {
    points: input.points,
    fallbackLabel: input.fallbackLabel,
    position: hasValidCoordinates(input.lat, input.lng)
      ? { lat: Number(input.lat), lng: Number(input.lng) }
      : null,
  });

  if (!placeName || isCoordinateLikeLabel(placeName) || isGenericRouteLabel(placeName)) {
    return prefix;
  }

  return `${prefix} — ${placeName}`;
}
