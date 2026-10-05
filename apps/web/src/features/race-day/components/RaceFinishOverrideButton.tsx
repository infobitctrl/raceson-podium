import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { finishRace, getRaceStartControlState } from "@/lib/race-control";
import { useI18n } from "@/shared/i18n/I18nContext";
import { refreshRaceFinish } from "@/features/race-day/data/refreshRaceFinish";

type FinishResult = Awaited<ReturnType<typeof finishRace>>;

export function RaceFinishOverrideButton({
  eventEditionId,
  categoryId,
  scope = "race",
  disabled = false,
  onFinished,
}: {
  eventEditionId: string;
  categoryId?: string;
  scope?: "race" | "event";
  disabled?: boolean;
  onFinished?: (result: FinishResult) => void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const id = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledgeDnf, setAcknowledgeDnf] = useState(false);
  const [acknowledgeOverride, setAcknowledgeOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useRef<{ signature: string; id: string } | null>(null);
  const stateQuery = useQuery({
    queryKey: ["race-start-control", eventEditionId],
    queryFn: () => getRaceStartControlState(eventEditionId),
    enabled: Boolean(eventEditionId),
    refetchInterval: open && !pending ? 3_000 : false,
  });
  const allCategories = stateQuery.data?.categories ?? [];
  const remainingCategories = allCategories.filter((category) =>
    (!categoryId || category.id === categoryId)
    && !["completed", "closed"].includes(category.currentStatus));
  // An event can have terminal races but a stale edition status. The existing
  // terminal-completion command repairs that state without recomputing results.
  const terminalRecovery = scope === "event" && allCategories.length > 0
    && allCategories.every((category) => ["completed", "closed"].includes(category.currentStatus));
  const categories = terminalRecovery ? allCategories : remainingCategories;
  const unfinishedCount = terminalRecovery ? 0 : categories.reduce((total, category) => total + category.counts.unresolved, 0);
  const editionClosed = ["completed", "archived", "cancelled"].includes(stateQuery.data?.editionStatus ?? "");
  const canSubmit = categories.length > 0 && !editionClosed && !stateQuery.isError
    && (terminalRecovery || (reason.trim().length >= 3 && reason.trim().length <= 2000)) && acknowledgeOverride
    && (!unfinishedCount || acknowledgeDnf) && !pending;

  async function submit() {
    if (!canSubmit) return;
    const categoryIds = categories.map((category) => category.id).sort();
    const signature = JSON.stringify([eventEditionId, categoryIds, reason.trim(), acknowledgeDnf]);
    if (command.current?.signature !== signature) {
      command.current = { signature, id: crypto.randomUUID() };
    }
    setPending(true);
    setError(null);
    try {
      const result = await finishRace(eventEditionId, categoryIds, command.current.id, acknowledgeDnf,
        terminalRecovery ? undefined : reason.trim());
      setOpen(false);
      if (scope === "event") {
        if (result.editionCompleted) toast.success(t("race.finishEvent.success"));
        else toast.warning(t("race.finishEvent.incomplete"));
      } else {
        toast.success(t("race.finishOverride.success"));
      }
      if (result.skippedResultCategoryIds?.length) toast.info(t("race.finishOverride.noSnapshot"));
      if (result.pendingResultCategoryIds.length) toast.warning(t("race.finishOverride.queued"));
      const refreshes = await Promise.allSettled([
        refreshRaceFinish(queryClient),
        Promise.resolve().then(() => onFinished?.(result)),
      ]);
      if (refreshes.some((refresh) => refresh.status === "rejected")) {
        toast.warning(t("race.finishOverride.refreshError"));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("race.finishOverride.error"));
      void stateQuery.refetch();
    } finally {
      setPending(false);
    }
  }

  if ((editionClosed || (scope === "race" && !categories.length)) && !open) return null;

  return (
    <>
      <Button size="sm" variant={scope === "event" ? "default" : "outline"}
        disabled={disabled || pending || stateQuery.isError || !categories.length}
        onClick={() => {
          setReason("");
          setAcknowledgeDnf(false);
          setAcknowledgeOverride(false);
          setError(null);
          command.current = null;
          setOpen(true);
          void stateQuery.refetch();
        }}>
        <AlertTriangle className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t(scope === "event" ? "race.finishEvent.button" : "race.finishOverride.button")}
      </Button>
      {scope === "event" && stateQuery.isError && !open
        ? <p role="alert" className="text-sm text-destructive">{t("race.finishOverride.loadError")}</p> : null}
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(scope === "event" ? "race.finishEvent.title" : "race.finishOverride.title")}</DialogTitle>
            <DialogDescription>{t(scope === "event" ? "race.finishEvent.description" : "race.finishOverride.description")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2" aria-label={t("race.finishOverride.races")}>
            {categories.map((category) => (
              <li key={category.id} className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <p className="font-semibold">{category.name}</p>
                {!terminalRecovery && !category.effectiveStartAt ? <p className="mt-1 text-muted-foreground">{t("race.finishOverride.notStarted")}</p> : null}
                {!terminalRecovery && !category.counts.confirmed ? <p className="mt-1 text-muted-foreground">{t("race.finishOverride.noRegistrations")}</p> : null}
                {!terminalRecovery && category.counts.unresolved > 0 ? <p className="mt-1 text-trail-amber">{t("race.finishOverride.unfinished", { count: category.counts.unresolved })}</p> : null}
              </li>
            ))}
          </ul>
          <p className="rounded-xl border border-trail-amber/25 bg-trail-amber/[0.07] p-3 text-sm">
            {t(terminalRecovery ? "race.finishEvent.terminalRecovery" : "race.finishOverride.consequences")}
          </p>
          {!terminalRecovery ? <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>{t("race.finishOverride.reason")}</Label>
            <Textarea id={`${id}-reason`} value={reason} maxLength={2000} disabled={pending}
              onChange={(event) => setReason(event.target.value)} />
          </div> : null}
          {unfinishedCount > 0 ? (
            <div className="flex items-start gap-2">
              <Checkbox id={`${id}-dnf`} checked={acknowledgeDnf} disabled={pending}
                onCheckedChange={(checked) => setAcknowledgeDnf(checked === true)} />
              <Label htmlFor={`${id}-dnf`} className="leading-5">
                {t("race.finishOverride.acknowledgeDnf", { count: unfinishedCount })}
              </Label>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-confirm`} checked={acknowledgeOverride} disabled={pending}
              onCheckedChange={(checked) => setAcknowledgeOverride(checked === true)} />
            <Label htmlFor={`${id}-confirm`} className="leading-5">{t(scope === "event" ? "race.finishEvent.acknowledge" : "race.finishOverride.acknowledge")}</Label>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {stateQuery.isError ? <p role="alert" className="text-sm text-destructive">{t("race.finishOverride.loadError")}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button disabled={!canSubmit || disabled} onClick={() => void submit()}>
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t(scope === "event" ? "race.finishEvent.confirm" : "race.finishOverride.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
