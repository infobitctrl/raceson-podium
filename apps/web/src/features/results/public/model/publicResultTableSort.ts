import type { PublicResultsRow } from "@/lib/portal-read-models";
import {
  getResultTimingLabel,
  getResultTimingSplit,
  type ResultTimingColumn,
} from "./resultTimingColumns";

export type PublicResultTableSortKey =
  | "rank"
  | "athlete"
  | "country"
  | "club"
  | "status"
  | "category"
  | "averageSpeed"
  | "finish"
  | `checkpoint:${string}`;

export type PublicResultTableSortDirection = "asc" | "desc";

export type PublicResultTableEntry = {
  row: PublicResultsRow;
  rank: number;
  clubLabel: string;
  categoryLabel: string;
};

const resultTableCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const resultStatusOrder: Record<PublicResultsRow["status"], number> = {
  finished: 0,
  started: 1,
  dnf: 2,
  dns: 3,
  dsq: 4,
};

function elapsedLabelMilliseconds(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^\+/, "") ?? "";
  if (!normalized || normalized === "—" || normalized.toLowerCase() === "tba") return null;

  const units = normalized.split(":").map(Number);
  if (!units.length || units.some((unit) => !Number.isFinite(unit) || unit < 0)) return null;

  const seconds = units.reduce((total, unit) => total * 60 + unit, 0);
  return seconds * 1000;
}

function checkpointElapsedMilliseconds(
  row: PublicResultsRow,
  column: ResultTimingColumn | undefined,
) {
  if (!column) return null;
  const split = getResultTimingSplit(row, column);
  if (split?.elapsedTimeMs != null && split.elapsedTimeMs >= 0) return split.elapsedTimeMs;
  return elapsedLabelMilliseconds(getResultTimingLabel(row, column));
}

function averageSpeedKph(
  distanceKm: number | null | undefined,
  finishTimeMs: number | null | undefined,
) {
  if (!distanceKm || distanceKm <= 0 || !finishTimeMs || finishTimeMs <= 0) return null;
  return distanceKm / (finishTimeMs / 3_600_000);
}

function compareValues(
  left: string | number | null,
  right: string | number | null,
  direction: PublicResultTableSortDirection,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : resultTableCollator.compare(String(left), String(right));
  return direction === "asc" ? comparison : -comparison;
}

export function sortPublicResultTableEntries<TEntry extends PublicResultTableEntry>(
  entries: TEntry[],
  sortKey: PublicResultTableSortKey,
  direction: PublicResultTableSortDirection,
  options: {
    distanceKm: number | null | undefined;
    timingColumns: ResultTimingColumn[];
  },
) {
  const checkpointColumn = sortKey.startsWith("checkpoint:")
    ? options.timingColumns.find((candidate) => candidate.id === sortKey.slice("checkpoint:".length))
    : undefined;
  const sortValue = (entry: PublicResultTableEntry): string | number | null => {
    if (sortKey === "rank") return entry.rank > 0 ? entry.rank : null;
    if (sortKey === "athlete") return entry.row.name;
    if (sortKey === "country") return entry.row.countryCode?.trim().toUpperCase() || null;
    if (sortKey === "club") return entry.clubLabel || null;
    if (sortKey === "status") return resultStatusOrder[entry.row.status];
    if (sortKey === "category") return entry.categoryLabel || null;
    if (sortKey === "averageSpeed") return averageSpeedKph(options.distanceKm, entry.row.finishTimeMs);
    if (sortKey === "finish") {
      return entry.row.finishTimeMs ?? elapsedLabelMilliseconds(entry.row.time);
    }

    return checkpointElapsedMilliseconds(entry.row, checkpointColumn);
  };

  return [...entries].sort((left, right) => {
    const primary = compareValues(sortValue(left), sortValue(right), direction);
    if (primary !== 0) return primary;

    const rankComparison = compareValues(
      left.rank > 0 ? left.rank : null,
      right.rank > 0 ? right.rank : null,
      "asc",
    );
    if (rankComparison !== 0) return rankComparison;
    return resultTableCollator.compare(left.row.name, right.row.name);
  });
}
