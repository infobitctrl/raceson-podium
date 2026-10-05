import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RewardRecordSelection, RewardRecordWorkspaceView, RewardRecordRacePage, RewardRecordPreview, RewardSportingRecord } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { TranslationKey } from "@/shared/i18n/messages";
import { listOrganizerRecordRaces, getOrganizerRecordWorkspace, captureOrganizerRecord, previewOrganizerRecord, approveOrganizerRecord, withdrawOrganizerRecord } from "../data/organizerRecords";
import { getOrganizerSportingRecord } from "../data/organizerSporting";
import { buildRecordApproval, emptyRecordComparison, mergeRecordRaces, mergeRecordResults, type RecordPending, type RecordApprovalRequest, type RecordComparisonDraft } from "../model/organizerRecords";
import { organizerAccessLost, organizerErrorKey } from "../model/organizerRewards";
import { sportingTime } from "../model/organizerSportingDraft";
import RecordComparisonEditor from "./RecordComparisonEditor";

const inputClass = "min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
const status = (e: unknown) => e && typeof e === "object" && "status" in e ? e.status : null;
const errors: Record<string, TranslationKey> = { record_load_all: "rewards.records.loadAll", record_baseline_required: "rewards.records.error.baseline",
  record_open_cases: "rewards.records.error.cases", record_comparison_required: "rewards.records.error.comparison" };
function errorKey(e: unknown): TranslationKey { return e instanceof Error && errors[e.message] ? errors[e.message]
  : status(e) === 422 ? "rewards.records.error.validation" : organizerErrorKey(e); }
