export type ElevationPointLike = {
  distKm: number;
  elev: number;
  lat?: number | null;
  lng?: number | null;
  grade?: number | null;
};

export function sampleElevationPoints<T extends ElevationPointLike>(points: T[], limit = 240) {
  if (points.length <= limit) return points;

  const step = Math.max(1, Math.floor(points.length / limit));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

export function nearestPointByDistance<T extends ElevationPointLike>(points: T[], distanceKm: number) {
  return points.reduce((closest, point) => {
    if (point.lat == null || point.lng == null) return closest;
    if (!closest) return point;
    return Math.abs(point.distKm - distanceKm) < Math.abs(closest.distKm - distanceKm) ? point : closest;
  }, null as T | null);
}

export function nearestPointByCoordinates<T extends ElevationPointLike>(
  points: T[],
  target: { lat: number; lng: number },
) {
  return points.reduce((closest, point) => {
    if (point.lat == null || point.lng == null) return closest;
    if (!closest) return point;

    const currentDistance = Math.hypot(point.lat - target.lat, point.lng - target.lng);
    const closestDistance = Math.hypot((closest.lat ?? 0) - target.lat, (closest.lng ?? 0) - target.lng);

    return currentDistance < closestDistance ? point : closest;
  }, null as T | null);
}
