import { type OrganizerCategoryResults } from "@/lib/organizer-management";

const UNMATCHED_TIMING_CODES = new Set([
  "unresolved_timing_event",
]);

const REVIEW_PARTICIPATION_STATUSES = new Set([
  "not_started",
  "checked_in",
  "dns",
  "started",
  "dnf",
  "dsq",
  "withdrawn",
  "stopped",
  "evacuated",
  "missing",
]);

const OFFICIAL_PUBLICATION_BLOCKING_STATUSES = new Set([
  "not_started",
  "checked_in",
  "started",
  "missing",
]);

export type UnfinishedResultParticipant = {
  registrationId: string;
  bibNumber: string | null;
  athleteName: string;
  participationStatus: string;
};

export function formatParticipationStatus(status: string | null | undefined) {
  if (!status) return "Awaiting result";
  if (status === "dnf") return "DNF";
  if (status === "dns") return "DNS";
  if (status === "dsq") return "DSQ";
  return status.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export function participationStatusNeedsReview(status: string | null | undefined) {
  return status ? REVIEW_PARTICIPATION_STATUSES.has(status) : false;
}

export function selectAcknowledgeableResultAnomalies(
  anomalies: OrganizerCategoryResults["anomalies"],
) {
  return anomalies.filter((anomaly) => (
    anomaly.state === "open" && !UNMATCHED_TIMING_CODES.has(anomaly.code)
  ));
}

export function selectUnfinishedResultParticipants(
  rows: OrganizerCategoryResults["rows"],
): UnfinishedResultParticipant[] {
  return rows
    .filter((row) => (
      row.participationStatus
      && OFFICIAL_PUBLICATION_BLOCKING_STATUSES.has(row.participationStatus)
    ))
    .map((row) => ({
      registrationId: row.registrationId,
      bibNumber: row.bibNumber,
      athleteName: row.athleteName,
      participationStatus: row.participationStatus ?? "not_started",
    }))
    .sort((left, right) => {
      const leftBib = Number.parseInt(left.bibNumber ?? "", 10);
      const rightBib = Number.parseInt(right.bibNumber ?? "", 10);
      if (Number.isFinite(leftBib) && Number.isFinite(rightBib) && leftBib !== rightBib) {
        return leftBib - rightBib;
      }
      return left.athleteName.localeCompare(right.athleteName);
    });
}

export function buildResultReviewSummary(input: {
  snapshot: OrganizerCategoryResults | undefined;
  unresolvedTimingCount: number;
  openComplaintCount: number;
}) {
  const anomalies = input.snapshot?.anomalies ?? [];
  const acknowledgeableAnomalies = selectAcknowledgeableResultAnomalies(anomalies);
  const acknowledgedCount = anomalies.filter((anomaly) => anomaly.state !== "open").length;
  const openBlockingAnomalyCount = anomalies.filter((anomaly) => (
    anomaly.state === "open"
    && (anomaly.severity === "error" || anomaly.severity === "critical")
  )).length;
  const resultRows = input.snapshot?.rows ?? [];
  const finisherCount = resultRows.filter((row) => row.finishTimeMs != null).length;
  const unfinishedParticipants = selectUnfinishedResultParticipants(resultRows);

  return {
    totalCount: input.snapshot?.rows.length ?? 0,
    finisherCount,
    openReviewFlagCount: acknowledgeableAnomalies.length,
    acknowledgedCount,
    acknowledgeableAnomalies,
    unfinishedParticipants,
    unfinishedParticipantCount: unfinishedParticipants.length,
    openBlockingAnomalyCount,
    unresolvedTimingCount: input.unresolvedTimingCount,
    openComplaintCount: input.openComplaintCount,
    publicationBlocked: Boolean(
      input.unresolvedTimingCount
      || input.openComplaintCount
      || unfinishedParticipants.length
      || openBlockingAnomalyCount
    ),
  };
}
