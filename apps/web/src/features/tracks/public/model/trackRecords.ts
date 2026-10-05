export type TrackRecordGender = "F" | "M" | null;

export type TrackRecordSourceKind = "race" | "strava" | "manual";

export type TrackRecordCandidate = {
  id: string;
  athleteProfileId: string;
  athleteSlug: string | null;
  name: string;
  elapsedTimeMs: number;
  occurredAt: string | null;
  gender: TrackRecordGender;
  sourceKind: TrackRecordSourceKind;
  sourceLabel: string;
  sourceHref: string | null;
};

export type PublishedRaceResultState = {
  finishTimeMs: number | null;
  participationStatus: string | null;
  resultStatus: string | null;
  publicationState: string | null;
};

const publishedRaceStartStatuses = new Set(["started", "finished", "dnf", "dsq"]);

type TrackRecordOccurredAtInput = {
  sourceKind: TrackRecordSourceKind;
  eventStartedAt?: string | null;
  activityStartedAt?: string | null;
};

const sourcePriority: Record<TrackRecordSourceKind, number> = {
  race: 0,
  strava: 1,
  manual: 2,
};

function performanceDate(value: string | null) {
  if (!value) return "unknown-date";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function performanceKey(candidate: TrackRecordCandidate) {
  const athleteKey = candidate.athleteProfileId || candidate.athleteSlug || candidate.name.trim().toLocaleLowerCase();
  return `${athleteKey}:${candidate.elapsedTimeMs}:${performanceDate(candidate.occurredAt)}`;
}

export function isPublishedRaceTrackResult(result: PublishedRaceResultState) {
  return (
    result.finishTimeMs != null
    && Number.isFinite(result.finishTimeMs)
    && result.finishTimeMs > 0
    && result.participationStatus === "finished"
    && (result.resultStatus === "official" || result.resultStatus === "corrected")
    && (result.publicationState === "official" || result.publicationState === "corrected")
  );
}

export function isPublishedRaceTrackStart(result: PublishedRaceResultState) {
  return (
    publishedRaceStartStatuses.has(result.participationStatus ?? "")
    && (result.resultStatus === "official" || result.resultStatus === "corrected")
    && (result.publicationState === "official" || result.publicationState === "corrected")
  );
}

export function resolveTrackRecordOccurredAt({
  sourceKind,
  eventStartedAt,
  activityStartedAt,
}: TrackRecordOccurredAtInput) {
  return sourceKind === "race" ? eventStartedAt ?? null : activityStartedAt ?? null;
}

export function formatTrackRecordDuration(elapsedTimeMs: number) {
  if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs <= 0) return "TBA";

  const totalSeconds = Math.round(elapsedTimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function mergeTrackRecordCandidates(
  candidates: TrackRecordCandidate[],
  limit = 100,
) {
  const uniquePerformances = new Map<string, TrackRecordCandidate>();

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.elapsedTimeMs) || candidate.elapsedTimeMs <= 0) continue;

    const key = performanceKey(candidate);
    const existing = uniquePerformances.get(key);
    if (!existing || sourcePriority[candidate.sourceKind] < sourcePriority[existing.sourceKind]) {
      uniquePerformances.set(key, candidate);
    }
  }

  return Array.from(uniquePerformances.values())
    .sort((left, right) => {
      if (left.elapsedTimeMs !== right.elapsedTimeMs) return left.elapsedTimeMs - right.elapsedTimeMs;
      const sourceDifference = sourcePriority[left.sourceKind] - sourcePriority[right.sourceKind];
      if (sourceDifference !== 0) return sourceDifference;
      return left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, limit));
}
