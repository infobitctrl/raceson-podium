export const DISTANCE_STAT_BANDS = [
  { id: "short", name: "Short", rangeLabel: "5–10 km", minKm: 5, maxKm: 10 },
  { id: "medium", name: "Medium", rangeLabel: "10–20 km", minKm: 10, maxKm: 20 },
  { id: "long", name: "Long", rangeLabel: "20–30 km", minKm: 20, maxKm: 30 },
  { id: "extra-long", name: "Extra long", rangeLabel: "30–40 km", minKm: 30, maxKm: 40 },
  { id: "marathon", name: "Marathon", rangeLabel: "40–50 km", minKm: 40, maxKm: 50 },
  { id: "ultra-marathon", name: "Ultra marathon", rangeLabel: "50+ km", minKm: 50, maxKm: null },
] as const;

export type DistanceStatBand = (typeof DISTANCE_STAT_BANDS)[number];
export type DistanceStatBandId = DistanceStatBand["id"];

export const BELOW_DISTANCE_STAT_MINIMUM_LABEL = "Below 5 km · unclassified";
export const UNKNOWN_DISTANCE_STAT_LABEL = "Distance not published";

export const DISTANCE_STAT_FILTER_LABELS = [
  "All",
  ...DISTANCE_STAT_BANDS.map((band) => `${band.name} · ${band.rangeLabel}`),
  BELOW_DISTANCE_STAT_MINIMUM_LABEL,
] as const;

export function getDistanceStatBand(distanceKm: number | null | undefined): DistanceStatBand | null {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm < 5) return null;
  return DISTANCE_STAT_BANDS.find((band) => (
    distanceKm >= band.minKm
    && (band.maxKm === null || distanceKm < band.maxKm)
  )) ?? null;
}

export function getDistanceStatLabel(distanceKm: number | null | undefined) {
  const band = getDistanceStatBand(distanceKm);
  if (band) return `${band.name} · ${band.rangeLabel}`;
  if (typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm >= 0 && distanceKm < 5) {
    return BELOW_DISTANCE_STAT_MINIMUM_LABEL;
  }
  return UNKNOWN_DISTANCE_STAT_LABEL;
}

export function summarizeDistanceStatBands(values: Iterable<number | null | undefined>) {
  const counts = new Map<DistanceStatBandId, number>(DISTANCE_STAT_BANDS.map((band) => [band.id, 0]));
  let belowMinimum = 0;
  let unknown = 0;

  for (const value of values) {
    const band = getDistanceStatBand(value);
    if (band) {
      counts.set(band.id, (counts.get(band.id) ?? 0) + 1);
    } else if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 5) {
      belowMinimum += 1;
    } else {
      unknown += 1;
    }
  }

  return {
    bands: DISTANCE_STAT_BANDS.map((band) => ({
      ...band,
      count: counts.get(band.id) ?? 0,
    })),
    belowMinimum,
    unknown,
  };
}
