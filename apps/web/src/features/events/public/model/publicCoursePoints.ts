type PublicTrackPoint = {
  name: string;
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type?: string;
};

type PublicRacePoint = {
  name: string;
  km: number | null;
  elev: number | null;
  lat: number | null;
  lng: number | null;
  type: string;
  typeTags: string[];
};

function normalizedPointType(point: Pick<PublicTrackPoint, "type">) {
  return point.type?.trim().toLowerCase() ?? "";
}

function pointsRepresentSamePlace(left: PublicTrackPoint, right: PublicTrackPoint) {
  const leftType = normalizedPointType(left);
  const rightType = normalizedPointType(right);
  if ((leftType === "start" || leftType === "finish") && leftType === rightType) return true;

  return left.name.trim().toLowerCase() === right.name.trim().toLowerCase()
    && Math.abs(left.km - right.km) < 0.01;
}

export function mergePublicCoursePoints(
  trackPoints: PublicTrackPoint[],
  racePoints: PublicRacePoint[],
): PublicTrackPoint[] {
  const mappedRacePoints = racePoints.flatMap((point) => {
    if (point.km == null || point.elev == null || point.lat == null || point.lng == null) return [];

    return [{
      name: point.name,
      km: point.km,
      elev: point.elev,
      lat: point.lat,
      lng: point.lng,
      type: point.typeTags[0] ?? point.type,
    } satisfies PublicTrackPoint];
  });
  const unmatchedTrackPoints = trackPoints.filter((trackPoint) => (
    !mappedRacePoints.some((racePoint) => pointsRepresentSamePlace(trackPoint, racePoint))
  ));

  return [...mappedRacePoints, ...unmatchedTrackPoints]
    .sort((left, right) => left.km - right.km);
}
