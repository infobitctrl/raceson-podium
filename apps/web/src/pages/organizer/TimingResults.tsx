import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Square,
  Trophy,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import TimingEntryAlerts, {
  type TimingEntryAlert,
} from "@/components/organizer/TimingEntryAlerts";
import { resolveOrganizerEventWorkflowProgress } from "@/components/organizer/organizerEventWorkflowProgress";
import ScrollReveal, { StaggerContainer, StaggerItem } from "@/components/shared/ScrollReveal";
import { CountryFlag, CountryWithFlag } from "@/components/shared/CountryFlag";
import { getEventResultsProgress } from "@/features/events/model/eventResultsLifecycle";
import RaceDayPhaseNav from "@/features/race-day/components/RaceDayPhaseNav";
import ResultCorrectionDialog from "@/features/race-day/components/ResultCorrectionDialog";
import RegistrationPhaseNav from "@/features/registrations/organizer/components/RegistrationPhaseNav";
import { selectFieldOperationsEvents } from "@/features/race-day/model/fieldOperationsEvents";
import { RaceFinishOverrideButton } from "@/features/race-day/components/RaceFinishOverrideButton";
import { eventLiveOperationsAreClosed } from "@/features/race-day/model/liveOperationsLifecycle";
import {
  TemporaryResultsReviewActions,
  TemporaryResultsReviewWorkflow,
} from "@/features/results/organizer/components/TemporaryResultsReviewWorkflow";
import {
  OrganizerClubResultsBoard,
  OrganizerResultBoardTabs,
  type OrganizerResultBoardView,
} from "@/features/results/organizer/components/OrganizerResultBoardTabs";
import ResultAnomalyReview from "@/features/results/organizer/components/ResultAnomalyReview";
import { ImportedResultsNotice } from "@/features/results/organizer/components/ImportedResultsNotice";
import {
  buildResultReviewSummary,
  formatParticipationStatus,
  participationStatusNeedsReview,
} from "@/features/results/organizer/model/resultReview";
import { selectUnresolvedPunchCandidates } from "@/features/results/organizer/model/unresolvedPunchReconciliation";
import {
  formatPublicResultWinnerGap,
  getPublicResultWinnerTimeMs,
  normalizePublicResultClubName,
} from "@/features/results/public/model/publicResultPresentation";
import { hasEventPermission } from "@/lib/auth";
import { useOrganizerAuth } from "@/lib/organizer-workspace";
import { ApiError } from "@/lib/api";
import { useOrganizerEventWorkspaceUnlocked } from "@/shared/organizer/useEventWorkspaceUnlock";
import { useI18n } from "@/shared/i18n/I18nContext";
import {
  enqueueOfflinePunch,
  isSharedQueuedPunch,
  listOfflinePunches,
  shouldSavePunchOnDevice,
  syncOfflinePunches,
  type DirectQueuedPunchPayload,
} from "@/lib/offline-punch-queue";
import {
  closeOrganizerTimingSession,
  createOrganizerResultComplaint,
  createOrganizerTimingSession,
  getOrganizerCategoryResults,
  getOrganizerEvents,
  getOrganizerRaceDayState,
  getOrganizerRegistrations,
  publishOrganizerCategoryResults,
  recordOrganizerPunch,
  recordOrganizerSharedPunch,
  recomputeOrganizerCategoryResults,
  resolveOrganizerResultComplaint,
  type OrganizerCategoryResults,
} from "@/lib/organizer-management";
import {
  resolveResultAnomaly,
  revisePunchEvent,
} from "@/lib/race-control";

const tabs = ["Control points", "Temporary results", "Official results"] as const;

type ResultSortKey =
  | "rank"
  | "bib"
  | "athlete"
  | "country"
  | "club"
  | "gender"
  | "category"
  | "totalTime"
  | "averageSpeed"
  | "status"
  | `checkpoint:${string}`;

type ResultSortDirection = "asc" | "desc";
type ResultsPublicationState = "provisional" | "official" | "corrected";

const resultCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function formatPublicationStateLabel(value: ResultsPublicationState) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatElapsed(milliseconds: number | null | undefined) {
  if (milliseconds == null || milliseconds < 0) return "TBA";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function averageSpeedKph(distanceKm: number | null | undefined, finishTimeMs: number | null | undefined) {
  if (distanceKm == null || distanceKm <= 0 || finishTimeMs == null || finishTimeMs <= 0) return null;
  return distanceKm / (finishTimeMs / 3_600_000);
}

function formatAverageSpeed(distanceKm: number | null | undefined, finishTimeMs: number | null | undefined) {
  const speed = averageSpeedKph(distanceKm, finishTimeMs);
  return speed == null ? "—" : `${speed.toFixed(2)} km/h`;
}

function maximumPlausibleAverageSpeedKph(sportCode: string | null | undefined) {
  if (sportCode === "swimming") return 10;
  if (sportCode === "road_running") return 35;
  if (sportCode === "mountain_biking") return 90;
  if (sportCode === "road_cycling") return 130;
  if (sportCode === "duathlon" || sportCode === "triathlon" || sportCode === "aquathlon") return 80;
  return 30;
}

function implausibleSpeedMessage(
  sportCode: string | null | undefined,
  distanceKm: number | null | undefined,
  finishTimeMs: number | null | undefined,
) {
  const speed = averageSpeedKph(distanceKm, finishTimeMs);
  if (speed == null || speed <= maximumPlausibleAverageSpeedKph(sportCode)) return null;
  return `Average speed ${speed.toFixed(2)} km/h is not plausible. Check the race start, finish time, and distance.`;
}

function unpersistedImplausibleSpeedMessage(
  anomalies: OrganizerCategoryResults["anomalies"],
  sportCode: string | null | undefined,
  distanceKm: number | null | undefined,
  finishTimeMs: number | null | undefined,
) {
  if (anomalies.some((anomaly) => anomaly.code === "implausible_average_speed")) return null;
  return implausibleSpeedMessage(sportCode, distanceKm, finishTimeMs);
}

function effectiveParticipationStatus(row: OrganizerCategoryResults["rows"][number]) {
  return row.participationStatus ?? (row.finishTimeMs != null ? "finished" : "not_started");
}

function formatRecordedTime(value: unknown) {
  if (typeof value !== "string") return "Recorded time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recorded time unavailable"
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type ResultAnomaly = OrganizerCategoryResults["anomalies"][number];
type ResultSplit = OrganizerCategoryResults["rows"][number]["splits"][number];

function formatRelativeCheckpointTime(milliseconds: number | null | undefined) {
  return milliseconds == null || milliseconds < 0 ? "—" : `+${formatElapsed(milliseconds)}`;
}

function LocalRelativeTimePair({
  recordedAt,
  elapsedTimeMs,
  localClassName = "text-foreground",
}: {
  recordedAt: string | null;
  elapsedTimeMs: number | null | undefined;
  localClassName?: string;
}) {
  return (
    <span className="block whitespace-nowrap">
      {recordedAt ? (
        <time className={`block font-bold ${localClassName}`} dateTime={recordedAt}>
          {formatRecordedTime(recordedAt)}
        </time>
      ) : (
        <span className={`block font-bold ${localClassName}`}>—</span>
      )}
      <span className="mt-0.5 block text-[10px] font-semibold text-muted-foreground">
        {formatRelativeCheckpointTime(elapsedTimeMs)} relative
      </span>
    </span>
  );
}

function CheckpointTimePair({
  split,
  massGunStartAt,
  isStart,
}: {
  split: ResultSplit | undefined;
  massGunStartAt: string | null;
  isStart: boolean;
}) {
  const recordedAt = split?.recordedAt ?? (isStart ? massGunStartAt : null);
  const elapsedTimeMs = split?.elapsedTimeMs ?? (isStart && recordedAt ? 0 : null);
  return <LocalRelativeTimePair recordedAt={recordedAt} elapsedTimeMs={elapsedTimeMs} />;
}

type DuplicateObservation = {
  punchEventId: string;
  effectiveRecordedAt: string;
  usedForResult: boolean;
};

function duplicateObservations(anomaly: ResultAnomaly): DuplicateObservation[] {
  if (anomaly.code !== "duplicate_checkpoint_observation") return [];
  const observations = anomaly.evidence.observations;
  if (!Array.isArray(observations)) return [];
  return observations.flatMap((observation) => {
    if (!observation || typeof observation !== "object") return [];
    const candidate = observation as Record<string, unknown>;
    if (typeof candidate.punchEventId !== "string" || typeof candidate.effectiveRecordedAt !== "string") return [];
    return [{
      punchEventId: candidate.punchEventId,
      effectiveRecordedAt: candidate.effectiveRecordedAt,
      usedForResult: candidate.usedForResult === true,
    }];
  });
}

function duplicateCheckpointId(anomaly: ResultAnomaly) {
  return typeof anomaly.evidence.checkpointId === "string" ? anomaly.evidence.checkpointId : null;
}

function DuplicateObservationTimes({ anomaly }: { anomaly: ResultAnomaly }) {
  const observations = duplicateObservations(anomaly);
  if (!observations.length) {
    return <p className="text-xs">Exact entry times are unavailable until results are refreshed.</p>;
  }
  return (
    <ol className="space-y-1.5" aria-label="Duplicate timing entries">
      {observations.map((observation, index) => (
        <li key={observation.punchEventId} className="flex items-center justify-between gap-3 rounded-md bg-background/80 px-2 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide">
            {observation.usedForResult ? "Used for result" : `Extra entry ${index}`}
          </span>
          <time className="font-mono text-xs font-bold" dateTime={observation.effectiveRecordedAt}>
            {formatRecordedTime(observation.effectiveRecordedAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function compareSortValues(
  left: string | number | null,
  right: string | number | null,
  direction: ResultSortDirection,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : resultCollator.compare(String(left), String(right));
  return direction === "asc" ? comparison : -comparison;
}

function SortableResultHeader({
  activeDirection,
  children,
  className = "",
  onSort,
  sortLabel,
}: {
  activeDirection: ResultSortDirection | null;
  children: React.ReactNode;
  className?: string;
  onSort: () => void;
  sortLabel: string;
}) {
  const SortIcon = activeDirection === "asc"
    ? ChevronUp
    : activeDirection === "desc"
      ? ChevronDown
      : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={activeDirection === "asc" ? "ascending" : activeDirection === "desc" ? "descending" : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={`Sort by ${sortLabel}`}
        className="group flex w-full items-center gap-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span>{children}</span>
        <SortIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      </button>
    </th>
  );
}

function ResultFieldEditButton({
  fieldLabel,
  athleteName,
  onEdit,
  children,
  align = "left",
}: {
  fieldLabel: string;
  athleteName: string;
  onEdit?: () => void;
  children: ReactNode;
  align?: "left" | "center";
}) {
  if (!onEdit) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${fieldLabel} for ${athleteName}`}
      className={`group flex min-h-9 w-full items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        align === "center" ? "justify-center text-center" : "justify-between text-left"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Pencil className="h-3 w-3 shrink-0 text-primary opacity-35 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
    </button>
  );
}

function ResultsEntriesTable({
  snapshot,
  label,
  onCorrect,
  emptyMessage = "Results will appear after the race start is recorded.",
}: {
  snapshot: OrganizerCategoryResults | undefined;
  label: string;
  onCorrect?: (row: OrganizerCategoryResults["rows"][number]) => void;
  emptyMessage?: string;
}) {
  const allCheckpoints = useMemo(() => snapshot?.checkpoints ?? [], [snapshot?.checkpoints]);
  const rows = useMemo(() => snapshot?.rows ?? [], [snapshot?.rows]);
  const winnerTimeMs = useMemo(
    () => getPublicResultWinnerTimeMs(rows.map((row) => ({
      finishTimeMs: row.finishTimeMs,
      participationStatus: effectiveParticipationStatus(row),
    }))),
    [rows],
  );
  const winnerGapLabelForRow = useCallback((row: OrganizerCategoryResults["rows"][number]) => (
    formatPublicResultWinnerGap(
      { ...row, participationStatus: effectiveParticipationStatus(row) },
      winnerTimeMs,
      "Winner",
    )
  ), [winnerTimeMs]);
  const usesMassGunStart = snapshot?.selectedRun?.summary.raceStartMethod === "mass_gun";
  const massGunStartAt = usesMassGunStart && typeof snapshot?.selectedRun?.summary.effectiveStartAt === "string"
    ? snapshot.selectedRun.summary.effectiveStartAt
    : null;
  const hasCheckpointTimingEvidence = rows.some((row) => row.splits.length > 0) || Boolean(massGunStartAt);
  const checkpoints = useMemo(
    () => hasCheckpointTimingEvidence ? allCheckpoints : [],
    [allCheckpoints, hasCheckpointTimingEvidence],
  );
  const importedCheckpointTimingUnavailable = Boolean(
    rows.length && allCheckpoints.length && !hasCheckpointTimingEvidence,
  );
  const checkpointById = useMemo(
    () => new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])),
    [checkpoints],
  );
  const distanceKm = (snapshot?.category as { distanceKm?: number | null } | undefined)?.distanceKm ?? null;
  const sportCode = snapshot?.category.sportCode ?? "trail_running";
  const categoryName = snapshot?.category.name.trim() ?? "";
  const [sortKey, setSortKey] = useState<ResultSortKey>("totalTime");
  const [sortDirection, setSortDirection] = useState<ResultSortDirection>("asc");
  const [mobileFilter, setMobileFilter] = useState<"all" | "issues" | "dnf" | "clear">("all");
  const [expandedMobileRowId, setExpandedMobileRowId] = useState<string | null>(null);
  const anomaliesByRegistrationId = useMemo(() => {
    const grouped = new Map<string, OrganizerCategoryResults["anomalies"]>();
    for (const anomaly of snapshot?.anomalies ?? []) {
      if (!anomaly.registrationId) continue;
      const current = grouped.get(anomaly.registrationId) ?? [];
      current.push(anomaly);
      grouped.set(anomaly.registrationId, current);
    }
    return grouped;
  }, [snapshot?.anomalies]);
  const unmatchedAnomalies = useMemo(
    () => (snapshot?.anomalies ?? []).filter((anomaly) => (
      !anomaly.registrationId && anomaly.state === "open"
    )),
    [snapshot?.anomalies],
  );
  const handleSort = useCallback((nextSortKey: ResultSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }, [sortKey]);
  const sortedRows = useMemo(() => {
    const sortValue = (row: OrganizerCategoryResults["rows"][number]): string | number | null => {
      if (sortKey === "rank") return row.rankOverall;
      if (sortKey === "bib") return row.bibNumber;
      if (sortKey === "athlete") return row.athleteName;
      if (sortKey === "country") return row.countryCode?.trim().toUpperCase() || null;
      if (sortKey === "club") return normalizePublicResultClubName(row.clubName);
      if (sortKey === "gender") {
        return (row as { gender?: string | null }).gender ?? null;
      }
      if (sortKey === "category") return categoryName;
      if (sortKey === "totalTime") return row.finishTimeMs;
      if (sortKey === "averageSpeed") return averageSpeedKph(distanceKm, row.finishTimeMs);
      if (sortKey === "status") {
        let openIssueCount = (anomaliesByRegistrationId.get(row.registrationId) ?? [])
          .filter((anomaly) => anomaly.state === "open").length;
        if (unpersistedImplausibleSpeedMessage(
          anomaliesByRegistrationId.get(row.registrationId) ?? [],
          sportCode,
          distanceKm,
          row.finishTimeMs,
        )) {
          openIssueCount += 1;
        }
        return `${openIssueCount ? "0" : "1"}:${row.resultStatus}`;
      }
      const checkpointId = sortKey.slice("checkpoint:".length);
      const recordedAt = row.splits.find((split) => split.checkpointId === checkpointId)?.recordedAt;
      if (!recordedAt) return null;
      const timestamp = new Date(recordedAt).getTime();
      return Number.isNaN(timestamp) ? null : timestamp;
    };

    return [...rows].sort((left, right) => {
      const primary = compareSortValues(sortValue(left), sortValue(right), sortDirection);
      if (primary !== 0) return primary;
      return resultCollator.compare(left.athleteName, right.athleteName);
    });
  }, [anomaliesByRegistrationId, categoryName, distanceKm, rows, sortDirection, sortKey, sportCode]);
  const rowNeedsReview = useCallback((row: OrganizerCategoryResults["rows"][number]) => {
    const rowAnomalies = anomaliesByRegistrationId.get(row.registrationId) ?? [];
    const hasOpenAnomaly = rowAnomalies.some((anomaly) => anomaly.state === "open");
    const hasImplausibleSpeed = Boolean(
      unpersistedImplausibleSpeedMessage(rowAnomalies, sportCode, distanceKm, row.finishTimeMs),
    );
    const hasParticipationReviewAnomaly = rowAnomalies.some((anomaly) => (
      anomaly.code === "participant_non_finisher_status"
      || anomaly.code === "participant_unresolved_before_publication"
      || anomaly.code === "participant_unresolved_in_field"
      || anomaly.code === "participant_missing"
    ));
    return hasOpenAnomaly || hasImplausibleSpeed || (
      participationStatusNeedsReview(effectiveParticipationStatus(row))
      && !hasParticipationReviewAnomaly
    );
  }, [anomaliesByRegistrationId, distanceKm, sportCode]);
  const mobileRows = useMemo(() => sortedRows.filter((row) => {
    const participationStatus = effectiveParticipationStatus(row);
    const hasIssue = rowNeedsReview(row);
    if (mobileFilter === "issues") return hasIssue;
    if (mobileFilter === "dnf") return participationStatus === "dnf";
    if (mobileFilter === "clear") return !hasIssue;
    return true;
  }), [mobileFilter, rowNeedsReview, sortedRows]);
  const activeDirection = (key: ResultSortKey) => sortKey === key ? sortDirection : null;

  return (
    <div className="space-y-3">
      {importedCheckpointTimingUnavailable ? (
        <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 text-xs text-muted-foreground">
          Historical checkpoint timestamps were not available in the imported result source. Official finish times are shown below.
        </div>
      ) : null}
      {onCorrect ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 dark:border-accent/30 dark:bg-accent/[0.06] sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-xs font-bold text-foreground">Table edit mode enabled</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Open any row to assess every field and change all checkpoint times or participant status together.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:text-accent">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> All rows accessible
          </span>
        </div>
      ) : null}
      <div className="space-y-2 md:hidden">
        <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card" aria-label="Result filters">
          {(["all", "issues", "dnf", "clear"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setMobileFilter(filter)}
              aria-pressed={mobileFilter === filter}
              className={`min-h-11 border-r border-border px-2 text-[10px] font-bold uppercase tracking-wide last:border-r-0 ${
                mobileFilter === filter ? "bg-primary/[0.06] text-primary" : "text-muted-foreground"
              }`}
            >
              {filter === "dnf" ? "DNF" : formatParticipationStatus(filter)}
            </button>
          ))}
        </div>

        <div className="space-y-2" role="list" aria-label={`${label} compact view`}>
        {mobileFilter !== "dnf" && mobileFilter !== "clear" ? unmatchedAnomalies.map((anomaly) => {
          const bibNumber = String(anomaly.evidence.bibNumber ?? "unknown");
          const checkpoint = typeof anomaly.evidence.checkpointId === "string"
            ? checkpointById.get(anomaly.evidence.checkpointId)
            : null;
          return (
            <article
              key={anomaly.id}
              role="listitem"
              className="rounded-2xl border border-destructive/30 bg-destructive/[0.07] p-4 text-destructive shadow-soft"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">Unmatched bib {bibNumber}</p>
                      <p className="mt-0.5 text-xs">{checkpoint?.name ?? "Timing point"}</p>
                    </div>
                    <span className="font-mono text-sm font-bold">{formatRecordedTime(anomaly.evidence.effectiveRecordedAt)}</span>
                  </div>
                  <p className="mt-2 border-t border-destructive/20 pt-2 text-xs">{anomaly.message}</p>
                </div>
              </div>
            </article>
          );
        }) : null}
        {mobileRows.length ? mobileRows.map((row) => {
          const rowAnomalies = anomaliesByRegistrationId.get(row.registrationId) ?? [];
          const speedIssue = unpersistedImplausibleSpeedMessage(
            rowAnomalies,
            sportCode,
            distanceKm,
            row.finishTimeMs,
          );
          const openIssueCount = rowAnomalies.filter((anomaly) => anomaly.state === "open").length
            + (speedIssue ? 1 : 0);
          const duplicateIssues = rowAnomalies.filter((anomaly) => (
            anomaly.state === "open" && anomaly.code === "duplicate_checkpoint_observation"
          ));
          const needsReview = rowNeedsReview(row);
          const participationStatus = effectiveParticipationStatus(row);
          const winnerGapLabel = winnerGapLabelForRow(row);
          const expanded = expandedMobileRowId === row.id;
          return (
            <article
              key={row.id}
              role="listitem"
              className={`overflow-hidden rounded-2xl border p-4 shadow-soft ${
                needsReview
                  ? "border-destructive/30 bg-destructive/[0.07] text-destructive"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 font-display text-sm font-bold ${
                  needsReview ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                }`}>
                  {row.rankOverall ?? "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                        <CountryFlag countryCode={row.countryCode} className="text-sm" />
                        <span className="truncate">{row.athleteName}</span>
                      </p>
                      <p className={`mt-0.5 text-xs ${needsReview ? "text-destructive/80" : "text-muted-foreground"}`}>
                        Bib {row.bibNumber ?? "–"}{categoryName ? ` · ${categoryName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-mono text-base font-bold ${needsReview ? "text-destructive" : "text-primary"}`}>
                        {row.finishTimeMs == null ? "—" : formatElapsed(row.finishTimeMs)}
                      </p>
                      {winnerGapLabel !== "—" ? (
                        <p className={`mt-0.5 font-mono text-[10px] font-semibold ${needsReview ? "text-destructive" : "text-muted-foreground"}`}>
                          {winnerGapLabel}
                        </p>
                      ) : null}
                      <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${needsReview ? "text-destructive" : "text-muted-foreground"}`}>
                        {participationStatus === "finished" ? row.resultStatus : formatParticipationStatus(participationStatus)}
                      </p>
                    </div>
                  </div>
                  {expanded && checkpoints.length ? (
                    <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-background/75 sm:grid-cols-3">
                      {checkpoints.map((checkpoint) => {
                        const split = row.splits.find((item) => item.checkpointId === checkpoint.id);
                        const checkpointIssue = rowAnomalies.find((anomaly) => {
                          const missingCheckpointIds = anomaly.evidence.missingCheckpointIds;
                          return anomaly.state === "open" && (
                            anomaly.evidence.checkpointId === checkpoint.id
                            || (Array.isArray(missingCheckpointIds) && missingCheckpointIds.includes(checkpoint.id))
                          );
                        });
                        return (
                          <div key={checkpoint.id} className={`border-b border-r border-border/70 px-2 py-2 text-center last:border-r-0 ${checkpointIssue ? "bg-destructive/10 text-destructive" : "text-foreground"}`}>
                            <div className="truncate text-[9px] font-bold uppercase tracking-wide">{checkpoint.name}</div>
                            <div className="mt-1 font-mono text-xs">
                              <CheckpointTimePair
                                split={split}
                                massGunStartAt={massGunStartAt}
                                isStart={checkpoint.checkpointType === "start"}
                              />
                            </div>
                            {checkpointIssue ? (
                              <div className="mt-0.5 text-[9px] font-bold uppercase">
                                {checkpointIssue.code === "duplicate_checkpoint_observation" ? "Duplicate" : "Check"}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {speedIssue ? (
                    <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                      {speedIssue}
                    </p>
                  ) : null}
                  {duplicateIssues.map((anomaly) => {
                    const checkpointId = duplicateCheckpointId(anomaly);
                    const checkpoint = checkpointId ? checkpointById.get(checkpointId) : null;
                    return (
                      <div key={anomaly.id} className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                        <p className="text-xs font-bold">Duplicate entries · {checkpoint?.name ?? "Checkpoint"}</p>
                        <p className="mt-1 text-[11px]">{anomaly.message}</p>
                        <div className="mt-2"><DuplicateObservationTimes anomaly={anomaly} /></div>
                      </div>
                    );
                  })}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                    <span className={needsReview ? "text-xs font-semibold text-destructive" : "text-xs text-muted-foreground"}>
                      {openIssueCount
                        ? `${openIssueCount} open issue${openIssueCount === 1 ? "" : "s"}`
                        : needsReview
                          ? formatParticipationStatus(participationStatus)
                          : normalizePublicResultClubName(row.clubName)}
                    </span>
                    <div className="flex items-center gap-2">
                      {checkpoints.length ? (
                        <button
                          type="button"
                          onClick={() => setExpandedMobileRowId((current) => current === row.id ? null : row.id)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "Show"} checkpoint times for ${row.athleteName}`}
                        >
                          Times {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
                    {onCorrect ? (
                      <button
                        type="button"
                        onClick={() => onCorrect(row)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground"
                        aria-label={`Edit all result fields for ${row.athleteName}`}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit row
                      </button>
                    ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        }) : !unmatchedAnomalies.length ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {rows.length ? "No results match this filter." : emptyMessage}
          </div>
        ) : null}
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-border shadow-soft md:block">
        <table aria-label={label} className="table-zebra-orange min-w-max w-full text-sm">
        <caption className="sr-only">
          {label}: all {rows.length} entries with every checkpoint time and result issue
        </caption>
        <thead>
          <tr className="border-b border-border bg-card text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <SortableResultHeader activeDirection={activeDirection("rank")} className="sticky left-0 z-20 bg-card px-4 py-3.5" onSort={() => handleSort("rank")} sortLabel="rank">Rank</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("bib")} className="px-4 py-3.5" onSort={() => handleSort("bib")} sortLabel="bib">Bib</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("athlete")} className="min-w-48 px-4 py-3.5" onSort={() => handleSort("athlete")} sortLabel="athlete">Athlete</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("country")} className="min-w-36 px-4 py-3.5" onSort={() => handleSort("country")} sortLabel="country">Country</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("club")} className="min-w-36 px-4 py-3.5" onSort={() => handleSort("club")} sortLabel="club">Club</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("gender")} className="px-4 py-3.5" onSort={() => handleSort("gender")} sortLabel="gender">Gender</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("category")} className="px-4 py-3.5" onSort={() => handleSort("category")} sortLabel="category">Category</SortableResultHeader>
            {checkpoints.map((checkpoint) => (
              <SortableResultHeader
                key={checkpoint.id}
                activeDirection={activeDirection(`checkpoint:${checkpoint.id}`)}
                className="min-w-32 px-4 py-3.5 text-[9px]"
                onSort={() => handleSort(`checkpoint:${checkpoint.id}`)}
                sortLabel={checkpoint.name}
              >
                <span className="block text-foreground">{checkpoint.name}</span>
                <span className="mt-0.5 block font-normal normal-case tracking-normal">
                  {checkpoint.checkpointType === "start"
                    ? "Start · local / relative"
                    : checkpoint.checkpointType === "finish"
                      ? "Finish · local / relative"
                      : `CP ${checkpoint.sequenceNumber} · local / relative`}
                </span>
              </SortableResultHeader>
            ))}
            <SortableResultHeader activeDirection={activeDirection("totalTime")} className="min-w-32 px-4 py-3.5" onSort={() => handleSort("totalTime")} sortLabel="total time">Total time / gap</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("averageSpeed")} className="min-w-32 px-4 py-3.5" onSort={() => handleSort("averageSpeed")} sortLabel="average speed">Avg. speed</SortableResultHeader>
            <SortableResultHeader activeDirection={activeDirection("status")} className="min-w-64 px-4 py-3.5" onSort={() => handleSort("status")} sortLabel="status and issues">Status / issues</SortableResultHeader>
            {onCorrect ? <th className="px-4 py-3.5">Edit row</th> : null}
          </tr>
        </thead>
        <tbody>
          {unmatchedAnomalies.map((anomaly) => {
            const bibNumber = String(anomaly.evidence.bibNumber ?? "unknown");
            const anomalyCheckpointId = typeof anomaly.evidence.checkpointId === "string"
              ? anomaly.evidence.checkpointId
              : null;
            return (
              <tr key={anomaly.id} className="border-b border-destructive/20 bg-destructive/[0.07] align-top text-destructive">
                <td className="sticky left-0 z-10 bg-destructive/[0.07] px-4 py-3.5 font-bold">—</td>
                <td className="px-4 py-3.5 font-mono font-black">{bibNumber}</td>
                <td className="px-4 py-3.5 font-bold">Unmatched timing</td>
                <td className="px-4 py-3.5">—</td>
                <td className="px-4 py-3.5" />
                <td className="px-4 py-3.5">—</td>
                <td className="px-4 py-3.5">{categoryName || "—"}</td>
                {checkpoints.map((checkpoint) => (
                  <td key={checkpoint.id} className="px-4 py-3.5 font-mono text-xs font-bold">
                    {checkpoint.id === anomalyCheckpointId
                      ? formatRecordedTime(anomaly.evidence.effectiveRecordedAt)
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-3.5">—</td>
                <td className="px-4 py-3.5">—</td>
                <td className="px-4 py-3.5">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs">
                    <span className="font-bold uppercase">Open</span>
                    <span className="ml-1.5">{anomaly.message}</span>
                  </div>
                </td>
                {onCorrect ? <td className="px-4 py-3.5 text-xs font-bold">Reconcile above</td> : null}
              </tr>
            );
          })}
          {sortedRows.length ? sortedRows.map((row) => {
            const rowAnomalies = anomaliesByRegistrationId.get(row.registrationId) ?? [];
            const openIssues = rowAnomalies.filter((anomaly) => anomaly.state === "open");
            const duplicateIssues = openIssues.filter((anomaly) => anomaly.code === "duplicate_checkpoint_observation");
            const speedIssue = unpersistedImplausibleSpeedMessage(
              rowAnomalies,
              sportCode,
              distanceKm,
              row.finishTimeMs,
            );
            const rowGender = (row as typeof row & { gender?: string | null }).gender ?? null;
            const needsReview = rowNeedsReview(row);
            const participationStatus = effectiveParticipationStatus(row);
            const winnerGapLabel = winnerGapLabelForRow(row);
            return (
              <Fragment key={row.id}>
              <tr className={`border-b align-top transition-colors ${
                needsReview
                  ? "border-destructive/20 bg-destructive/[0.055] text-destructive hover:bg-destructive/[0.075]"
                  : "border-border/30 hover:bg-primary/[0.02]"
              }`}>
                <td className={`sticky left-0 z-10 px-4 py-3.5 ${needsReview ? "bg-destructive/[0.055]" : "bg-card"}`}>
                  <ResultFieldEditButton fieldLabel="rank" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined} align="center">
                    <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold ${needsReview ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                      {row.rankOverall ?? "-"}
                    </span>
                  </ResultFieldEditButton>
                </td>
                <td className={`px-4 py-3.5 font-mono font-bold ${needsReview ? "text-destructive" : "text-primary"}`}>
                  <ResultFieldEditButton fieldLabel="bib" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {row.bibNumber ?? "-"}
                  </ResultFieldEditButton>
                </td>
                <td className="px-4 py-3.5 font-medium">
                  <ResultFieldEditButton fieldLabel="athlete" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {row.athleteName}
                  </ResultFieldEditButton>
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-xs text-muted-foreground">
                  <CountryWithFlag countryCode={row.countryCode} />
                </td>
                <td className="px-4 py-3.5 text-muted-foreground">
                  <ResultFieldEditButton fieldLabel="club" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {normalizePublicResultClubName(row.clubName)}
                  </ResultFieldEditButton>
                </td>
                <td className="px-4 py-3.5 text-xs text-muted-foreground">
                  <ResultFieldEditButton fieldLabel="gender" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {rowGender ? `${rowGender}${row.rankGender ? ` · #${row.rankGender}` : ""}` : row.rankGender ? `#${row.rankGender}` : "—"}
                  </ResultFieldEditButton>
                </td>
                <td className="px-4 py-3.5 text-xs text-muted-foreground">
                  <ResultFieldEditButton fieldLabel="category" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {categoryName || "—"}
                  </ResultFieldEditButton>
                </td>
                {checkpoints.map((checkpoint) => {
                  const split = row.splits.find((item) => item.checkpointId === checkpoint.id);
                  const checkpointIssue = rowAnomalies.find((anomaly) => {
                    const directCheckpointId = anomaly.evidence.checkpointId;
                    const missingCheckpointIds = anomaly.evidence.missingCheckpointIds;
                    return directCheckpointId === checkpoint.id
                      || (Array.isArray(missingCheckpointIds) && missingCheckpointIds.includes(checkpoint.id));
                  });
                  return (
                    <td
                      key={checkpoint.id}
                      className={`px-4 py-3.5 font-mono text-xs ${
                        checkpointIssue?.state === "open" ? "bg-destructive/5 text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      <ResultFieldEditButton fieldLabel={`${checkpoint.name} time`} athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                        <CheckpointTimePair
                          split={split}
                          massGunStartAt={massGunStartAt}
                          isStart={checkpoint.checkpointType === "start"}
                        />
                        {checkpointIssue?.state === "open" ? (
                          <span className="mt-1 block text-[10px] font-bold uppercase">
                            {checkpointIssue.code === "duplicate_checkpoint_observation" ? "Duplicate" : "Check"}
                          </span>
                        ) : null}
                      </ResultFieldEditButton>
                    </td>
                  );
                })}
                <td
                  className="px-4 py-3.5 font-mono text-xs font-bold text-foreground"
                  aria-label={winnerGapLabel === "—"
                    ? `Total time ${row.finishTimeMs != null ? formatElapsed(row.finishTimeMs) : "unavailable"}`
                    : `Total time ${formatElapsed(row.finishTimeMs)}, gap to winner ${winnerGapLabel}`}
                >
                  <ResultFieldEditButton fieldLabel="total time" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    <span className="block">{row.finishTimeMs != null ? formatElapsed(row.finishTimeMs) : "—"}</span>
                    {winnerGapLabel !== "—" ? (
                      <span className="mt-0.5 block text-[10px] font-semibold text-primary">{winnerGapLabel}</span>
                    ) : null}
                  </ResultFieldEditButton>
                </td>
                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                  <ResultFieldEditButton fieldLabel="average speed" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    {formatAverageSpeed(distanceKm, row.finishTimeMs)}
                  </ResultFieldEditButton>
                </td>
                <td className="px-4 py-3.5">
                  <ResultFieldEditButton fieldLabel="status and issues" athleteName={row.athleteName} onEdit={onCorrect ? () => onCorrect(row) : undefined}>
                    <div className="space-y-1.5">
                      {participationStatus !== "finished" ? (
                        <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase text-foreground">
                          {formatParticipationStatus(participationStatus)}
                        </span>
                      ) : null}
                      {openIssues.length || speedIssue ? (
                        <>
                          {openIssues.map((anomaly) => (
                            <div
                              key={anomaly.id}
                              className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
                            >
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase">Open issue</span>
                                <span>{anomaly.message}</span>
                              </div>
                            </div>
                          ))}
                          {speedIssue ? (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase">Open issue</span>
                                <span>{speedIssue}</span>
                              </div>
                            </div>
                          ) : null}
                          <span className="block text-[10px] font-semibold text-destructive">
                            {openIssues.length + (speedIssue ? 1 : 0)} open issue{openIssues.length + (speedIssue ? 1 : 0) === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : participationStatus === "finished" ? (
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                          row.finishTimeMs != null
                            ? "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {row.finishTimeMs != null ? "Finished · clear" : row.resultStatus}
                        </span>
                      ) : null}
                    </div>
                  </ResultFieldEditButton>
                </td>
                {onCorrect ? (
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => onCorrect(row)}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold transition-colors hover:bg-secondary"
                      aria-label={`Edit all result fields for ${row.athleteName}`}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit all fields
                    </button>
                  </td>
                ) : null}
              </tr>
              {duplicateIssues.map((anomaly) => {
                const checkpointId = duplicateCheckpointId(anomaly);
                const checkpoint = checkpointId ? checkpointById.get(checkpointId) : null;
                return (
                  <tr key={`${row.id}:${anomaly.id}:duplicate`} className="border-b border-destructive/25 bg-destructive/[0.09] align-top text-destructive">
                    <td colSpan={7} className="px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-wide">Duplicate timing entries</p>
                      <p className="mt-1 text-xs">
                        {row.athleteName}{row.bibNumber ? ` · Bib ${row.bibNumber}` : ""} · {checkpoint?.name ?? "Checkpoint"}
                      </p>
                    </td>
                    {checkpoints.map((item) => (
                      <td key={item.id} className={`px-3 py-3 ${item.id === checkpointId ? "min-w-52" : ""}`}>
                        {item.id === checkpointId ? <DuplicateObservationTimes anomaly={anomaly} /> : null}
                      </td>
                    ))}
                    <td colSpan={3 + (onCorrect ? 1 : 0)} className="px-4 py-3 text-xs">
                      <p className="font-semibold">Both raw entries are shown in the checkpoint column.</p>
                      <p className="mt-1 text-destructive/80">Review the timestamps before resolving this issue.</p>
                    </td>
                  </tr>
                );
              })}
              </Fragment>
            );
          }) : !unmatchedAnomalies.length ? (
            <tr>
              <td colSpan={10 + checkpoints.length + (onCorrect ? 1 : 0)} className="px-6 py-10 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function rankingLabels(input: {
  sexEnabled?: boolean;
  sexLabels?: string[];
  teamEnabled?: boolean;
  teamLabel?: string;
}) {
  const labels = ["Overall"];
  if (input.sexEnabled && input.sexLabels?.length) {
    labels.push(input.sexLabels.join(" / "));
  }
  if (input.teamEnabled && input.teamLabel) {
    labels.push(input.teamLabel);
  }
  return labels;
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="font-mono text-2xl font-bold text-primary">
      {time.toLocaleTimeString("en-GB")}
    </div>
  );
}

export default function TimingResults({
  practiceOnly = false,
  fieldOperationsOnly = false,
}: {
  practiceOnly?: boolean;
  fieldOperationsOnly?: boolean;
}) {
  const { account } = useOrganizerAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { eventId: routeEventId } = useParams<{ eventId?: string }>();
  const useProminentTemporaryRaceSelector = routeEventId === "b3ece62d-80b6-469a-9ff5-8316802eca66";
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>(() =>
    searchParams.get("view") === "official"
      ? "Official results"
      : "Temporary results",
  );
  const [resultBoardView, setResultBoardView] = useState<OrganizerResultBoardView>("individual");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>("");
  const [bibInput, setBibInput] = useState("");
  const [entryAlerts, setEntryAlerts] = useState<TimingEntryAlert[]>([]);
  const [pendingPunchCount, setPendingPunchCount] = useState(0);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const [resultActionPending, setResultActionPending] = useState(false);
  const [publicationChangeNote, setPublicationChangeNote] = useState("");
  const [autoResultsPending, setAutoResultsPending] = useState(false);
  const [autoResultsUpdatedAt, setAutoResultsUpdatedAt] = useState<Date | null>(null);
  const [autoResultsError, setAutoResultsError] = useState<string | null>(null);
  const [autoResultsRetryAttempt, setAutoResultsRetryAttempt] = useState(0);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [queuedPunchCount, setQueuedPunchCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [punchResolutionRegistration, setPunchResolutionRegistration] = useState<Record<string, string>>({});
  const [punchResolutionNote, setPunchResolutionNote] = useState<Record<string, string>>({});
  const showEntryAlert = useCallback((alert: TimingEntryAlert) => {
    setEntryAlerts((current) => [
      alert,
      ...current.filter((item) => item.id !== alert.id),
    ].slice(0, 3));
  }, []);
  const dismissEntryAlert = useCallback((id: string) => {
    setEntryAlerts((current) => current.filter((item) => item.id !== id));
  }, []);
  const [anomalyResolutionNote, setAnomalyResolutionNote] = useState<Record<string, string>>({});
  const [complaintFormOpen, setComplaintFormOpen] = useState(false);
  const [complainantName, setComplainantName] = useState("");
  const [complaintBib, setComplaintBib] = useState("");
  const [complaintText, setComplaintText] = useState("");
  const [complaintResolutionNote, setComplaintResolutionNote] = useState<Record<string, string>>({});
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<OrganizerCategoryResults["rows"][number] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSyncKeyRef = useRef("");
  const automaticResultsUpdateKeyRef = useRef("");
  const automaticResultsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightPunchesRef = useRef(new Set<string>());
  const raceRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publicationCommandRef = useRef<{ signature: string; id: string } | null>(null);

  const eventsQuery = useQuery({
    queryKey: ["organizer-events", account?.organizationIds[0] ?? "no-org"],
    queryFn: () => getOrganizerEvents(account),
    enabled: Boolean(account?.hasOrganizerAccess),
    placeholderData: [],
    staleTime: 30_000,
  });

  const requestedEditionId = routeEventId ?? searchParams.get("edition") ?? "";
  const requestedEventWorkspaceUnlocked = useOrganizerEventWorkspaceUnlocked(requestedEditionId);
  const availableEvents = useMemo(
    () => practiceOnly
      ? (eventsQuery.data ?? []).filter((event) => event.isPractice)
      : fieldOperationsOnly
        ? selectFieldOperationsEvents(
            eventsQuery.data ?? [],
            requestedEditionId,
            // A direct results link remains a review surface after completion.
            true,
          )
        : (eventsQuery.data ?? []).filter((event) => !event.isPractice),
    [
      eventsQuery.data,
      fieldOperationsOnly,
      practiceOnly,
      requestedEditionId,
    ],
  );
  const selectedEvent = requestedEditionId
    ? availableEvents.find((event) => event.id === requestedEditionId) ?? null
    : availableEvents[0] ?? null;
  const selectedEventResultsProgress = selectedEvent
    ? getEventResultsProgress(selectedEvent)
    : { raceCount: 0, finalCount: 0, provisionalCount: 0, closedWithoutResultsCount: 0 };
  const selectedEventWorkflowProgress = selectedEvent
    ? resolveOrganizerEventWorkflowProgress({
        eventStatus: selectedEvent.status,
        finalResultCount: selectedEventResultsProgress.finalCount,
        provisionalResultCount: selectedEventResultsProgress.provisionalCount,
        closedWithoutResultsCount: selectedEventResultsProgress.closedWithoutResultsCount,
        raceCount: selectedEventResultsProgress.raceCount,
      })
    : "overview";
  const eventIsFinished = selectedEventWorkflowProgress === "finished";
  const resultEditingUnlocked = !eventIsFinished || requestedEventWorkspaceUnlocked;
  const editionId = selectedEvent?.id ?? "";
  const canManageResults = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "results.manage")
    : false;
  const canManageRaceDay = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "race_day.manage")
    : false;
  const canManageEntrants = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "entrants.manage")
    : false;
  const canManageFinance = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "finance.manage")
    : false;
  const canManageEvent = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "events.manage")
    : false;
  const canEnterTiming = selectedEvent
    ? hasEventPermission(account, selectedEvent.id, "checkpoint_timing.enter")
    : false;
  const raceDayQuery = useQuery({
    queryKey: ["organizer-race-day", editionId],
    queryFn: () => getOrganizerRaceDayState(account, editionId),
    enabled: Boolean(account?.hasOrganizerAccess && editionId),
    refetchInterval: sessionActionPending || resultActionPending || autoResultsPending
      ? false
      : activeTab === "Control points"
        ? 10_000
        : 30_000,
  });
  const liveOperationsClosed = Boolean(selectedEvent && !selectedEvent.isPractice && (
    eventLiveOperationsAreClosed(selectedEvent)
    || (raceDayQuery.data && eventLiveOperationsAreClosed({
      status: raceDayQuery.data.edition.status,
      categories: raceDayQuery.data.categories,
    }))
  ));
  const registrationsQuery = useQuery({
    queryKey: ["organizer-registrations", editionId],
    queryFn: () => getOrganizerRegistrations(account, editionId),
    enabled: Boolean(
      account?.hasOrganizerAccess
      && editionId
      && canManageRaceDay
      && activeTab !== "Official results",
    ),
    placeholderData: [],
  });
  const accessibleCategories = useMemo(() => {
    const categories = raceDayQuery.data?.categories ?? [];
    if (account?.accountType !== "temporary" || canManageResults) return categories;

    const assignments = account.eventAccess.filter(
      (assignment) =>
        assignment.eventEditionId === editionId
        && (
          assignment.permissions.includes("race_day.manage")
          || assignment.permissions.includes("checkpoint_timing.enter")
        ),
    );
    if (!assignments.length) return [];

    return categories.flatMap((category) => {
      const categoryAssignments = assignments.filter(
        (assignment) =>
          assignment.eventCategoryId === null
          || assignment.eventCategoryId === category.id,
      );
      if (!categoryAssignments.length) return [];
      if (categoryAssignments.some((assignment) => assignment.checkpointId === null)) {
        return [category];
      }
      const checkpointIds = new Set(
        categoryAssignments
          .map((assignment) => assignment.checkpointId)
          .filter((value): value is string => Boolean(value)),
      );
      return [{
        ...category,
        checkpoints: category.checkpoints.filter((checkpoint) =>
          checkpointIds.has(checkpoint.id),
        ),
      }];
    });
  }, [account, canManageResults, editionId, raceDayQuery.data?.categories]);

  const refreshQueuedPunchCount = useCallback(async () => {
    if (!editionId || activeTab !== "Control points") {
      setQueuedPunchCount(0);
      return 0;
    }
    try {
      const count = (await listOfflinePunches(editionId)).length;
      setQueuedPunchCount(count);
      return count;
    } catch (error) {
      setQueuedPunchCount(0);
      showEntryAlert({
        id: "offline-storage",
        tone: "error",
        title: "Device timing storage is unavailable",
        message: error instanceof Error
          ? error.message
          : "This device cannot read saved timing entries.",
      });
      return 0;
    }
  }, [activeTab, editionId, showEntryAlert]);

  const syncQueuedPunches = useCallback(async (showToast = true) => {
    if (!account || !editionId || syncingQueue) return;
    setSyncingQueue(true);
    try {
      const result = await syncOfflinePunches(
        editionId,
        (payload) =>
          isSharedQueuedPunch(payload)
            ? recordOrganizerSharedPunch(account, payload)
            : recordOrganizerPunch(account, payload),
        (error) =>
          !navigator.onLine
          || error instanceof TypeError
          || (error instanceof ApiError && error.status >= 500),
      );
      await refreshQueuedPunchCount();
      if (result.synced) await raceDayQuery.refetch();
      if (result.remaining) {
        showEntryAlert({
          id: "offline-sync",
          tone: "offline",
          title: `${result.remaining} saved time${result.remaining === 1 ? "" : "s"} still need sync`,
          message: "The entries remain on this device. Keep this page open and try Sync again when the connection is stable.",
        });
      } else {
        dismissEntryAlert("offline-sync");
      }
      if (showToast) {
        if (result.remaining) {
          toast.warning(
            `${result.synced} queued punch${result.synced === 1 ? "" : "es"} synced; ${result.remaining} still need attention.`,
          );
        } else if (result.synced) {
          toast.success(`${result.synced} queued punch${result.synced === 1 ? "" : "es"} synced.`);
        } else {
          toast.info("No offline punches are waiting.");
        }
      }
    } catch (error) {
      showEntryAlert({
        id: "offline-sync",
        tone: "error",
        title: "Saved timing entries could not sync",
        message: error instanceof Error
          ? error.message
          : "Keep this page open and try Sync again.",
      });
      if (showToast) {
        toast.error(error instanceof Error ? error.message : "Unable to sync offline punches.");
      }
    } finally {
      setSyncingQueue(false);
    }
  }, [
    account,
    dismissEntryAlert,
    editionId,
    raceDayQuery,
    refreshQueuedPunchCount,
    showEntryAlert,
    syncingQueue,
  ]);

  useEffect(() => {
    void refreshQueuedPunchCount();
  }, [refreshQueuedPunchCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncQueuedPunches(false);
    };
    const handleOffline = () => {
      autoSyncKeyRef.current = "";
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncQueuedPunches]);

  useEffect(() => {
    if (!isOnline || !editionId || !queuedPunchCount) return;
    const key = `${editionId}:${queuedPunchCount}`;
    if (autoSyncKeyRef.current === key) return;
    autoSyncKeyRef.current = key;
    void syncQueuedPunches(false);
  }, [editionId, isOnline, queuedPunchCount, syncQueuedPunches]);

  useEffect(() => {
    if (selectedEvent?.id && requestedEditionId !== selectedEvent.id) {
      if (routeEventId) {
        navigate(
          `/organizer/registrations/results?edition=${selectedEvent.id}&view=temporary`,
          { replace: true },
        );
        return;
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("edition", selectedEvent.id);
        return next;
      });
    }
  }, [navigate, requestedEditionId, routeEventId, selectedEvent?.id, setSearchParams]);

  useEffect(() => {
    const view = searchParams.get("view");
    if (view === "official") setActiveTab("Official results");
    if (view === "temporary") setActiveTab("Temporary results");
  }, [searchParams]);

  useEffect(() => {
    const nextCategoryId = accessibleCategories[0]?.id ?? "";
    setSelectedCategoryId((current) =>
      accessibleCategories.some((category) => category.id === current)
        ? current
        : nextCategoryId,
    );
  }, [accessibleCategories]);

  const selectedCategory = useMemo(() => {
    return accessibleCategories.find((category) => category.id === selectedCategoryId)
      ?? accessibleCategories[0]
      ?? null;
  }, [accessibleCategories, selectedCategoryId]);

  useEffect(() => {
    const nextCheckpointId = selectedCategory?.checkpoints[0]?.id ?? "";
    setSelectedCheckpointId((current) => current || nextCheckpointId);
  }, [selectedCategory?.checkpoints]);

  const activeSession = useMemo(() => {
    if (!selectedCategory || !raceDayQuery.data) return null;
    return (
      raceDayQuery.data.sessions.find((session) => session.id === selectedCategory.activeSessionId) ??
      raceDayQuery.data.sessions.find((session) => session.eventCategoryId === selectedCategory.id && session.status === "active") ??
      null
    );
  }, [raceDayQuery.data, selectedCategory]);

  const resultsQuery = useQuery({
    queryKey: ["organizer-category-results", selectedCategory?.id ?? "none"],
    queryFn: () => getOrganizerCategoryResults(account, selectedCategory!.id),
    enabled: Boolean(
      account?.hasOrganizerAccess
      && selectedCategory?.id
      && canManageResults,
    ),
  });
  const officialResultRunId = resultsQuery.data?.publication?.resultRunId ?? "";
  const importedSnapshot = resultsQuery.data?.calculationMode === "imported_snapshot"
    || ["preserved_legacy_rank", "legacy_official_rank"].includes(String(resultsQuery.data?.selectedRun?.summary.rankingMethod ?? ""));
  const canEditResultSnapshot = resultEditingUnlocked && !importedSnapshot;
  const publicationState: ResultsPublicationState =
    resultsQuery.data?.publication?.publicationState
    && resultsQuery.data.publication.publicationState !== "provisional"
      ? "corrected"
      : "official";

  useEffect(() => {
    if (!searchParams.get("view") && officialResultRunId) {
      setActiveTab("Official results");
    }
  }, [officialResultRunId, searchParams]);

  const officialResultsQuery = useQuery({
    queryKey: [
      "organizer-category-results",
      selectedCategory?.id ?? "none",
      "official",
      officialResultRunId || "none",
    ],
    queryFn: () => getOrganizerCategoryResults(
      account,
      selectedCategory!.id,
      officialResultRunId,
    ),
    enabled: Boolean(
      account?.hasOrganizerAccess
      && selectedCategory?.id
      && canManageResults
      && activeTab === "Official results"
      && officialResultRunId
      && resultsQuery.data?.selectedRun?.id !== officialResultRunId,
    ),
  });
  const officialResultsSnapshot =
    resultsQuery.data?.selectedRun?.id === officialResultRunId
      ? resultsQuery.data
      : officialResultsQuery.data;
  const officialResultsUnconfirmed = !resultsQuery.data
    || Boolean(officialResultRunId && !officialResultsSnapshot);
  const officialResultsReadFailed = (resultsQuery.isError && !resultsQuery.data)
    || (officialResultsQuery.isError && !officialResultsSnapshot);
  const officialTeamStandings = officialResultsSnapshot?.teamStandings ?? [];
  const correctionPunches = useMemo(() => {
    if (!correctionRow || !selectedCategory) return [];
    return correctionRow.splits.flatMap((split) => (
      split.punchEventId && split.recordedAt
        ? [{
            id: split.punchEventId,
            eventCategoryId: selectedCategory.id,
            checkpointId: split.checkpointId,
            registrationId: correctionRow.registrationId,
            bibNumber: correctionRow.bibNumber,
            athleteName: correctionRow.athleteName,
            categoryName: selectedCategory.name,
            checkpointName: split.checkpointName,
            recordedAt: split.recordedAt,
            warnings: [],
          }]
        : []
    ));
  }, [correctionRow, selectedCategory]);

  const raceDayRefetchRef = useRef(raceDayQuery.refetch);
  useEffect(() => {
    raceDayRefetchRef.current = raceDayQuery.refetch;
  }, [raceDayQuery.refetch]);

  const scheduleRaceDayRefresh = useCallback((bibNumber: string, clientEventId: string) => {
    if (raceRefreshTimerRef.current) clearTimeout(raceRefreshTimerRef.current);
    raceRefreshTimerRef.current = setTimeout(() => {
      raceRefreshTimerRef.current = null;
      void raceDayRefetchRef.current().then((result) => {
        if (!result.error) return;
        const message = "Time saved, but the race view could not refresh. Continue timing or refresh the page manually.";
        showEntryAlert({
          id: `refresh:${clientEventId}`,
          tone: "warning",
          title: `Bib ${bibNumber} is saved`,
          message,
        });
        toast.warning(message);
      }).catch(() => {
        const message = "Time saved, but the race view could not refresh. Continue timing or refresh the page manually.";
        showEntryAlert({
          id: `refresh:${clientEventId}`,
          tone: "warning",
          title: `Bib ${bibNumber} is saved`,
          message,
        });
        toast.warning(message);
      });
    }, 300);
  }, [showEntryAlert]);

  useEffect(() => () => {
    if (raceRefreshTimerRef.current) clearTimeout(raceRefreshTimerRef.current);
  }, []);

  const selectedCheckpoint =
    selectedCategory?.checkpoints.find((checkpoint) => checkpoint.id === selectedCheckpointId) ??
    selectedCategory?.checkpoints[0] ??
    null;

  async function refreshAll() {
    await Promise.all([
      raceDayQuery.refetch(),
      resultsQuery.refetch(),
      eventsQuery.refetch(),
    ]);
  }

  async function handleOpenSession() {
    if (!account || !editionId || !selectedCategory || !selectedCheckpoint) return;
    setSessionActionPending(true);
    try {
      await createOrganizerTimingSession(account, {
        eventEditionId: editionId,
        eventCategoryId: selectedCategory.id,
        checkpointId: selectedCheckpoint.id,
        mode: "online",
      });
      await raceDayQuery.refetch();
      toast.success("Timing session opened.");
      inputRef.current?.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open timing session.";
      toast.error(message);
    } finally {
      setSessionActionPending(false);
    }
  }

  async function handleCloseSession() {
    if (!account || !activeSession) return;
    setSessionActionPending(true);
    try {
      await closeOrganizerTimingSession(account, activeSession.id);
      await raceDayQuery.refetch();
      toast.success("Timing session closed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to close timing session.";
      toast.error(message);
    } finally {
      setSessionActionPending(false);
    }
  }

  async function handlePunchSubmit() {
    if (!account || !activeSession || !selectedCheckpoint) return;
    const bibNumber = bibInput.trim();
    if (!bibNumber) return;

    const punchKey = `${activeSession.id}:${selectedCheckpoint.id}:${bibNumber}`;
    if (inFlightPunchesRef.current.has(punchKey)) {
      setBibInput("");
      inputRef.current?.focus();
      const message = `Bib ${bibNumber} is already being saved at ${selectedCheckpoint.name}.`;
      showEntryAlert({
        id: `duplicate:${punchKey}`,
        tone: "warning",
        title: "Entry already in progress",
        message,
      });
      toast.warning(message);
      return;
    }

    const payload: DirectQueuedPunchPayload = {
      timingSessionId: activeSession.id,
      checkpointId: selectedCheckpoint.id,
      clientEventId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
      bibNumber,
    };
    inFlightPunchesRef.current.add(punchKey);
    setPendingPunchCount((current) => current + 1);
    setBibInput("");
    inputRef.current?.focus();
    try {
      if (!navigator.onLine) throw new TypeError("Device is offline");
      const response = await recordOrganizerPunch(account, payload);
      scheduleRaceDayRefresh(bibNumber, payload.clientEventId);
      if (response.warnings.length) {
        const message = response.warnings.map((item) => item.message).join(" ");
        showEntryAlert({
          id: `warning:${payload.clientEventId}`,
          tone: "warning",
          title: `Bib ${bibNumber} saved — review needed`,
          message,
        });
        toast.warning(`Saved to the database. ${message}`);
      } else {
        toast.success(`Bib ${bibNumber} saved to the database.`);
      }
    } catch (error) {
      if (shouldSavePunchOnDevice(error)) {
        try {
          await enqueueOfflinePunch(editionId, payload);
          const count = await refreshQueuedPunchCount();
          autoSyncKeyRef.current = `${editionId}:${count}`;
          const message = "Database confirmation is pending. This entry is safe on this device and can sync later without creating a duplicate; use Sync when the connection is stable.";
          showEntryAlert({
            id: `offline:${payload.clientEventId}`,
            tone: "offline",
            title: `Bib ${bibNumber} is saved on this device`,
            message,
          });
          toast.warning(
            `Bib ${bibNumber} saved on this device and is ready to sync.`,
          );
        } catch (storageError) {
          const detail = storageError instanceof Error
            ? storageError.message
            : "Offline storage is unavailable.";
          const message = `${detail} Stop and record this time manually before continuing.`;
          showEntryAlert({
            id: `storage:${payload.clientEventId}`,
            tone: "error",
            title: `Bib ${bibNumber} could not be confirmed or saved on this device`,
            message,
          });
          toast.error(message);
        }
      } else {
        const message = error instanceof Error ? error.message : "Unable to record punch.";
        showEntryAlert({
          id: `save:${payload.clientEventId}`,
          tone: "error",
          title: `Bib ${bibNumber} was not saved`,
          message,
        });
        toast.error(`Bib ${bibNumber} was not saved. ${message}`);
      }
    } finally {
      inFlightPunchesRef.current.delete(punchKey);
      setPendingPunchCount((current) => Math.max(0, current - 1));
    }
  }

  async function handlePublish() {
    if (!account || !selectedCategory) return;
    if (!canEditResultSnapshot) {
      toast.error("Unlock this finished race before publishing another result correction.");
      return;
    }
    if (!resultsQuery.data?.selectedRun) {
      toast.error("Calculate temporary results before publication.");
      return;
    }
    if (resultsNeedUpdate) {
      toast.error("Update temporary results before publication.");
      return;
    }
    setResultActionPending(true);
    try {
      const changeNote = publicationChangeNote.trim();
      const commandSignature = JSON.stringify({
        categoryId: selectedCategory.id,
        publicationState,
        resultRunId: resultsQuery.data.selectedRun.id,
        changeNote,
      });
      if (publicationCommandRef.current?.signature !== commandSignature) {
        publicationCommandRef.current = {
          signature: commandSignature,
          id: crypto.randomUUID(),
        };
      }
      const published = await publishOrganizerCategoryResults(account, selectedCategory.id, {
        publicationState,
        resultRunId: resultsQuery.data.selectedRun.id,
        ...(changeNote ? { changeNote } : {}),
        clientEventId: publicationCommandRef.current.id,
      });
      publicationCommandRef.current = null;
      await refreshAll();
      setPublicationChangeNote("");
      toast.success(`${formatPublicationStateLabel(publicationState)} results published.`);
      if (published.publicationWorkflow?.leagueState === "pending") {
        toast.warning("Results are published. League standings propagation is queued for retry.");
      } else if (published.publicationWorkflow?.leagueState === "waiting_for_sources") {
        toast.info("Results are published. League standings will update when every mapped race has official results.");
      }
      setActiveTab("Official results");
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("view", "official");
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to publish results.";
      if (message.includes("unknown timing event")) {
        await raceDayQuery.refetch();
        toast.error("Publication is blocked by an unknown timing record. Review the record listed above and resolve or void it.");
      } else {
        toast.error(message);
      }
    } finally {
      setResultActionPending(false);
    }
  }

  async function handleResultCorrectionApplied() {
    if (!selectedCategory) return;
    const correctedResults = await recomputeOrganizerCategoryResults(account, selectedCategory.id);
    queryClient.setQueryData(
      ["organizer-category-results", selectedCategory.id],
      correctedResults,
    );
    await Promise.all([raceDayQuery.refetch(), eventsQuery.refetch()]);
    setAutoResultsUpdatedAt(new Date());
    setCorrectionRow(null);
    setActiveTab("Temporary results");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "temporary");
      return next;
    });
  }

  async function handleCreateComplaint() {
    if (!account || !selectedCategory) return;
    if (!complainantName.trim() || !complaintText.trim()) {
      toast.error("Enter the complainant name and complaint.");
      return;
    }
    setResultActionPending(true);
    try {
      await createOrganizerResultComplaint(account, selectedCategory.id, {
        complainantName: complainantName.trim(),
        bibNumber: complaintBib.trim() || null,
        complaintText: complaintText.trim(),
      });
      await resultsQuery.refetch();
      setComplainantName("");
      setComplaintBib("");
      setComplaintText("");
      setComplaintFormOpen(false);
      toast.success("Complaint added to temporary results.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add complaint.");
    } finally {
      setResultActionPending(false);
    }
  }

  async function handleResolveComplaint(
    complaintId: string,
    status: "resolved" | "dismissed",
  ) {
    const resolutionNote = complaintResolutionNote[complaintId]?.trim();
    if (!account || !resolutionNote) {
      toast.error("Enter a short resolution note.");
      return;
    }
    setReviewActionId(complaintId);
    try {
      await resolveOrganizerResultComplaint(account, complaintId, {
        status,
        resolutionNote,
      });
      await resultsQuery.refetch();
      setComplaintResolutionNote((current) => ({
        ...current,
        [complaintId]: "",
      }));
      toast.success(status === "resolved" ? "Complaint resolved." : "Complaint dismissed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to close complaint.");
    } finally {
      setReviewActionId(null);
    }
  }

  async function handlePunchRevision(
    punchId: string,
    revisionType: "resolve_registration" | "void",
  ) {
    const note = punchResolutionNote[punchId]?.trim();
    const registrationId = punchResolutionRegistration[punchId];
    if (!note || (revisionType === "resolve_registration" && !registrationId)) {
      toast.error("Choose a registration and enter reconciliation evidence.");
      return;
    }
    setReviewActionId(punchId);
    try {
      await revisePunchEvent(punchId, {
        revisionType,
        reason: note,
        registrationId: revisionType === "resolve_registration" ? registrationId : null,
        clientEventId: crypto.randomUUID(),
      });
      await refreshAll();
      setPunchResolutionNote((current) => ({ ...current, [punchId]: "" }));
      setPunchResolutionRegistration((current) => ({ ...current, [punchId]: "" }));
      toast.success(
        revisionType === "void"
          ? "Timing entry dismissed with evidence."
          : "Checkpoint time assigned to the runner.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reconcile the timing record.");
    } finally {
      setReviewActionId(null);
    }
  }

  async function handleAnomalyResolution(
    anomalyId: string,
    resolutionState: "resolved" | "waived",
  ) {
    const note = anomalyResolutionNote[anomalyId]?.trim();
    if (!note) {
      toast.error("Enter evidence for accepting or dismissing the issue.");
      return;
    }
    setReviewActionId(anomalyId);
    try {
      await resolveResultAnomaly(anomalyId, { resolutionState, resolutionNote: note });
      await resultsQuery.refetch();
      toast.success(resolutionState === "resolved" ? "Issue accepted." : "Issue dismissed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve the anomaly.");
    } finally {
      setReviewActionId(null);
    }
  }

  async function handleAcknowledgeAll() {
    if (!reviewSummary.acknowledgeableAnomalies.length) return;
    setReviewActionId("acknowledge-all");
    const note = "Bulk acknowledged after reviewing the temporary result table.";
    try {
      const results = await Promise.allSettled(
        reviewSummary.acknowledgeableAnomalies.map((anomaly) => (
          resolveResultAnomaly(anomaly.id, {
            resolutionState: "waived",
            resolutionNote: note,
          })
        )),
      );
      await resultsQuery.refetch();
      const acknowledgedCount = results.filter((result) => result.status === "fulfilled").length;
      const failedCount = results.length - acknowledgedCount;
      if (acknowledgedCount) {
        toast.success(`${acknowledgedCount} review flag${acknowledgedCount === 1 ? "" : "s"} acknowledged.`);
      }
      if (failedCount) {
        toast.error(`${failedCount} review flag${failedCount === 1 ? "" : "s"} still need attention.`);
      }
    } finally {
      setReviewActionId(null);
    }
  }

  const hasFinalPublication = ["official", "corrected"].includes(resultsQuery.data?.publication?.publicationState ?? "");
  const raceStatus =
    activeSession?.status === "active" && !liveOperationsClosed
      ? "running"
      : hasFinalPublication || liveOperationsClosed
      ? "finished"
      : "idle";
  const visibleTabs = useMemo<Array<(typeof tabs)[number]>>(
    () =>
      canManageResults
        ? ["Temporary results", "Official results"]
        : [],
    [canManageResults],
  );
  const recentPunches = useMemo(
    () => raceDayQuery.data?.recentPunches ?? [],
    [raceDayQuery.data?.recentPunches],
  );
  const unresolvedPunches = useMemo(
    () => raceDayQuery.data?.unresolvedPunches ?? [],
    [raceDayQuery.data?.unresolvedPunches],
  );
  const resultRows = useMemo(
    () => resultsQuery.data?.rows ?? [],
    [resultsQuery.data?.rows],
  );
  const checkpointElapsedByPunchKey = useMemo(() => {
    const elapsedByKey = new Map<string, number>();
    for (const row of resultRows) {
      for (const split of row.splits) {
        if (split.elapsedTimeMs == null || split.elapsedTimeMs < 0) continue;
        if (split.punchEventId) elapsedByKey.set(`punch:${split.punchEventId}`, split.elapsedTimeMs);
        elapsedByKey.set(`registration:${row.registrationId}:${split.checkpointId}`, split.elapsedTimeMs);
      }
    }
    return elapsedByKey;
  }, [resultRows]);
  const elapsedTimeForPunch = (punch: (typeof recentPunches)[number]) => (
    checkpointElapsedByPunchKey.get(`punch:${punch.id}`)
    ?? (punch.registrationId
      ? checkpointElapsedByPunchKey.get(`registration:${punch.registrationId}:${punch.checkpointId}`)
      : undefined)
    ?? null
  );
  const rankingConfig = resultsQuery.data?.category.rankingConfig;
  const teamStandings = resultsQuery.data?.teamStandings ?? [];
  const anomalies = resultsQuery.data?.anomalies ?? [];
  const complaints = resultsQuery.data?.complaints ?? [];
  const openComplaints = complaints.filter((complaint) => complaint.status === "open");
  const openBlockingAnomalies = anomalies.filter(
    (anomaly) =>
      anomaly.state === "open"
      && (anomaly.severity === "error" || anomaly.severity === "critical"),
  );
  const selectedCategoryUnresolvedPunches = useMemo(
    () => selectedCategory
      ? unresolvedPunches.filter((punch) => punch.eventCategoryId === selectedCategory.id)
      : [],
    [selectedCategory, unresolvedPunches],
  );
  const reconciliationCandidatesByPunchId = useMemo(() => new Map(
    selectedCategoryUnresolvedPunches.map((punch) => [
      punch.id,
      selectUnresolvedPunchCandidates(raceDayQuery.data?.expectedAthletes ?? [], punch),
    ]),
  ), [raceDayQuery.data?.expectedAthletes, selectedCategoryUnresolvedPunches]);
  const reviewSummary = buildResultReviewSummary({
    snapshot: resultsQuery.data,
    unresolvedTimingCount: selectedCategoryUnresolvedPunches.length,
    openComplaintCount: openComplaints.length,
  });
  const closedWithoutResults = Boolean(
    resultsQuery.data && selectedCategory?.status === "completed"
    && !selectedCategory.effectiveStartAt && !resultsQuery.data.selectedRun,
  );
  const autoResultsVersion = closedWithoutResults || importedSnapshot ? "" : selectedCategory?.resultInputVersion ?? "";
  const autoResultsCategoryId = selectedCategory?.id ?? "";
  const selectedRunInputDigest = String(
    resultsQuery.data?.selectedRun?.summary.inputDigest ?? "",
  );
  const resultsNeedUpdate = Boolean(
    autoResultsVersion && selectedRunInputDigest !== autoResultsVersion,
  );
  const refetchSelectedResults = resultsQuery.refetch;
  const shouldAutomaticallyUpdateResults = Boolean(
    resultsQuery.data
    && activeTab === "Temporary results"
    && canEditResultSnapshot
    && autoResultsVersion
    && (resultsNeedUpdate || !resultsQuery.data?.selectedRun),
  );
  const publishActionLabel = publicationState === "official"
    ? "Publish final results"
    : `Publish ${formatPublicationStateLabel(publicationState)} results`;
  const publishDisabled = Boolean(
    !canEditResultSnapshot
    || resultActionPending
    || autoResultsPending
    || resultsNeedUpdate
    || !resultsQuery.data?.selectedRun
    || openBlockingAnomalies.length
    || reviewSummary.acknowledgeableAnomalies.length
    || reviewSummary.unfinishedParticipantCount
    || selectedCategoryUnresolvedPunches.length
    || openComplaints.length
  );

  useEffect(() => {
    setPublicationChangeNote("");
  }, [
    resultsQuery.data?.publication?.id,
    selectedCategory?.id,
  ]);

  useEffect(() => {
    automaticResultsUpdateKeyRef.current = "";
    if (automaticResultsRetryTimerRef.current) {
      clearTimeout(automaticResultsRetryTimerRef.current);
      automaticResultsRetryTimerRef.current = null;
    }
    setAutoResultsPending(false);
    setAutoResultsUpdatedAt(null);
    setAutoResultsError(null);
    setAutoResultsRetryAttempt(0);
    return () => {
      if (automaticResultsRetryTimerRef.current) {
        clearTimeout(automaticResultsRetryTimerRef.current);
        automaticResultsRetryTimerRef.current = null;
      }
    };
  }, [autoResultsCategoryId]);

  useEffect(() => {
    if (
      !account
      || !autoResultsCategoryId
      || !canManageResults
      || resultActionPending
      || !shouldAutomaticallyUpdateResults
    ) return;

    const updateKey = [
      autoResultsCategoryId,
      autoResultsVersion,
      selectedRunInputDigest || "no-saved-run",
      autoResultsRetryAttempt,
    ].join(":");
    if (automaticResultsUpdateKeyRef.current === updateKey) return;
    automaticResultsUpdateKeyRef.current = updateKey;
    setAutoResultsPending(true);
    setAutoResultsError(null);

    void (async () => {
      try {
        await recomputeOrganizerCategoryResults(account, autoResultsCategoryId);
        if (automaticResultsUpdateKeyRef.current !== updateKey) return;
        await refetchSelectedResults({ throwOnError: true });
        if (automaticResultsUpdateKeyRef.current !== updateKey) return;
        setAutoResultsUpdatedAt(new Date());
      } catch (error) {
        if (automaticResultsUpdateKeyRef.current !== updateKey) return;
        const message = error instanceof Error
          ? error.message
          : "Temporary results could not be updated.";
        setAutoResultsError(message);
        const retryDelay = Math.min(
          30_000,
          2_000 * (2 ** Math.min(autoResultsRetryAttempt, 4)),
        );
        automaticResultsRetryTimerRef.current = setTimeout(() => {
          if (automaticResultsUpdateKeyRef.current === updateKey) {
            setAutoResultsRetryAttempt((current) => current + 1);
          }
        }, retryDelay);
      } finally {
        if (automaticResultsUpdateKeyRef.current === updateKey) {
          setAutoResultsPending(false);
        }
      }
    })();
  }, [
    account,
    autoResultsCategoryId,
    autoResultsRetryAttempt,
    autoResultsVersion,
    canManageResults,
    refetchSelectedResults,
    resultActionPending,
    selectedRunInputDigest,
    shouldAutomaticallyUpdateResults,
  ]);

  useEffect(() => {
    if (!selectedEvent || raceDayQuery.isLoading) return;
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("Temporary results");
    }
  }, [activeTab, raceDayQuery.isLoading, selectedEvent, visibleTabs]);

  if (!account?.hasOrganizerAccess) {
    return (
      <div className="p-6 lg:p-8">
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Sign in with an organizer account to access race-day operations.
        </div>
      </div>
    );
  }

  if (requestedEditionId && !eventsQuery.isPlaceholderData && !eventsQuery.isLoading && !selectedEvent) {
    return <div role="alert" className="p-6 text-sm">{t(eventsQuery.isError ? "results.loadFailed" : "results.eventUnavailable")}</div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <ScrollReveal>
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">Race results</h1>
              {practiceOnly ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                  Test
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedEvent?.name ?? raceDayQuery.data?.edition.name ?? "Select a race"}
              {raceDayQuery.data?.edition.startDate ? ` · ${raceDayQuery.data.edition.startDate}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeTab === "Control points" ? (
              <div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
                isOnline
                  ? "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent"
                  : "bg-trail-amber/10 text-trail-amber"
              }`}>
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {isOnline ? "Online" : "Offline capture"}
              </div>
            ) : null}
            {activeTab === "Control points" && queuedPunchCount ? (
              <button
                type="button"
                onClick={() => void syncQueuedPunches(true)}
                disabled={!isOnline || syncingQueue}
                className="flex items-center gap-2 rounded-full bg-trail-amber/10 px-3 py-2 text-xs font-semibold text-trail-amber disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingQueue ? "animate-spin" : ""}`} />
                {queuedPunchCount} queued
              </button>
            ) : null}
            <div
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                raceStatus === "running"
                  ? "timing-lime-pill"
                  : raceStatus === "finished"
                  ? "bg-muted text-muted-foreground"
                  : "bg-trail-amber/10 text-trail-amber"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              {activeTab !== "Control points" && resultsQuery.isLoading
                ? t("results.snapshotLoading")
                : raceStatus === "running" ? "Session Live" : raceStatus === "finished" ? hasFinalPublication ? "Results Published" : "Race finished · results pending" : "Ready"}
            </div>
            {activeTab === "Control points" ? (
              <LiveClock />
            ) : null}
          </div>
        </div>
      </ScrollReveal>

      {selectedEvent ? (
        <div className="mb-4">
          {practiceOnly ? (
            <RaceDayPhaseNav
              eventEditionId={selectedEvent.id}
              eventOptions={availableEvents.map((event) => ({
                id: event.id,
                name: event.name,
                isPractice: event.isPractice,
              }))}
              onEventChange={(nextEditionId) => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("edition", nextEditionId);
                  next.delete("view");
                  return next;
                });
                setSelectedCategoryId("");
                setSelectedCheckpointId("");
              }}
              activePhase="results"
              canViewOverview
              canManageEntrants={canManageEntrants}
              canManageRaceDay={canManageRaceDay}
              canEnterTiming={canEnterTiming}
              canManageResults={canManageResults}
              workspace="testing"
            />
          ) : (
            <RegistrationPhaseNav
              eventEditionId={selectedEvent.id}
              eventOptions={availableEvents.map((event) => ({ id: event.id, name: event.name }))}
              onEventChange={(nextEditionId) => {
                navigate(`/organizer/registrations/results?edition=${nextEditionId}&view=temporary`);
                setSelectedCategoryId("");
                setSelectedCheckpointId("");
              }}
              activePhase="results"
              canViewOverview={canManageEntrants || canManageRaceDay}
              canManageEvent={canManageEvent}
              eventIsFinished={eventIsFinished}
              canManageEventProtection={canManageEvent || canManageResults}
              canManageRegistrations={canManageEntrants}
              canManageFinance={canManageFinance}
              canManageCheckIn={canManageEntrants || canManageRaceDay}
              canManageTiming={!liveOperationsClosed && (canManageRaceDay || canEnterTiming)}
              canManageResults={canManageResults}
            />
          )}
        </div>
      ) : null}

      {activeTab === "Control points" ? (
      <ScrollReveal delay={0.05}>
        <div className="mb-6 flex flex-wrap items-center gap-6 rounded-2xl border border-border bg-card px-6 py-4 shadow-soft">
          <div className="text-center">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</div>
            <div className="font-display text-2xl font-bold">{selectedCategory?.name ?? "Select"}</div>
          </div>
          <div className="h-12 w-px bg-border" />
          <div className="text-center">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registrations</div>
            <div className="font-display text-2xl font-bold">{selectedCategory?.registrationCount ?? 0}</div>
          </div>
          <div className="h-12 w-px bg-border" />
          <div className="text-center">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Checked In</div>
            <div className="font-display text-2xl font-bold">{selectedCategory?.checkedInCount ?? 0}</div>
          </div>
          <div className="h-12 w-px bg-border" />
          <div className="text-center">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unresolved</div>
            <div className="font-display text-2xl font-bold">{selectedCategoryUnresolvedPunches.length}</div>
          </div>
          <div className="ml-auto flex gap-2">
            {activeSession ? (
              <button
                onClick={handleCloseSession}
                disabled={sessionActionPending}
                className="flex items-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-destructive/90 disabled:opacity-70"
              >
                {sessionActionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                Close Session
              </button>
            ) : (
              <button
                onClick={handleOpenSession}
                disabled={sessionActionPending || !selectedCategory || !selectedCheckpoint}
                className="flex items-center gap-2 rounded-xl bg-trail-green px-5 py-2.5 text-sm font-bold text-trail-green-foreground transition-colors hover:bg-trail-green/90 hover:text-trail-green-foreground disabled:opacity-70"
              >
                {sessionActionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Open Session
              </button>
            )}
          </div>
        </div>
      </ScrollReveal>
      ) : null}

      {activeTab !== "Official results" && canManageResults && selectedCategoryUnresolvedPunches.length ? (
        <ScrollReveal delay={0.08}>
          <div
            id="unmatched-timing-review"
            className="mb-6 rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm"
            role="alert"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">
                  Unknown timing records block publication for {selectedCategory?.name}.
                </div>
                <div className="text-muted-foreground">
                  {canManageRaceDay
                    ? "Match each time to a frozen runner who is missing this checkpoint, or dismiss the timing entry with evidence."
                    : "A race-day manager must assign or dismiss each timing entry before these results can be published."}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {selectedCategoryUnresolvedPunches.map((punch) => {
                const candidates = reconciliationCandidatesByPunchId.get(punch.id) ?? [];
                const likelyCandidate = candidates.find((candidate) => candidate.likelyBibCorrection);
                const selectedCandidate = candidates.find((candidate) => (
                  candidate.registrationId === punchResolutionRegistration[punch.id]
                ));
                const enteredBib = punch.bibNumber ?? "?";

                return <div key={punch.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono font-bold">Bib {punch.bibNumber ?? "?"} · {punch.checkpointName}</div>
                      <div className="mt-1 font-mono text-xs">
                        <LocalRelativeTimePair
                          recordedAt={punch.recordedAt}
                          elapsedTimeMs={elapsedTimeForPunch(punch)}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{punch.categoryName}</span>
                  </div>
                  <div className="mt-2 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
                    Only runners with no recorded time at {punch.checkpointName} are available.
                    {likelyCandidate ? (
                      <span className="ml-1 font-semibold text-foreground">
                        Likely correction: entered #{enteredBib} → #{likelyCandidate.bibNumber} {likelyCandidate.displayName}.
                      </span>
                    ) : null}
                  </div>
                  {canManageRaceDay ? <div className="mt-3 grid gap-2 md:grid-cols-[1fr,1fr,auto,auto]">
                    <select
                      value={punchResolutionRegistration[punch.id] ?? ""}
                      onChange={(event) => {
                        const registrationId = event.target.value;
                        const candidate = candidates.find((item) => item.registrationId === registrationId);
                        setPunchResolutionRegistration((current) => ({
                          ...current,
                          [punch.id]: registrationId,
                        }));
                        if (candidate) {
                          setPunchResolutionNote((current) => current[punch.id]?.trim()
                            ? current
                            : {
                                ...current,
                                [punch.id]: `Entered bib ${enteredBib} corrected to ${candidate.bibNumber}; ${candidate.displayName} was missing ${punch.checkpointName}.`,
                              });
                        }
                      }}
                      aria-label={`Runner missing ${punch.checkpointName} for entered bib ${enteredBib}`}
                      className="h-10 rounded-md border border-input bg-background px-3 text-xs"
                    >
                      <option value="">Choose runner missing {punch.checkpointName}</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.registrationId} value={candidate.registrationId}>
                          {candidate.likelyBibCorrection ? "Likely match · " : ""}
                          #{candidate.bibNumber} · {candidate.displayName} · {formatParticipationStatus(candidate.participationStatus)}
                        </option>
                      ))}
                    </select>
                    <input
                      value={punchResolutionNote[punch.id] ?? ""}
                      onChange={(event) => setPunchResolutionNote((current) => ({
                        ...current,
                        [punch.id]: event.target.value,
                      }))}
                      placeholder="Evidence / reason"
                      className="h-10 rounded-md border border-input bg-background px-3 text-xs"
                    />
                    <button
                      onClick={() => void handlePunchRevision(punch.id, "resolve_registration")}
                      disabled={
                        reviewActionId === punch.id
                        || !selectedCandidate
                        || !punchResolutionNote[punch.id]?.trim()
                      }
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
                    >
                      Assign checkpoint time
                    </button>
                    <button
                      onClick={() => void handlePunchRevision(punch.id, "void")}
                      disabled={reviewActionId === punch.id}
                      className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-bold text-destructive disabled:opacity-60"
                    >
                      Dismiss timing entry
                    </button>
                  </div> : null}
                  {selectedCandidate ? (
                    <p className="mt-2 text-xs font-semibold text-foreground" role="status">
                      Ready to assign the {formatRecordedTime(punch.recordedAt)} time at {punch.checkpointName} to #{selectedCandidate.bibNumber} {selectedCandidate.displayName}. This runner currently has no time at this checkpoint.
                    </p>
                  ) : null}
                </div>;
              })}
            </div>
          </div>
        </ScrollReveal>
      ) : null}

      {!routeEventId ? <div className="mb-4 flex max-w-full gap-1 overflow-x-auto border-b border-border pb-2">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.set(
                  "view",
                  tab === "Official results" ? "official" : "temporary",
                );
                return next;
              });
            }}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div> : null}

      {activeTab === "Control points" ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-2">
            <div>
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Category</div>
              <div className="grid gap-2">
                {accessibleCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setSelectedCheckpointId(category.checkpoints[0]?.id ?? "");
                    }}
                    className={`rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-all ${
                      selectedCategory?.id === category.id
                        ? "bg-primary text-primary-foreground shadow-glow"
                        : "border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Checkpoint</div>
              <div className="grid grid-cols-2 gap-2">
                {selectedCategory?.checkpoints.map((checkpoint) => (
                  <button
                    key={checkpoint.id}
                    onClick={() => setSelectedCheckpointId(checkpoint.id)}
                    className={`rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-all ${
                      selectedCheckpoint?.id === checkpoint.id
                        ? "bg-primary text-primary-foreground shadow-glow"
                        : "border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {checkpoint.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-primary/20 bg-card p-4 shadow-warm sm:p-6">
              <div className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Enter Bib · {selectedCheckpoint?.name ?? "Checkpoint"}
              </div>
              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                value={bibInput}
                onChange={(event) =>
                  setBibInput(event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handlePunchSubmit();
                  }
                }}
                placeholder="BIB #"
                className="h-20 w-full rounded-xl border-2 border-border bg-background px-3 text-center font-mono text-4xl font-bold text-foreground placeholder:text-muted-foreground/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all sm:h-24 sm:px-4 sm:text-5xl"
                autoComplete="off"
                disabled={!activeSession}
              />
              <button
                onClick={() => void handlePunchSubmit()}
                disabled={!activeSession || !bibInput.trim()}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-glow transition-all duration-200 hover:bg-primary/90 disabled:opacity-70"
              >
                <CheckCircle className="h-5 w-5" />
                Record Time
              </button>
              {pendingPunchCount ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-primary" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {pendingPunchCount} timing entr{pendingPunchCount === 1 ? "y" : "ies"} saving in the background
                </p>
              ) : null}
              <TimingEntryAlerts alerts={entryAlerts} onDismiss={dismissEntryAlert} />
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent Punches</h2>
              <span className="text-xs text-muted-foreground">{recentPunches.length} total</span>
            </div>
            <div className="max-h-[600px] space-y-1.5 overflow-y-auto pr-1">
              {recentPunches.slice(0, 20).map((punch) => (
                <div
                  key={punch.id}
                  className={`flex items-center gap-4 rounded-xl px-5 py-3.5 font-mono text-sm ${
                    punch.warnings.length
                      ? "border border-destructive/15 bg-destructive/5"
                      : "border border-border bg-card shadow-soft"
                  }`}
                >
                  <span className="w-16 text-right font-display text-xl font-bold text-foreground">
                    #{punch.bibNumber ?? "?"}
                  </span>
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {punch.checkpointName}
                    {punch.athleteName ? ` · ${punch.athleteName}` : ""}
                  </span>
                  <span className="text-right font-mono text-xs">
                    <LocalRelativeTimePair
                      recordedAt={punch.recordedAt}
                      elapsedTimeMs={elapsedTimeForPunch(punch)}
                      localClassName="text-primary"
                    />
                  </span>
                  {punch.warnings.length ? (
                    <span className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">
                      <AlertTriangle className="h-3 w-3" /> WARN
                    </span>
                  ) : (
                    <CheckCircle className="h-4 w-4 text-primary dark:text-accent" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "Temporary results" ? (
        <div>
          {/* Imported snapshots protect result editing, not the race lifecycle. */}
          {accessibleCategories.length > 0 && resultsQuery.data ? (
            <p role="status" className="mb-4 text-sm font-medium text-muted-foreground">
              {t("race.finishOverride.progressSummary", {
                finished: accessibleCategories.filter((category) => ["completed", "closed"].includes(category.status)).length,
                total: accessibleCategories.length,
                remaining: accessibleCategories.filter((category) => !["completed", "closed"].includes(category.status)).length,
              })}
            </p>
          ) : null}
          {canManageRaceDay && editionId && selectedCategoryId && resultsQuery.data ? (
            <div className="mb-4 flex justify-end">
              <RaceFinishOverrideButton
                key={`${editionId}:${selectedCategoryId}`}
                eventEditionId={editionId}
                categoryId={selectedCategoryId}
                disabled={resultActionPending || sessionActionPending}
                onFinished={refreshAll}
              />
            </div>
          ) : null}
          {importedSnapshot && resultsQuery.data ? (
            <ImportedResultsNotice snapshot={resultsQuery.data} />
          ) : closedWithoutResults ? (
            <p role="status" className="mb-5 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              {t("race.finishOverride.closedWithoutResults")}
            </p>
          ) : !resultsQuery.data?.selectedRun ? (
            <p role={resultsQuery.isError ? "alert" : "status"} className="mb-4 rounded-xl border border-border p-4 text-sm text-muted-foreground">
              {t(resultsQuery.isError ? "results.loadFailed" : resultsQuery.isLoading ? "results.snapshotLoading" : "results.noSnapshot")}
            </p>
          ) : <TemporaryResultsReviewWorkflow
            snapshotCompletedAt={resultsQuery.data?.selectedRun?.completedAt ?? null}
            summary={reviewSummary}
          >
            <TemporaryResultsReviewActions
              publishPending={resultActionPending}
              publishDisabled={publishDisabled}
              publishLabel={publishActionLabel}
              correctionNoteValue={publicationState === "corrected" ? publicationChangeNote : undefined}
              summary={reviewSummary}
              onCorrectionNoteChange={publicationState === "corrected" ? setPublicationChangeNote : undefined}
              onPublish={() => void handlePublish()}
            />
          </TemporaryResultsReviewWorkflow>}
          <div className={useProminentTemporaryRaceSelector
            ? "mb-5 rounded-2xl border-2 border-primary/20 bg-primary/[0.04] p-3 shadow-warm sm:p-4"
            : "mb-3 flex flex-col gap-2 sm:flex-row sm:items-center"}
          >
            {useProminentTemporaryRaceSelector ? (
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Select race</p>
                  <p className="mt-1 text-xs text-muted-foreground">Choose which race results you are reviewing and editing.</p>
                </div>
                <span className="hidden rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary sm:inline-flex">
                  Required
                </span>
              </div>
            ) : null}
            <div
              className={useProminentTemporaryRaceSelector
                ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
                : "flex gap-1.5"}
              role="group"
              aria-label="Select race for temporary results"
            >
              {accessibleCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selectedCategory?.id === category.id}
                  aria-label={category.name}
                  onClick={() => setSelectedCategoryId(category.id)}
                  className={useProminentTemporaryRaceSelector
                    ? `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full border-2 px-5 py-3 text-base font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-16 sm:text-lg ${
                        selectedCategory?.id === category.id
                          ? "border-primary bg-primary text-primary-foreground shadow-glow ring-4 ring-primary/15"
                          : "border-primary/30 bg-card text-foreground shadow-sm hover:border-primary hover:bg-primary/[0.06]"
                      }`
                    : `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        selectedCategory?.id === category.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-muted"
                      }`}
                >
                  {category.name}
                  {["completed", "closed"].includes(category.status) ? (
                    <span className="ml-1 rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold">
                      {t("common.finished")}
                    </span>
                  ) : null}
                  {useProminentTemporaryRaceSelector && selectedCategory?.id === category.id ? (
                    <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
            <div className={useProminentTemporaryRaceSelector
              ? "mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-primary/10 pt-3"
              : "ml-auto flex flex-wrap items-center justify-end gap-2"}
            >
              <div className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${
                autoResultsError
                  ? "bg-destructive/10 text-destructive"
                  : autoResultsPending || resultsNeedUpdate
                    ? "bg-trail-amber/10 text-trail-amber"
                    : "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent"
              }`} aria-live="polite" title={autoResultsError ?? undefined}>
                {autoResultsPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {importedSnapshot
                  ? t("results.imported.preserved")
                  : autoResultsPending
                  ? "Updating temporary results automatically…"
                  : autoResultsError
                    ? "Automatic update failed · retrying"
                    : resultsNeedUpdate
                      ? "Race data changed · updating automatically"
                      : autoResultsUpdatedAt
                        ? `Current · ${autoResultsUpdatedAt.toLocaleTimeString("en-GB")}`
                        : resultsQuery.data?.selectedRun?.completedAt
                          ? `Current · ${new Date(resultsQuery.data.selectedRun.completedAt).toLocaleTimeString("en-GB")}`
                          : autoResultsVersion
                            ? "Calculating temporary results automatically"
                            : closedWithoutResults
                              ? t("race.finishOverride.closed")
                              : "Waiting for race start"}
              </div>
              <button className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-xs font-medium transition-colors hover:bg-muted">
                <FileDown className="h-3.5 w-3.5" /> Export
              </button>
            </div>
          </div>

          {anomalies.length ? (
            <ResultAnomalyReview
              key={selectedCategory?.id}
              anomalies={anomalies}
              noteValues={anomalyResolutionNote}
              pendingId={reviewActionId}
              acknowledgePending={reviewActionId === "acknowledge-all"}
              canAcknowledge={Boolean(
                resultEditingUnlocked
                && reviewSummary.acknowledgeableAnomalies.length
              )}
              onAcknowledgeAll={() => void handleAcknowledgeAll()}
              onNoteChange={(anomalyId, value) => setAnomalyResolutionNote((current) => ({
                ...current,
                [anomalyId]: value,
              }))}
              onResolve={(anomalyId, state) => void handleAnomalyResolution(anomalyId, state)}
            />
          ) : null}

          <section className="mb-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold">Complaints</h3>
                <p className="text-[10px] text-muted-foreground">
                  {complaints.length
                    ? `${openComplaints.length} open · ${complaints.length} total`
                    : "No complaints recorded"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComplaintFormOpen((current) => !current)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Add complaint
              </button>
            </div>

            {complaintFormOpen ? (
              <div className="mt-3 grid gap-2.5 rounded-lg border border-border bg-background p-3 md:grid-cols-[1fr,140px]">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Complainant
                  </span>
                  <input
                    value={complainantName}
                    onChange={(event) => setComplainantName(event.target.value)}
                    placeholder="Name"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Bib
                  </span>
                  <input
                    value={complaintBib}
                    onChange={(event) => setComplaintBib(event.target.value)}
                    placeholder="Optional"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Complaint
                  </span>
                  <textarea
                    value={complaintText}
                    onChange={(event) => setComplaintText(event.target.value)}
                    placeholder="What needs review?"
                    rows={3}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex justify-end gap-2 md:col-span-2">
                  <button
                    type="button"
                    onClick={() => setComplaintFormOpen(false)}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateComplaint()}
                    disabled={resultActionPending}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {resultActionPending ? "Adding…" : "Add complaint"}
                  </button>
                </div>
              </div>
            ) : null}

            {complaints.length ? (
              <div className="mt-3 space-y-1.5">
                {complaints.map((complaint) => (
                  <div
                    key={complaint.id}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">
                          {complaint.complainantName}
                          {complaint.bibNumber ? ` · Bib ${complaint.bibNumber}` : ""}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {complaint.complaintText}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${
                        complaint.status === "open"
                          ? "bg-trail-amber/10 text-trail-amber"
                          : "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent"
                      }`}>
                        {complaint.status}
                      </span>
                    </div>
                    {complaint.status === "open" ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-[1fr,auto,auto]">
                        <input
                          value={complaintResolutionNote[complaint.id] ?? ""}
                          onChange={(event) => setComplaintResolutionNote((current) => ({
                            ...current,
                            [complaint.id]: event.target.value,
                          }))}
                          placeholder="Resolution note"
                          className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleResolveComplaint(complaint.id, "resolved")}
                          disabled={reviewActionId === complaint.id}
                          className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResolveComplaint(complaint.id, "dismissed")}
                          disabled={reviewActionId === complaint.id}
                          className="rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-60"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {complaint.resolutionNote}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {rankingConfig ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-soft sm:px-4">
              <div className="mr-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Official Rankings</div>
              <div className="flex flex-wrap gap-1.5">
                {rankingLabels({
                  sexEnabled: rankingConfig.sex.enabled,
                  sexLabels: rankingConfig.sex.buckets.map((bucket) => bucket.label),
                  teamEnabled: rankingConfig.team.enabled,
                  teamLabel: rankingConfig.team.label,
                }).map((label) => (
                  <span key={label} className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-primary">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-3">
            <OrganizerResultBoardTabs
              clubCount={teamStandings.length}
              value={resultBoardView}
              onChange={setResultBoardView}
            />
          </div>

          {resultBoardView === "individual" ? (
            <>
              <StaggerContainer className="mb-4 grid gap-3 sm:grid-cols-3" stagger={0.08}>
                {resultRows.slice(0, 3).map((row, index) => {
                  const clubName = normalizePublicResultClubName(row.clubName);
                  const styles = [
                    "from-trail-amber/20 to-trail-amber/5 border-trail-amber/20",
                    "from-muted to-muted/50 border-border",
                    "from-trail-orange/15 to-trail-orange/5 border-trail-orange/20",
                  ];
                  return (
                    <StaggerItem key={row.id}>
                      <div className={`rounded-xl border bg-gradient-to-br p-4 shadow-soft ${styles[index] ?? styles[1]}`}>
                        <div className="mb-2 flex items-center gap-2.5">
                          <span className="text-2xl">{index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}</span>
                          <div>
                            <div className="font-display font-bold">{row.athleteName}</div>
                            <div className="text-xs text-muted-foreground">
                              {clubName ? `${clubName} · ` : ""}Bib #{row.bibNumber ?? "?"}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-2 text-center">
                          <div>
                            <div className="font-mono text-lg font-bold text-primary">{formatElapsed(row.finishTimeMs)}</div>
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Finish Time</div>
                          </div>
                          <div>
                            <div className="font-display text-lg font-bold text-trail-amber">{row.rankOverall ?? "-"}</div>
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Rank</div>
                          </div>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>

              <ResultsEntriesTable
                snapshot={resultsQuery.data}
                label="Temporary results entries"
                emptyMessage={closedWithoutResults ? t("race.finishOverride.closedWithoutResults") : undefined}
                onCorrect={canManageResults && canEditResultSnapshot ? setCorrectionRow : undefined}
              />
            </>
          ) : (
            <OrganizerClubResultsBoard
              label="Temporary"
              scoringCount={rankingConfig?.team.scoringCount ?? 3}
              standings={teamStandings}
            />
          )}
        </div>
      ) : null}

      {activeTab === "Official results" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6">
          {officialResultsUnconfirmed ? (
            <p role={officialResultsReadFailed ? "alert" : "status"} className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
              {t(officialResultsReadFailed ? "results.loadFailed" : "results.snapshotLoading")}
            </p>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-bold">
                    {resultsQuery.data?.publication?.publicationState
                      ? `${formatPublicationStateLabel(resultsQuery.data.publication.publicationState as ResultsPublicationState)} results`
                      : "Final results not published"}
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  {resultsQuery.data?.publication?.publishedAt
                    ? `Published ${new Date(resultsQuery.data.publication.publishedAt).toLocaleString("en-GB")}`
                    : "Review and edit the temporary results, then publish the reviewed run."}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                resultsQuery.data?.publication?.publicationState === "official"
                  ? "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent"
                  : "bg-muted text-muted-foreground"
              }`}>
                {resultsQuery.data?.publication?.publicationState ?? "not published"}
              </span>
            </div>
          )}
            {accessibleCategories.length > 1 ? (
              <div className="mt-5 border-t border-border/70 pt-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Race category
                </p>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Switch race category"
                >
                  {accessibleCategories.map((category) => {
                    const isSelected = selectedCategory?.id === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedCategoryId(category.id)}
                        className={`inline-flex min-h-9 items-center rounded-full border px-4 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-secondary"
                        }`}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!officialResultsUnconfirmed ? <><div className="mt-5 border-t border-border/70 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Results view
              </p>
              <OrganizerResultBoardTabs
                clubCount={officialTeamStandings.length}
                value={resultBoardView}
                onChange={setResultBoardView}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {selectedEvent?.isPractice
                  ? "Practice publications stay private and are visible only in this testing workspace."
                  : "The public table and runner result links use this reviewed, published result run."}
              </p>
              {selectedEvent?.isPractice ? (
                <Link
                  to={`/organizer/testing/results?edition=${selectedEvent.id}&view=temporary`}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-secondary"
                >
                  Review practice results <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : selectedEvent?.slug && resultsQuery.data?.publication ? (
                <Link
                  to={`/events/${selectedEvent.slug}?tab=results`}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-secondary"
                >
                  Open public results <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : selectedEvent ? (
                <Link
                  to={`/organizer/registrations/results?edition=${selectedEvent.id}&view=temporary`}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open Result admin
                </Link>
              ) : null}
            </div>
            </> : null}
          </div>
          {officialResultsUnconfirmed ? null : resultBoardView === "individual" ? (
            <ResultsEntriesTable
              snapshot={officialResultsSnapshot}
              label="Official results entries"
              onCorrect={canManageResults && canEditResultSnapshot ? setCorrectionRow : undefined}
            />
          ) : (
            <OrganizerClubResultsBoard
              label="Official"
              scoringCount={officialResultsSnapshot?.category.rankingConfig.team.scoringCount ?? 3}
              standings={officialTeamStandings}
            />
          )}
        </div>
      ) : null}

      <ResultCorrectionDialog
        row={correctionRow}
        punches={correctionPunches}
        checkpoints={resultsQuery.data?.checkpoints ?? []}
        open={Boolean(correctionRow)}
        onClose={() => setCorrectionRow(null)}
        onCorrected={handleResultCorrectionApplied}
      />
    </div>
  );
}
