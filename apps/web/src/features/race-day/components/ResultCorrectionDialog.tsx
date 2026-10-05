import { useEffect, useMemo, useState } from "react";
import { Calculator, Clock3, Loader2, ShieldCheck, TableProperties } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  OrganizerCategoryResults,
  OrganizerRaceDayState,
} from "@/lib/organizer-management";
import {
  createManualResultTimingObservation,
  recordParticipantStatus,
  revisePunchEvent,
  type ParticipationState,
} from "@/lib/race-control";

type ResultRow = OrganizerCategoryResults["rows"][number];
type RaceDayPunch = OrganizerRaceDayState["recentPunches"][number];
type ResultCheckpoint = OrganizerCategoryResults["checkpoints"][number];

const editableParticipantStatuses = [
  "not_started",
  "checked_in",
  "started",
  "finished",
  "dns",
  "dnf",
  "dsq",
  "withdrawn",
  "stopped",
  "evacuated",
  "missing",
] as const satisfies readonly ParticipationState[];
const editableParticipantStatusSet = new Set<ParticipationState>(editableParticipantStatuses);

function effectiveParticipantStatus(row: ResultRow | null): ParticipationState {
  const savedStatus = row?.participationStatus;
  if (savedStatus && editableParticipantStatusSet.has(savedStatus as ParticipationState)) {
    return savedStatus as ParticipationState;
  }
  return row?.finishTimeMs != null ? "finished" : "not_started";
}

function formatParticipantStatus(value: ParticipationState) {
  if (value === "dnf" || value === "dns" || value === "dsq") return value.toUpperCase();
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function datetimeLocalValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19);
}

