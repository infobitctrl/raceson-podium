import type { PublicResultSplit, PublicResultsRow } from "@/lib/portal-read-models";

export type ResultTimingColumn = {
  id: string;
  label: string;
  sequenceNumber: number;
  checkpointId: string | null;
  legacyIndex: number | null;
};

export function formatResultCheckpointLocalTime(value: string, timeZone: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(parsed);
  } catch {
    return "—";
  }
}

function isControlPoint(split: PublicResultSplit) {
  return split.checkpointType !== "start" && split.checkpointType !== "finish";
}

function legacyControlPointTimes(row: PublicResultsRow) {
  const times = row.splits;
  const lastTime = times.at(-1);

  return lastTime && lastTime === row.time ? times.slice(0, -1) : times;
}

export function buildResultTimingColumns(rows: PublicResultsRow[]): ResultTimingColumn[] {
  const namedColumns = new Map<string, ResultTimingColumn>();

  for (const row of rows) {
    for (const split of row.splitDetails ?? []) {
      if (!isControlPoint(split)) continue;

      const id = `checkpoint:${split.checkpointId}`;
      if (namedColumns.has(id)) continue;

      namedColumns.set(id, {
        id,
        label: split.checkpointName.trim() || `CP ${split.sequenceNumber}`,
        sequenceNumber: split.sequenceNumber,
        checkpointId: split.checkpointId,
        legacyIndex: null,
      });
    }
  }

  if (namedColumns.size) {
    return Array.from(namedColumns.values()).sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  }

  const legacyColumnCount = rows.reduce(
    (count, row) => Math.max(count, legacyControlPointTimes(row).length),
    0,
  );

  return Array.from({ length: legacyColumnCount }, (_, legacyIndex) => ({
    id: `legacy:${legacyIndex}`,
    label: `CP ${legacyIndex + 1}`,
    sequenceNumber: legacyIndex + 1,
    checkpointId: null,
    legacyIndex,
  }));
}

export function getResultTimingLabel(row: PublicResultsRow, column: ResultTimingColumn) {
  if (column.checkpointId) {
    return row.splitDetails?.find((split) => split.checkpointId === column.checkpointId)?.elapsedLabel ?? "—";
  }

  return column.legacyIndex == null
    ? "—"
    : legacyControlPointTimes(row)[column.legacyIndex] ?? "—";
}

export function getResultTimingSplit(row: PublicResultsRow, column: ResultTimingColumn) {
  if (!column.checkpointId) return null;
  return row.splitDetails?.find((split) => split.checkpointId === column.checkpointId) ?? null;
}

export function getResultFinishSplit(row: PublicResultsRow) {
  return row.splitDetails?.find((split) => split.checkpointType === "finish") ?? null;
}
