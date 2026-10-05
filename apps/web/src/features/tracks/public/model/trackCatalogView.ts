export type PublicTracksViewMode = "list" | "grid" | "map";

export const DEFAULT_PUBLIC_TRACKS_VIEW: PublicTracksViewMode = "list";

export const PUBLIC_TRACKS_VIEW_ORDER: readonly PublicTracksViewMode[] = [
  "list",
  "grid",
  "map",
];

export type TrackCatalogCoordinates = {
  lat: number;
  lng: number;
};

function parseCoordinate(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

export function resolveTrackCatalogCoordinates({
  startLat,
  startLng,
  seeded,
  fallback,
}: {
  startLat: unknown;
  startLng: unknown;
  seeded?: TrackCatalogCoordinates;
  fallback: TrackCatalogCoordinates;
}): TrackCatalogCoordinates {
  const lat = parseCoordinate(startLat);
  const lng = parseCoordinate(startLng);

  if (
    Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
  ) {
    return { lat, lng };
  }

  return seeded ?? fallback;
}
