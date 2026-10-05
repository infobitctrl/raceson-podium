import {
  nearestPointByDistance,
  type ElevationPointLike,
} from "@/lib/elevation-point-utils";

type TrackCheckpointLike = {
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type?: string | null;
};

export type CoursePointGeometry = {
  distKm: number;
  elev: number;
  lat: number;
  lng: number;
};

export function resolveCoursePointGeometry({
  distanceKm,
  checkpointType,
  routePoints,
  trackCheckpoints = [],
}: {
  distanceKm: number | null;
  checkpointType?: string | null;
  routePoints: ElevationPointLike[];
  trackCheckpoints?: TrackCheckpointLike[];
}): CoursePointGeometry | null {
  const fixedType = checkpointType === "start" || checkpointType === "finish"
    ? checkpointType
    : null;
  const fixedCheckpoint = fixedType
    ? trackCheckpoints.find((checkpoint) => checkpoint.type === fixedType) ?? null
    : null;
  const routePoint = distanceKm != null
    ? nearestPointByDistance(routePoints, distanceKm)
    : null;
  const fallbackTrackCheckpoint = distanceKm != null
    ? trackCheckpoints.reduce((closest, checkpoint) => {
        if (!closest) return checkpoint;
        return Math.abs(checkpoint.km - distanceKm) < Math.abs(closest.km - distanceKm)
          ? checkpoint
          : closest;
      }, null as TrackCheckpointLike | null)
    : null;
  const geometry = fixedCheckpoint ?? routePoint ?? fallbackTrackCheckpoint;

  if (!geometry || geometry.lat == null || geometry.lng == null) return null;

  return {
    distKm: distanceKm ?? ("distKm" in geometry ? geometry.distKm : geometry.km),
    elev: geometry.elev,
    lat: geometry.lat,
    lng: geometry.lng,
  };
}