function formatElapsed(value: number | null) {
  if (value == null) return "—";
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ResultCorrectionDialog({
  row,
  punches,
  checkpoints,
  open,
  onClose,
  onCorrected,
}: {
  row: ResultRow | null;
  punches: RaceDayPunch[];
  checkpoints: ResultCheckpoint[];
  open: boolean;
  onClose: () => void;
  onCorrected: () => Promise<void>;
}) {
  const matchingPunches = useMemo(
    () => punches.filter((punch) => punch.registrationId === row?.registrationId),
    [punches, row?.registrationId],
  );
  const matchingPunchByCheckpoint = useMemo(
    () => new Map(matchingPunches.map((punch) => [punch.checkpointId, punch])),
    [matchingPunches],
  );
  const editableCheckpoints = useMemo(
    () => checkpoints
      .filter((checkpoint) => (
        checkpoint.checkpointType !== "start"
        || matchingPunchByCheckpoint.has(checkpoint.id)
      ))
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
    [checkpoints, matchingPunchByCheckpoint],
  );
  const savedParticipantStatus = effectiveParticipantStatus(row);
  const [correctedTimes, setCorrectedTimes] = useState<Record<string, string>>({});
  const [timingReason, setTimingReason] = useState("");
  const [participantStatus, setParticipantStatus] = useState<ParticipationState>("finished");
  const [participantReason, setParticipantReason] = useState("");
  const [workingAction, setWorkingAction] = useState<"time" | "status" | null>(null);

  useEffect(() => {
    setCorrectedTimes(Object.fromEntries(
      editableCheckpoints.map((checkpoint) => [
        checkpoint.id,
        matchingPunchByCheckpoint.has(checkpoint.id)
          ? datetimeLocalValue(matchingPunchByCheckpoint.get(checkpoint.id)!.recordedAt)
          : "",
      ]),
    ));
    setTimingReason("");
    setParticipantStatus(savedParticipantStatus);
    setParticipantReason("");
  }, [editableCheckpoints, matchingPunchByCheckpoint, row?.id, savedParticipantStatus]);

  const participantStatusChanged = participantStatus !== savedParticipantStatus;

  async function correctTimes() {
    const changedObservations = editableCheckpoints.flatMap((checkpoint) => {
      const nextValue = correctedTimes[checkpoint.id]?.trim();
      if (!nextValue) return [];
      const punch = matchingPunchByCheckpoint.get(checkpoint.id);
      if (punch && nextValue === datetimeLocalValue(punch.recordedAt)) return [];
      return [{ checkpoint, punch, nextValue }];
    });
    if (!changedObservations.length || !timingReason.trim() || !row) {
      toast.error("Change at least one timing field and enter the correction reason.");
      return;
    }

    setWorkingAction("time");
    try {
      for (const observation of changedObservations) {
        const correctedDate = new Date(observation.nextValue);
        if (Number.isNaN(correctedDate.getTime())) {
          throw new Error(`Enter a valid time for ${observation.checkpoint.name}.`);
        }
        if (observation.punch) {
          await revisePunchEvent(observation.punch.id, {
            revisionType: "correct_time",
            reason: timingReason.trim(),
            effectiveRecordedAt: correctedDate.toISOString(),
            clientEventId: crypto.randomUUID(),
          });
        } else {
          await createManualResultTimingObservation(row.registrationId, {
            checkpointId: observation.checkpoint.id,
            recordedAt: correctedDate.toISOString(),
            reason: timingReason.trim(),
            clientEventId: crypto.randomUUID(),
          });
        }
      }
      await onCorrected();
      setTimingReason("");
      toast.success(`${changedObservations.length} timing field${changedObservations.length === 1 ? "" : "s"} saved with audit evidence.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to correct the timing observation.");
    } finally {
      setWorkingAction(null);
    }
  }

  async function correctParticipantStatus() {
    if (!row) return;
    if (!participantStatusChanged) {
      toast.error(`This participant is already marked ${formatParticipantStatus(savedParticipantStatus)}.`);
      return;
    }
    if (!participantReason.trim()) {
      toast.error("Enter the reason for the participant-status correction.");
      return;
    }
    setWorkingAction("status");
    try {
      await recordParticipantStatus(row.registrationId, {
        status: participantStatus,
        effectiveAt: new Date().toISOString(),
        reason: participantReason.trim(),
        clientEventId: crypto.randomUUID(),
        isCorrection: true,
        metadata: { source: "result_review" },
      });
      await onCorrected();
      setParticipantReason("");
      toast.success(`Participant status corrected to ${participantStatus.replaceAll("_", " ")}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to correct participant status.");
    } finally {
      setWorkingAction(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !workingAction && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Edit complete result row</DialogTitle>
          <DialogDescription>
            {row ? `${row.athleteName}${row.bibNumber ? ` · Bib ${row.bibNumber}` : ""}` : "Selected runner"}. Every editable result source is available below. Saved corrections create a new temporary result for review; published results stay unchanged until you republish them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex items-start gap-3">
              <TableProperties className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">All table fields</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Review the complete row here. Runner identity and race assignment come from the registration record; timing and participant status are corrected below.
                </p>
              </div>
            </div>
            <dl className="grid gap-3 rounded-xl bg-muted/30 p-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="font-semibold text-muted-foreground">Athlete</dt>
                <dd className="mt-1 font-medium text-foreground">{row?.athleteName ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Bib</dt>
                <dd className="mt-1 font-mono font-medium text-foreground">{row?.bibNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Club</dt>
                <dd className="mt-1 font-medium text-foreground">{row?.clubName?.trim() || "Independent"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Gender</dt>
                <dd className="mt-1 font-medium text-foreground">{row?.gender || "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Rank</dt>
                <dd className="mt-1 font-mono font-medium text-foreground">{row?.rankOverall ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Total time</dt>
                <dd className="mt-1 font-mono font-medium text-foreground">{formatElapsed(row?.finishTimeMs ?? null)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Age category</dt>
                <dd className="mt-1 font-medium text-foreground">{row?.ageGroupLabel ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">Result status</dt>
                <dd className="mt-1 font-medium text-foreground">{formatParticipantStatus(savedParticipantStatus)}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Timing observation</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Enter a missing checkpoint or finish time, or change an existing observation. Rank, elapsed time, gap and speed are recalculated automatically.
                </p>
              </div>
            </div>
            {editableCheckpoints.length ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {editableCheckpoints.map((checkpoint) => {
                    const punch = matchingPunchByCheckpoint.get(checkpoint.id);
                    return (
                      <label key={checkpoint.id} className="space-y-1.5">
                        <span className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          <span>{checkpoint.name}</span>
                          {!punch ? <span className="text-primary">Missing · enter time</span> : null}
                        </span>
                        <Input
                          aria-label={`${checkpoint.name} time`}
                          type="datetime-local"
                          step="1"
                          value={correctedTimes[checkpoint.id] ?? ""}
                          onChange={(event) => setCorrectedTimes((current) => ({
                            ...current,
                            [checkpoint.id]: event.target.value,
                          }))}
                        />
                      </label>
                    );
                  })}
                </div>
                <Input
                  aria-label="Timing correction reason"
                  value={timingReason}
                  onChange={(event) => setTimingReason(event.target.value)}
                  placeholder="Required evidence or correction reason"
                  maxLength={1000}
                />
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => void correctTimes()}
                  disabled={Boolean(workingAction) || !timingReason.trim()}
                >
                  {workingAction === "time" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changed timing fields
                </Button>
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                This race has no configured checkpoint or finish field to edit. You can still correct the participant status below.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Participant status</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Correct finish, DNS, DNF, DSQ or safety status without rewriting earlier history.
                </p>
              </div>
            </div>
            <select
              aria-label="Corrected participant status"
              value={participantStatus}
              onChange={(event) => setParticipantStatus(event.target.value as ParticipationState)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm capitalize"
            >
              {editableParticipantStatuses.map((status) => (
                <option key={status} value={status}>{formatParticipantStatus(status)}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground" role="status">
              Current temporary-result status: <span className="font-semibold text-foreground">{formatParticipantStatus(savedParticipantStatus)}</span>
            </p>
            <Input
              aria-label="Participant status correction reason"
              value={participantReason}
              onChange={(event) => setParticipantReason(event.target.value)}
              placeholder="Required operational reason"
              maxLength={1000}
            />
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void correctParticipantStatus()}
              disabled={Boolean(workingAction) || !participantReason.trim() || !participantStatusChanged}
            >
              {workingAction === "status" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save status correction
            </Button>
          </section>

          <section className="rounded-2xl border border-dashed border-border p-4">
            <div className="flex items-start gap-3">
              <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Calculated table fields</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Overall and category rank, total time, gap, split durations, points and average speed are never independently locked inputs. They recalculate from the corrected timing evidence and participant status when you save.
                </p>
              </div>
            </div>
          </section>

          <p className="text-xs leading-5 text-muted-foreground">
            Runner identity, race assignment and payment remain canonical registration fields and are changed from Full registrations.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
