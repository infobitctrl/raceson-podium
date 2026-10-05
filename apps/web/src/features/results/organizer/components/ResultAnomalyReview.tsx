import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { OrganizerCategoryResults } from "@/lib/organizer-management";
import { cn } from "@/lib/utils";

type ResultAnomaly = OrganizerCategoryResults["anomalies"][number];
type AnomalyReviewView = "open" | "closed";

function anomalyStateLabel(state: ResultAnomaly["state"]) {
  if (state === "resolved") return "Accepted";
  if (state === "waived") return "Dismissed";
  return "Open";
}

export default function ResultAnomalyReview({
  anomalies,
  noteValues,
  pendingId,
  acknowledgePending,
  canAcknowledge,
  onAcknowledgeAll,
  onNoteChange,
  onResolve,
}: {
  anomalies: ResultAnomaly[];
  noteValues: Record<string, string>;
  pendingId: string | null;
  acknowledgePending: boolean;
  canAcknowledge: boolean;
  onAcknowledgeAll: () => void;
  onNoteChange: (anomalyId: string, value: string) => void;
  onResolve: (anomalyId: string, state: "resolved" | "waived") => void;
}) {
  const [view, setView] = useState<AnomalyReviewView>("open");
  const { closedAnomalies, openAnomalies, openBlockingCount } = useMemo(() => {
    const open = anomalies.filter((anomaly) => anomaly.state === "open");
    return {
      openAnomalies: open,
      closedAnomalies: anomalies.filter((anomaly) => anomaly.state !== "open"),
      openBlockingCount: open.filter((anomaly) => (
        anomaly.severity === "error" || anomaly.severity === "critical"
      )).length,
    };
  }, [anomalies]);
  const visibleAnomalies = view === "open" ? openAnomalies : closedAnomalies;

  return (
    <section aria-labelledby="result-anomaly-review-title" className="mb-3 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            openBlockingCount
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent",
          )}>
            {openBlockingCount
              ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <h3 id="result-anomaly-review-title" className="truncate font-display text-sm font-bold">Result anomaly review</h3>
            <p className="text-[10px] text-muted-foreground">
              {openBlockingCount} blocking · {openAnomalies.length} open · {closedAnomalies.length} closed
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onAcknowledgeAll}
            disabled={!canAcknowledge || acknowledgePending}
            title={canAcknowledge ? "Acknowledge every open review flag" : "No open review flags need acknowledgement"}
            className={cn(
              "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
              canAcknowledge
                ? "border-trail-orange bg-trail-orange text-white shadow-warm ring-2 ring-trail-orange/20 hover:bg-trail-orange/90"
                : "border-border bg-muted text-muted-foreground opacity-60",
            )}
          >
            {acknowledgePending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Acknowledge all
          </button>
          <span className={cn(
            "rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider",
            openBlockingCount
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary dark:bg-accent/10 dark:text-accent",
          )}>
            {openBlockingCount ? "publication blocked" : "review clear"}
          </span>
        </div>
      </div>

      <div className="border-b border-border px-3 pt-2 sm:px-4" role="tablist" aria-label="Result anomaly status">
        {([
          { id: "open" as const, label: "Open issues", count: openAnomalies.length },
          { id: "closed" as const, label: "Closed issues", count: closedAnomalies.length },
        ]).map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={view === option.id}
            onClick={() => setView(option.id)}
            className={cn(
              "mr-1 inline-flex min-h-9 items-center gap-1.5 border-b-2 px-2.5 text-xs font-bold transition-colors",
              view === option.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
              {option.count}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5 p-2.5 sm:p-3" role="tabpanel" aria-label={view === "open" ? "Open issues" : "Closed issues"}>
        {visibleAnomalies.length ? visibleAnomalies.map((anomaly) => (
          <article key={anomaly.id} className="rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-5 text-foreground">{anomaly.message}</p>
                <p className="font-mono text-[9px] uppercase text-muted-foreground">
                  {anomaly.code.replaceAll("_", " ")} · {anomaly.severity}
                </p>
              </div>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase",
                anomaly.state === "open"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}>
                {anomalyStateLabel(anomaly.state)}
              </span>
            </div>
            {anomaly.state === "open" && anomaly.code === "unresolved_timing_event" ? (
              <div className="mt-2 rounded-md bg-destructive/5 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">
                This issue requires a timing correction. Accepting or dismissing the notification would not attach the checkpoint time to a runner.
                <a
                  href="#unmatched-timing-review"
                  className="ml-1 font-bold text-primary underline-offset-2 hover:underline"
                >
                  Open timing reconciliation
                </a>
              </div>
            ) : anomaly.state === "open" ? (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  value={noteValues[anomaly.id] ?? ""}
                  onChange={(event) => onNoteChange(anomaly.id, event.target.value)}
                  aria-label={`Decision note for ${anomaly.message}`}
                  placeholder="Evidence or dismissal reason"
                  className="h-8 min-w-0 rounded-md border border-input bg-background px-2.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => onResolve(anomaly.id, "resolved")}
                  disabled={pendingId === anomaly.id}
                  className="min-h-8 rounded-md bg-primary px-3 text-[10px] font-bold text-primary-foreground disabled:opacity-60"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onResolve(anomaly.id, "waived")}
                  disabled={pendingId === anomaly.id}
                  className="min-h-8 rounded-md border border-border px-3 text-[10px] font-bold disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            ) : anomaly.resolutionNote ? (
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{anomaly.resolutionNote}</p>
            ) : null}
          </article>
        )) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {view === "open"
              ? "No open issues. Accepted and dismissed items are stored under Closed issues."
              : "No issues have been accepted or dismissed yet."}
          </p>
        )}
      </div>
    </section>
  );
}
