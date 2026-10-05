export type ParsedTrackGpx = {
  routePoints: Array<{ lat: number; lng: number }>;
  elevationPoints: Array<{
    distKm: number;
    elev: number;
    grade: number;
    lat: number;
    lng: number;
  }>;
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
};

const EARTH_RADIUS_KM = 6371.0088;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKmBetween(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
) {
  const latitudeDelta = radians(right.lat - left.lat);
  const longitudeDelta = radians(right.lng - left.lng);
  const leftLatitude = radians(left.lat);
  const rightLatitude = radians(right.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

function readAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readElevation(body: string | undefined) {
  if (!body) return null;
  const match = body.match(/<(?:[\w.-]+:)?ele\b[^>]*>\s*([^<]+)\s*<\/(?:[\w.-]+:)?ele\s*>/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseTrackGpxSource(gpxXml: string): ParsedTrackGpx {
  const rawPoints: Array<{ lat: number; lng: number; elev: number | null }> = [];
  const trackPointPattern = /<(?:[\w.-]+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?trkpt\s*>)/gi;

  for (const match of gpxXml.matchAll(trackPointPattern)) {
    const lat = readAttribute(match[1] ?? "", "lat");
    const lng = readAttribute(match[1] ?? "", "lon");
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }
    rawPoints.push({ lat, lng, elev: readElevation(match[2]) });
  }

  if (rawPoints.length < 2) {
    throw new Error("GPX must contain at least two valid route points.");
  }

  let cumulativeDistanceKm = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let hasElevation = false;

  const elevationPoints = rawPoints.map((point, index) => {
    const previous = rawPoints[index - 1];
    const segmentDistanceKm = previous ? distanceKmBetween(previous, point) : 0;
    cumulativeDistanceKm += segmentDistanceKm;

    let grade = 0;
    if (point.elev != null) hasElevation = true;
    if (previous?.elev != null && point.elev != null) {
      const elevationDeltaM = point.elev - previous.elev;
      if (elevationDeltaM > 0) elevationGainM += elevationDeltaM;
      if (elevationDeltaM < 0) elevationLossM += Math.abs(elevationDeltaM);
      if (segmentDistanceKm > 0) grade = (elevationDeltaM / (segmentDistanceKm * 1000)) * 100;
    }

    return {
      distKm: Number(cumulativeDistanceKm.toFixed(5)),
      elev: point.elev ?? previous?.elev ?? 0,
      grade: Number(grade.toFixed(2)),
      lat: point.lat,
      lng: point.lng,
    };
  });

  return {
    routePoints: rawPoints.map(({ lat, lng }) => ({ lat, lng })),
    elevationPoints,
    distanceKm: Number(cumulativeDistanceKm.toFixed(3)),
    elevationGainM: hasElevation ? Math.round(elevationGainM) : null,
    elevationLossM: hasElevation ? Math.round(elevationLossM) : null,
  };
}
