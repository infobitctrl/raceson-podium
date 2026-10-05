const independentClubLabels = new Set([
  "independent",
  "independant",
  "/",
  "bez",
  "nema",
  "nemam klub",
  "solo",
  "ind",
  "i nd",
  "individualni",
  "individualac",
  "indvidualac",
  "samostalno",
  "samostalan",
]);

export function normalizePublicResultClubName(value: string | null | undefined) {
  const clubName = value?.trim() ?? "";
  return independentClubLabels.has(clubName.toLowerCase()) ? "" : clubName;
}

export function formatPublicResultAverageSpeed(
  distanceKm: number | null | undefined,
  finishTimeMs: number | null | undefined,
) {
  if (!distanceKm || distanceKm <= 0 || !finishTimeMs || finishTimeMs <= 0) return "—";
  const speedKmh = distanceKm / (finishTimeMs / 3_600_000);
  return `${speedKmh.toFixed(1)} km/h`;
}

type PublicWinnerGapRow = {
  finishTimeMs?: number | null;
  gapMs?: number | null;
  participationStatus?: string | null;
  status?: string | null;
  time?: string | null;
};

function isFinishedResult(row: PublicWinnerGapRow) {
  return (row.status ?? row.participationStatus) === "finished";
}

function resultFinishTimeMs(row: PublicWinnerGapRow) {
  if (row.finishTimeMs != null && Number.isFinite(row.finishTimeMs) && row.finishTimeMs > 0) {
    return row.finishTimeMs;
  }

  const timeParts = row.time?.trim().split(":").map(Number) ?? [];
  if (!timeParts.length || timeParts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return timeParts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

export function getPublicResultWinnerTimeMs(rows: readonly PublicWinnerGapRow[]) {
  return rows.reduce<number | null>((winnerTimeMs, row) => {
    if (!isFinishedResult(row)) return winnerTimeMs;
    const finishTimeMs = resultFinishTimeMs(row);
    if (finishTimeMs == null || finishTimeMs <= 0) return winnerTimeMs;

    return winnerTimeMs == null
      ? finishTimeMs
      : Math.min(winnerTimeMs, finishTimeMs);
  }, null);
}

export function formatPublicResultWinnerGap(
  row: PublicWinnerGapRow,
  winnerTimeMs: number | null | undefined,
  winnerLabel: string,
) {
  if (!isFinishedResult(row) || winnerTimeMs == null) return "—";
  const finishTimeMs = resultFinishTimeMs(row);
  if (finishTimeMs == null || finishTimeMs <= 0) return "—";

  const gapMs = row.gapMs != null && Number.isFinite(row.gapMs) && row.gapMs >= 0
    ? row.gapMs
    : Math.max(finishTimeMs - winnerTimeMs, 0);
  if (gapMs === 0) return winnerLabel;

  const totalSeconds = Math.round(gapMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const duration = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;

  return `+${duration}`;
}

export function formatPublicResultPublicationLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "";
  if (normalized === "live") return "Live";
  if (normalized === "provisional" || normalized === "unofficial") return "Unofficial";
  if (normalized === "official" || normalized === "corrected" || normalized === "published") {
    return "Final";
  }
  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export type PublicResultLifecycleState = "live" | "unofficial" | "final" | "pending";

export function resolvePublicResultLifecycleState(
  value: string | null | undefined,
): PublicResultLifecycleState {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "live") return "live";
  if (normalized === "provisional" || normalized === "unofficial") return "unofficial";
  if (["official", "corrected", "published", "final"].includes(normalized)) return "final";
  return "pending";
}
