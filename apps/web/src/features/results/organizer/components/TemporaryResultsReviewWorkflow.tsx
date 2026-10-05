import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Loader2,
  LockKeyhole,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatParticipationStatus,
  type UnfinishedResultParticipant,
} from "@/features/results/organizer/model/resultReview";

type ReviewSummary = {
  totalCount: number;
  finisherCount: number;
  openReviewFlagCount: number;
  acknowledgedCount: number;
  unfinishedParticipantCount: number;
  unfinishedParticipants: UnfinishedResultParticipant[];
  unresolvedTimingCount: number;
  openComplaintCount: number;
};

const steps = [
  { id: 1, label: "Review & edit", detail: "Check temporary results and red issues" },
  { id: 2, label: "Publish final", detail: "Publish the reviewed snapshot" },
];

export function TemporaryResultsReviewWorkflow({
  children,
  snapshotCompletedAt,
  summary,
}: {
  children?: ReactNode;
  snapshotCompletedAt: string | null;
  summary: ReviewSummary;
}) {
  const currentStep = summary.unresolvedTimingCount
    || summary.openComplaintCount
    || summary.openReviewFlagCount
    || summary.unfinishedParticipantCount
    ? 1
    : 2;
  const stats = [
    {
      label: "Finishers",
      value: `${summary.finisherCount}/${summary.totalCount}`,
      icon: Flag,
      tone: "text-foreground",
    },
    {
      label: "Review flags",
      value: summary.openReviewFlagCount,
      icon: AlertTriangle,
      tone: summary.openReviewFlagCount ? "text-destructive" : "text-primary dark:text-accent",
    },
    {
      label: "Unfinished",
      value: summary.unfinishedParticipantCount,
      icon: LockKeyhole,
      tone: summary.unfinishedParticipantCount ? "text-destructive" : "text-primary dark:text-accent",
    },
    {
      label: "Acknowledged",
      value: summary.acknowledgedCount,
      icon: ClipboardCheck,
      tone: "text-primary dark:text-accent",
    },
  ];

  return (
    <section aria-labelledby="temporary-review-title" className="mb-3 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <h2 id="temporary-review-title" className="font-display text-sm font-bold">Temporary results snapshot</h2>
          <p className="text-[10px] text-muted-foreground">
            Saved result version for review. A newer draft does not replace the public official results until publication.
          </p>
        </div>
        {snapshotCompletedAt ? (
          <span className="mt-2 text-[10px] font-semibold text-muted-foreground sm:mt-0">
            Saved {new Date(snapshotCompletedAt).toLocaleString("en-GB")}
          </span>
        ) : null}
      </div>
      {children ? (
        <div className="border-b border-border p-2.5 sm:px-3">
          {children}
        </div>
      ) : null}
      <div className="grid border-b border-border md:grid-cols-2">
        {steps.map((step, index) => {
          const active = step.id === currentStep;
          const complete = step.id < currentStep;
          return (
            <div
              key={step.id}
              className={cn(
                "relative flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0",
                active && "bg-primary/[0.045]",
              )}
            >
              <span className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-black",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : complete
                    ? "border-primary bg-primary/10 text-primary dark:border-accent dark:bg-accent/10 dark:text-accent"
                    : "border-border bg-background text-muted-foreground",
              )}>
                {complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : step.id}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-foreground">{step.label}</span>
                <span className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">{step.detail}</span>
              </span>
              {index < steps.length - 1 ? (
                <span className="absolute -right-px top-1/2 hidden h-px w-4 -translate-y-1/2 bg-border md:block" aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>

      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 items-center gap-2 px-3 py-2.5">
            <stat.icon className={cn("h-3.5 w-3.5 shrink-0", stat.tone)} aria-hidden="true" />
            <div className="min-w-0">
              <dt className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</dt>
              <dd className={cn("font-display text-base font-black tabular-nums", stat.tone)}>{stat.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TemporaryResultsReviewActions({
  publishPending,
  publishDisabled,
  publishLabel,
  correctionNoteValue,
  summary,
  onCorrectionNoteChange,
  onPublish,
}: {
  publishPending: boolean;
  publishDisabled: boolean;
  publishLabel: string;
  correctionNoteValue?: string;
  summary: ReviewSummary;
  onCorrectionNoteChange?: (value: string) => void;
  onPublish: () => void;
}) {
  const blockerParts = [
    summary.unfinishedParticipantCount
      ? `${summary.unfinishedParticipantCount} unfinished participant${summary.unfinishedParticipantCount === 1 ? "" : "s"}`
      : null,
    summary.unresolvedTimingCount
      ? `${summary.unresolvedTimingCount} unmatched timing entr${summary.unresolvedTimingCount === 1 ? "y" : "ies"}`
      : null,
    summary.openComplaintCount
      ? `${summary.openComplaintCount} open complaint${summary.openComplaintCount === 1 ? "" : "s"}`
      : null,
    summary.openReviewFlagCount
      ? `${summary.openReviewFlagCount} review flag${summary.openReviewFlagCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <section
      aria-label="Final result review actions"
      className={cn(
        "grid gap-2 lg:items-end",
        correctionNoteValue !== undefined && onCorrectionNoteChange
          ? "lg:grid-cols-[minmax(0,1fr)_16rem_auto]"
          : "lg:grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <div className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg px-3 py-2 text-xs",
        blockerParts.length
          ? "bg-destructive/8 text-destructive"
          : "bg-primary/8 text-primary dark:bg-accent/8 dark:text-accent",
      )}>
        {blockerParts.length
          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <div className="font-bold">
            {blockerParts.length ? blockerParts.join(" · ") : "Temporary result review is clear"}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 opacity-80">
            {summary.unfinishedParticipantCount
              ? "Set every participant below to Finished, DNS, DNF, or DSQ before publishing final results."
              : summary.unresolvedTimingCount || summary.openComplaintCount
                ? "Final publication is blocked until unmatched timing and complaints are resolved."
              : summary.openReviewFlagCount
                ? "Acknowledge reviewed flags before final publication."
                : "This result run is ready for final publication."}
          </div>
          {summary.unfinishedParticipants.length ? (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="Participants blocking final publication">
              {summary.unfinishedParticipants.map((participant) => (
                <li
                  key={participant.registrationId}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-destructive/15 bg-background/70 px-2 py-1"
                >
                  <span className="min-w-0 truncate font-semibold text-foreground">
                    {participant.bibNumber ? `#${participant.bibNumber} · ` : ""}{participant.athleteName}
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-destructive">
                    {formatParticipationStatus(participant.participationStatus)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {correctionNoteValue !== undefined && onCorrectionNoteChange ? (
        <label className="block min-w-0">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Correction note <span className="font-medium normal-case tracking-normal">(optional)</span>
          </span>
          <input
            value={correctionNoteValue}
            onChange={(event) => onCorrectionNoteChange(event.target.value)}
            placeholder="Optional note about what changed"
          className="min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
          />
        </label>
      ) : null}
      <div className="lg:shrink-0">
        <button
          type="button"
          onClick={onPublish}
          disabled={publishDisabled || publishPending}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground shadow-warm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishPending
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : publishDisabled
              ? <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              : <Trophy className="h-4 w-4" aria-hidden="true" />}
          {publishLabel}
        </button>
      </div>
    </section>
  );
}