function Facts({ race, label }: { race: RewardRecordWorkspaceView["targetRaces"][number]; label: TranslationKey }) {
  const { t, locale } = useI18n();
  return <section className="min-w-0 space-y-2 rounded-xl border p-4" aria-label={t(label)}><h3 className="font-semibold">{t(label)}</h3>
    <p>{BigInt(race.distanceMetres).toLocaleString(locale)} m · {t("rewards.records.laps")}: {race.lapCount}</p>
    <p className="text-sm">{t("rewards.records.start")}: {race.startAt ? new Date(race.startAt).toLocaleString(locale) : "—"}</p>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("rewards.records.routeVersion")}</summary>
      <p className="break-all">{race.trackVersionId ?? "—"}</p><p className="break-all">{t("rewards.distribution.raceId")}: {race.raceId}</p></details>
  </section>;
}
/** Session-owned operator review. No wallet, local persistence or chain writes. */
export default function OrganizerRecords({ selection, raceId, gender, onBack, onSelected, onAccessLost }: { selection: RewardRecordSelection;
  raceId: string; gender: "M" | "F"; onBack: () => void; onSelected: (record: RewardSportingRecord) => void; onAccessLost: (e: unknown) => void }) {
  const { t, locale } = useI18n(), raceSelectId = useId();
  const scope = useMemo(() => ({ programmeId: selection.programmeId, campaignId: selection.campaignId, chainId: selection.chainId, snapshotId: selection.snapshotId }),
    [selection.programmeId, selection.campaignId, selection.chainId, selection.snapshotId]);
  const [view, setView] = useState<RewardRecordWorkspaceView | null>(null), [races, setRaces] = useState<RewardRecordRacePage | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState(""), [baselineId, setBaselineId] = useState(""), [comparison, setComparison] = useState(emptyRecordComparison);
  const [busy, setBusy] = useState(true), [error, setError] = useState<unknown>(null), [pending, setPending] = useState<RecordPending | null>(null);
  const [captureConsent, setCaptureConsent] = useState(false), [approvalConsent, setApprovalConsent] = useState(false), [withdrawConsent, setWithdrawConsent] = useState(false), [reason, setReason] = useState("");
  const [prepared, setPrepared] = useState<{ request: RecordApprovalRequest; preview: RewardRecordPreview } | null>(null);
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof approveOrganizerRecord>> | null>(null), [withdrawn, setWithdrawn] = useState(false);
  const flight = useRef(false), epoch = useRef(0), access = useRef(onAccessLost), selected = useRef(onSelected), heading = useRef<HTMLHeadingElement>(null);
  access.current = onAccessLost; selected.current = onSelected;
  const clearDraft = useCallback(() => { setBaselineId(""); setComparison(emptyRecordComparison()); setPrepared(null); setApprovalConsent(false); setSaved(null); }, []);
  const fail = useCallback((e: unknown) => {
    setError(e);
    if ([400, 422].includes(Number(status(e)))) { setPending(null); setApprovalConsent(false); setWithdrawConsent(false); }
    if (organizerAccessLost(e) || status(e) === 409) {
      setView(null); setRaces(null); setSelectedRaceId(""); clearDraft(); setPending(null); setReason(""); setWithdrawConsent(false); setCaptureConsent(false); setWithdrawn(false);
      if (organizerAccessLost(e)) access.current(e);
    }
  }, [clearDraft]);
  const work = useCallback(async (action: (ticket: number) => Promise<void>) => {
    if (flight.current) return; flight.current = true; const ticket = ++epoch.current; setBusy(true); setError(null);
    try { await action(ticket); } catch (e) { if (ticket === epoch.current) fail(e); }
    finally { if (ticket === epoch.current) { flight.current = false; setBusy(false); } }
  }, [fail]);
  const refresh = useCallback(() => work(async ticket => {
    setView(null); setRaces(null); setSelectedRaceId(""); clearDraft(); setPending(null); setCaptureConsent(false); setWithdrawConsent(false); setReason(""); setWithdrawn(false);
    const [context, page] = await Promise.all([getOrganizerRecordWorkspace(scope), listOrganizerRecordRaces(scope)]);
    if (ticket !== epoch.current) return;
    if (!context.targetRaces.some(r => r.raceId === raceId)) throw Error("invalid_reward_record_workspace_document");
    setView(context); setRaces(page);
  }), [scope, raceId, clearDraft, work]);
  useEffect(() => { heading.current?.focus(); void refresh(); return () => { epoch.current += 1; flight.current = false; }; }, [refresh]);
  const latest = view?.latestApprovals.find(a => a.raceId === raceId && a.gender === gender), prior = view?.prior;
  const chosenRace = races?.items.find(r => r.raceId === selectedRaceId), disabled = busy || pending !== null;
  const target = view?.targetRaces.find(r => r.raceId === raceId);
  const change = (next: RecordComparisonDraft) => { setComparison(next); setPrepared(null); setApprovalConsent(false); setError(null); };
  const inspect = (priorId: string, after: string | null = null) => void work(async ticket => {
    clearDraft(); setWithdrawn(false);
    if (!after) setView(old => old ? { ...old, prior: null } : null);
    const next = await getOrganizerRecordWorkspace(scope, priorId, after); if (ticket !== epoch.current) return;
    if (chosenRace && next.prior?.race.raceId !== chosenRace.raceId) throw Error("invalid_reward_record_workspace_document");
    setView(after && view ? mergeRecordResults(view, next) : next);
  });
  const submit = (action: RecordPending) => void work(async ticket => {
    setPending(action); setWithdrawn(false);
    if (action.kind === "capture") {
      const receipt = await captureOrganizerRecord(scope, action.request); if (ticket !== epoch.current) return;
      setPending(null); setCaptureConsent(false); clearDraft();
      setRaces(old => old ? { ...old, items: old.items.map(r => r.raceId === receipt.priorRaceId ? { ...r, latestCaptureId: receipt.priorSnapshotId } : r) } : null);
      setView(old => old ? { ...old, prior: null } : null);
      const next = await getOrganizerRecordWorkspace(scope, receipt.priorSnapshotId); if (ticket !== epoch.current) return;
      if (next.prior?.race.raceId !== action.request.priorRaceId) throw Error("invalid_reward_record_workspace_document"); setView(next);
    } else if (action.kind === "approval") {
      const receipt = await approveOrganizerRecord(scope, action.request); if (ticket !== epoch.current) return;
      setPending(null); setSaved(receipt); setPrepared(null); setApprovalConsent(false);
      const next = await getOrganizerRecordWorkspace(scope, action.request.priorSnapshotId); if (ticket !== epoch.current) return; setView(next);
    } else {
      const receipt = await withdrawOrganizerRecord(scope, action.request); if (ticket !== epoch.current) return;
      setPending(null); setWithdrawConsent(false); setReason(""); clearDraft(); setWithdrawn(true);
      setView(old => old ? { ...old, latestApprovals: old.latestApprovals.map(a => a.approvalId === receipt.approvalId ? { ...a, withdrawnAt: receipt.withdrawnAt } : a) } : null);
    }
  });
  const preview = () => void work(async ticket => {
    if (!view) return; setPrepared(null); setApprovalConsent(false);
    const request = buildRecordApproval(view, raceId, gender, baselineId, comparison), result = await previewOrganizerRecord(scope, request);
    if (ticket !== epoch.current) return; setPrepared({ request, preview: result });
  });
  const selectApproval = (approvalId: string) => void work(async ticket => {
    const context = await getOrganizerRecordWorkspace(scope); if (ticket !== epoch.current) return;
    const current = context.latestApprovals.find(a => a.raceId === raceId && a.gender === gender);
    if (!current || current.approvalId !== approvalId || current.withdrawnAt || current.snapshotId !== scope.snapshotId) throw { status: 409 };
    const record = await getOrganizerSportingRecord(scope, scope.snapshotId, approvalId); if (ticket !== epoch.current) return;
    if (record.raceId !== raceId || record.gender !== gender) throw Error("invalid_reward_record_workspace_document"); selected.current(record);
  });
  const moreRaces = () => void work(async ticket => {
    if (!races?.nextCursor) return; const next = await listOrganizerRecordRaces(scope, races.nextCursor); if (ticket !== epoch.current) return; setRaces(mergeRecordRaces(races, next));
  });
  return <section className="space-y-5" aria-label={t("rewards.records.title")}>
    <div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={onBack}>{t("rewards.records.back")}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>{t("rewards.distribution.refresh")}</Button></div>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{t("rewards.records.title")} · {t(gender === "M" ? "rewards.sporting.men" : "rewards.sporting.women")}</h2>
    <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t("rewards.records.notice")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p className="rounded-xl border border-destructive/30 p-4" role="alert">{t(errorKey(error))}</p> : null}
    {pending ? <div className="space-y-3 rounded-xl border p-4"><p className="text-sm">{t("rewards.records.pending")}</p>
      <Button disabled={busy} className="h-auto whitespace-normal" onClick={() => submit(pending)}>{t("rewards.records.retry")}</Button></div> : null}
    {withdrawn ? <p className="rounded-xl border p-4" role="status">{t("rewards.records.withdrawnHelp")}</p> : null}
    {saved ? <section className="space-y-3 rounded-xl border border-primary/30 p-5" aria-label={t("rewards.records.saved")}>
      <h3 className="font-semibold">{t("rewards.records.saved")}</h3><p className="text-sm">{t("rewards.records.savedHelp")}</p>
      <Button disabled={disabled} onClick={() => selectApproval(saved.approvalId)}>{t("rewards.records.use")}</Button></section> : null}
    {view ? <section className="space-y-3 rounded-xl border p-4" aria-label={t("rewards.records.current")}><h3 className="font-semibold">{t("rewards.records.current")}</h3>
      {!latest ? <p className="text-sm">{t("rewards.records.noApproval")}</p> : <>
        <p className="text-sm">{t("rewards.records.revision", { revision: latest.revision })} · {new Date(latest.approvedAt).toLocaleString(locale)}</p>
        {latest.withdrawnAt ? <p className="text-sm">{t("rewards.records.withdrawn")}</p> : <>
          {latest.snapshotId !== scope.snapshotId ? <p className="text-sm">{t("rewards.records.olderSource")}</p>
            : !saved ? <Button variant="outline" disabled={disabled} onClick={() => selectApproval(latest.approvalId)}>{t("rewards.records.use")}</Button> : null}
          <details><summary className="cursor-pointer text-sm font-medium">{t("rewards.records.withdraw")}</summary>
            <fieldset disabled={disabled} className="mt-3 space-y-3"><label className="block space-y-1 text-sm"><span>{t("rewards.records.reason")}</span>
              <textarea className={`${inputClass} min-h-20`} value={reason} maxLength={4000} onChange={e => { setReason(e.target.value); setWithdrawConsent(false); }} /></label>
              <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={withdrawConsent} onChange={e => setWithdrawConsent(e.target.checked)} />
                <span>{t("rewards.records.withdrawConfirm")}</span></label>
              <Button variant="outline" className="h-auto whitespace-normal" disabled={!withdrawConsent || reason.trim().length < 8} onClick={() => submit({ kind: "withdrawal",
                request: { approvalId: latest.approvalId, expectedRevision: latest.revision, reason: reason.trim(), idempotencyKey: crypto.randomUUID(), confirmWithdrawal: true } })}>{t("rewards.records.withdraw")}</Button>
            </fieldset></details>
        </>}
      </>}
    </section> : null}
    {view?.allocationId ? <p>{t("rewards.preparation.alreadyReserved")}</p> : races ? <section className="space-y-3 rounded-xl border p-4" aria-label={t("rewards.records.races")}>
      <h3 className="font-semibold">{t("rewards.records.races")}</h3>
      <div className="space-y-1 text-sm"><label className="block" htmlFor={raceSelectId}>{t("rewards.records.chooseRace")}</label><select id={raceSelectId} className={inputClass} disabled={disabled} value={selectedRaceId}
        onChange={e => { setSelectedRaceId(e.target.value); setCaptureConsent(false); clearDraft(); setError(null); setView(old => old ? { ...old, prior: null } : null); }}>
        <option value="">{t("rewards.sporting.unreviewed")}</option>{races.items.map(r => <option key={r.raceId} value={r.raceId}>
          {r.eventName ?? r.eventEditionId} · {r.raceName ?? r.raceId} · {r.distanceMetres ? `${BigInt(r.distanceMetres).toLocaleString(locale)} m` : "—"}
        </option>)}</select></div>
      {!races.items.length ? <p className="text-sm">{t("rewards.records.noRaces")}</p> : null}
      {races.nextCursor ? <Button disabled={disabled} variant="outline" onClick={moreRaces}>{t("rewards.records.moreRaces")}</Button> : null}
      {chosenRace ? <><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" disabled={disabled} checked={captureConsent} onChange={e => setCaptureConsent(e.target.checked)} />
        <span>{t("rewards.records.captureConfirm")}</span></label><div className="flex flex-wrap gap-3">
        {chosenRace.latestCaptureId ? <Button variant="outline" disabled={disabled} onClick={() => inspect(chosenRace.latestCaptureId!)}>{t("rewards.records.inspect")}</Button> : null}
        <Button variant="outline" className="h-auto whitespace-normal" disabled={disabled || !captureConsent} onClick={() => submit({ kind: "capture",
          request: { priorRaceId: chosenRace.raceId, idempotencyKey: crypto.randomUUID(), confirmCapture: true } })}>{t("rewards.records.capture")}</Button></div></> : null}
    </section> : null}
    {target ? <div className="grid gap-3 sm:grid-cols-2"><Facts race={target} label="rewards.records.target" />{prior ? <Facts race={prior.race} label="rewards.records.prior" /> : null}</div> : null}
    {prior ? <><section className="min-w-0 space-y-3 rounded-xl border p-4" aria-label={t("rewards.records.baseline")}>
      <h3 className="font-semibold">{t("rewards.records.baseline")}</h3><p className="text-sm">{t("rewards.records.results", { shown: prior.items.length, total: prior.resultCount })}</p>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("rewards.records.publication")}</summary>
        <p className="break-all">{prior.publicationId}</p><p>{t("rewards.records.publishedAt")}: {new Date(prior.publishedAt).toLocaleString(locale)}</p>
        <p>{t("rewards.records.completedAt")}: {new Date(prior.runCompletedAt).toLocaleString(locale)}</p></details>
      {prior.items.map(r => { const selectable = r.gender === gender && r.participationStatus === "finished" && ["official", "corrected"].includes(r.resultStatus) && r.finishTimeMs && BigInt(r.finishTimeMs) > 0n;
        return <label key={r.sourceId} className="flex min-w-0 items-start gap-3 border-t py-3 text-sm"><input type="radio" name="record-baseline" className="mt-1 h-4 w-4 shrink-0"
          disabled={disabled || !!saved || !selectable} checked={baselineId === r.sourceId} value={r.sourceId} onChange={() => { setBaselineId(r.sourceId); setPrepared(null); setApprovalConsent(false); setError(null); }} />
          <span className="min-w-0 break-words"><span className="font-medium">{r.athleteName ?? t("rewards.distribution.unnamed")}</span>
            <span className="block">{sportingTime(r.finishTimeMs)} · {t(r.gender === "M" ? "rewards.sporting.men" : r.gender === "F" ? "rewards.sporting.women" : "rewards.records.unknownGender")}</span>
            <span className="block text-xs text-muted-foreground">{t(r.participationStatus === "finished" ? "rewards.sporting.finished" : "rewards.sporting.notFinished")}</span>
            <span className="block break-all text-xs text-muted-foreground">{r.sourceId}</span></span></label>;
      })}
      {prior.nextCursor ? <><p className="text-sm">{t("rewards.records.loadAll")}</p><Button variant="outline" disabled={disabled} onClick={() => inspect(prior.priorSnapshotId, prior.nextCursor)}>{t("rewards.records.moreResults")}</Button></> : null}
    </section>
      {!view?.allocationId && !saved ? <><RecordComparisonEditor value={comparison} disabled={disabled} onChange={change} />
        <Button className="h-auto whitespace-normal" disabled={disabled || !!prior.nextCursor} onClick={preview}>{t("rewards.records.preview")}</Button></> : null}
    </> : null}
    {prepared ? <section className="space-y-3 rounded-xl border border-primary/30 p-5" aria-label={t("rewards.records.previewTitle")}>
      <h3 className="font-semibold">{t("rewards.records.previewTitle")}</h3><p>{t("rewards.records.time")}: {sportingTime(prepared.preview.baseline.finishTimeMs)}</p>
      <p className="text-sm">{t("rewards.records.establishedAt")}: {new Date(Number(prepared.preview.baseline.establishedAtMs)).toLocaleString(locale)}</p>
      <p className="text-sm">{t("rewards.records.reviewEnds")}: {new Date(Number(prepared.preview.sourceReviewEndsAtSeconds) * 1000).toLocaleString(locale)}</p>
      <p className="text-sm text-muted-foreground">{t(prepared.preview.establishmentBasis === "gun_finish" ? "rewards.records.basisGun" : "rewards.records.basisNet")}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" disabled={disabled} checked={approvalConsent} onChange={e => setApprovalConsent(e.target.checked)} />
        <span>{t("rewards.records.confirmApproval")}</span></label>
      <Button className="h-auto whitespace-normal" disabled={disabled || !approvalConsent} onClick={() => submit({ kind: "approval", request: { ...prepared.request,
        previewDigest: prepared.preview.previewDigest, idempotencyKey: crypto.randomUUID(), confirmApproval: true } })}>{t("rewards.records.approve")}</Button>
    </section> : null}
  </section>;
}
