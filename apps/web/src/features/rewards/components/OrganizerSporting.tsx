import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { RewardPreparationSelection, RewardSportingSourceView, RewardSportingPreview } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { TranslationKey } from "@/shared/i18n/messages";
import { getOrganizerSportingSource, captureOrganizerSportingSource, previewOrganizerSportingReview, submitOrganizerSportingReview, getOrganizerSportingRecord } from "../data/organizerSporting";
import { emptySportingDraft, buildSportingReview, sportingTime, type SportingReviewRequest, type SportingReviewConfirmation, type SportingDraft } from "../model/organizerSportingDraft";
import { organizerAccessLost, organizerErrorKey } from "../model/organizerRewards";
import { formatTestMon } from "../model/athleteRewards";
import SportingReviewEditor from "./SportingReviewEditor";

const OrganizerRecords = lazy(() => import("./OrganizerRecords"));

const families: Record<string, TranslationKey> = { podium: "rewards.programme.podium", record: "rewards.programme.record", club_performance: "rewards.programme.clubPerformance",
  athlete_metres: "rewards.programme.athleteDistance", club_finishes: "rewards.programme.clubFinishes" };
const localErrors: Record<string, TranslationKey> = { load_all: "rewards.sporting.loadAll", open_cases: "rewards.sporting.openCases", reference: "rewards.sporting.error.reference",
  duplicates: "rewards.sporting.error.duplicates", memberships: "rewards.sporting.error.memberships", ranks: "rewards.sporting.error.ranks", records: "rewards.sporting.error.records" };
const status = (e: unknown) => e && typeof e === "object" && "status" in e ? e.status : null;
function errorKey(e: unknown): TranslationKey { return e instanceof Error && localErrors[e.message] ? localErrors[e.message]
  : status(e) === 422 ? "rewards.sporting.error.review" : organizerErrorKey(e); }
function mergeSource(old: RewardSportingSourceView, next: RewardSportingSourceView) {
  if (!old.source || !next.source) throw Error("invalid_reward_sporting_document");
  const { items: before, nextCursor: ignoredBefore, ...head } = old.source, { items: after, nextCursor: ignoredAfter, ...newHead } = next.source;
  if (old.latestRevision !== next.latestRevision || old.latestReviewId !== next.latestReviewId || old.allocationId !== next.allocationId
    || JSON.stringify(head) !== JSON.stringify(newHead) || before.at(-1)!.sourceId >= after[0]?.sourceId) throw Error("invalid_reward_sporting_document");
  const items = [...before, ...after]; if (items.length > next.source.resultCount || (next.source.nextCursor === null && items.length !== next.source.resultCount)) throw Error("invalid_reward_sporting_document");
  return { ...next, source: { ...next.source, items } };
}
export default function OrganizerSporting({ selection, raceName, onBack, onPrepare, onAccessLost }: { selection: RewardPreparationSelection;
  raceName: string | null; onBack: () => void; onPrepare: () => void; onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n(), [view, setView] = useState<RewardSportingSourceView | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState(emptySportingDraft), [captureAccepted, setCaptureAccepted] = useState(false), [accepted, setAccepted] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<{ idempotencyKey: string; confirmCapture: true } | null>(null);
  const [prepared, setPrepared] = useState<{ request: SportingReviewRequest; preview: RewardSportingPreview } | null>(null);
  const [pendingSave, setPendingSave] = useState<SportingReviewConfirmation | null>(null), [saved, setSaved] = useState<Awaited<ReturnType<typeof submitOrganizerSportingReview>> | null>(null);
  const [recordPane, setRecordPane] = useState<{ raceId: string; gender: "M" | "F" } | null>(null);
  const current = useRef<RewardSportingSourceView | null>(null), epoch = useRef(0), flight = useRef(false), access = useRef(onAccessLost); access.current = onAccessLost;
  const fail = useCallback((e: unknown) => {
    setError(e);
    if (organizerAccessLost(e) || status(e) === 409) {
      current.current = null; setView(null); setPrepared(null); setPendingSave(null); setPendingCapture(null); setAccepted(false); setDraft(emptySportingDraft()); setRecordPane(null);
      if (organizerAccessLost(e)) access.current(e);
    }
  }, []);
  const load = useCallback(async (snapshotId: string | null = null, after: string | null = null) => {
    if (flight.current) return; flight.current = true; const ticket = ++epoch.current;
    setBusy(true); setError(null); setPrepared(null); setAccepted(false); setSaved(null); setPendingSave(null); setPendingCapture(null); setCaptureAccepted(false);
    if (!after) { current.current = null; setView(null); setDraft(emptySportingDraft()); setRecordPane(null); }
    try {
      let next = await getOrganizerSportingSource(selection, snapshotId, after); if (ticket !== epoch.current) return;
      if (after && current.current) next = mergeSource(current.current, next);
      current.current = next; setView(next);
    } catch (e) { if (ticket === epoch.current) { current.current = null; setView(null); fail(e); } }
    finally { if (ticket === epoch.current) { flight.current = false; setBusy(false); } }
  }, [selection, fail]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; current.current = null; }; }, [load]);
  const work = async (action: (ticket: number) => Promise<void>) => {
    if (flight.current) return; flight.current = true; const ticket = ++epoch.current; setBusy(true); setError(null);
    try { await action(ticket); } catch (e) { if (ticket === epoch.current) fail(e); }
    finally { if (ticket === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const capture = () => {
    if (!captureAccepted && !pendingCapture) return;
    const request = pendingCapture ?? { idempotencyKey: crypto.randomUUID(), confirmCapture: true as const };
    void work(async ticket => {
      setPendingCapture(request); setPrepared(null); setAccepted(false);
      const receipt = await captureOrganizerSportingSource(selection, request); if (ticket !== epoch.current) return;
      const next = await getOrganizerSportingSource(selection, receipt.snapshotId); if (ticket !== epoch.current) return;
      current.current = next; setView(next); setDraft(emptySportingDraft()); setPendingCapture(null); setCaptureAccepted(false);
    });
  };
  const change = (next: SportingDraft) => { setDraft(next); setPrepared(null); setAccepted(false); setError(null); };
  const preview = () => void work(async ticket => {
    const s = current.current?.source; if (!s) return; setPrepared(null); setAccepted(false);
    const request = { snapshotId: s.snapshotId, expectedRevision: current.current!.latestRevision, review: buildSportingReview(s, draft) };
    const result = await previewOrganizerSportingReview(selection, request, s.pot); if (ticket !== epoch.current) return;
    if (result.budgetWei !== s.budgetWei || result.selectedFinishCount + result.excludedFinishCount !== s.resultCount) throw Error("invalid_reward_sporting_document");
    setPrepared({ request, preview: result });
  });
  const save = () => {
    if (!prepared || (!accepted && !pendingSave)) return;
    const request = pendingSave ?? { ...prepared.request, previewDigest: prepared.preview.previewDigest, idempotencyKey: crypto.randomUUID(), confirmReview: true as const };
    void work(async ticket => {
      setPendingSave(request); const receipt = await submitOrganizerSportingReview(selection, request); if (ticket !== epoch.current) return;
      setSaved(receipt); current.current = null; setView(null); setPendingSave(null); setPrepared(null); setAccepted(false); setDraft(emptySportingDraft());
    });
  };
  const source = view?.source, disabled = busy || !!pendingSave || !!pendingCapture, p = prepared?.preview;
  const amount = (v: string) => `${v === "0" ? "0" : formatTestMon(v, locale)} ${t("rewards.testMon")}`;
  if (recordPane && source) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
    <OrganizerRecords selection={{ ...selection, snapshotId: source.snapshotId }} {...recordPane} onBack={() => setRecordPane(null)} onAccessLost={fail}
      onSelected={record => {
        setDraft(old => ({ ...old, records: { ...old.records, [`${record.raceId}:${record.gender}`]: { choice: "approved", approval: record } } }));
        setPrepared(null); setAccepted(false); setRecordPane(null);
      }} />
  </Suspense>;
  return <section className="space-y-5" aria-label={t("rewards.sporting.title")}>
    <div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={onBack}>{t("rewards.distribution.backCampaigns")}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>{t("rewards.distribution.refresh")}</Button></div>
    <h2 className="break-words text-xl font-semibold">{raceName ?? t("rewards.programme.leaguePot")} · {t("rewards.sporting.title")}</h2>
    <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t("rewards.sporting.notice")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p className="rounded-xl border border-destructive/30 p-4" role="alert">{t(errorKey(error))}</p> : null}
    {saved ? <div className="space-y-3 rounded-xl border p-5" role="status"><h3 className="font-semibold">{t("rewards.sporting.saved")}</h3>
      <p className="text-sm">{t("rewards.sporting.savedHelp", { revision: saved.revision })}</p><Button onClick={onPrepare}>{t("rewards.preparation.open")}</Button></div> : null}
    {view && !view.allocationId ? <div className="space-y-3 rounded-xl border p-4">
      <p className="text-sm">{t(source ? "rewards.sporting.recaptureHelp" : "rewards.sporting.noSource")}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={captureAccepted} disabled={disabled}
        onChange={e => setCaptureAccepted(e.target.checked)} /><span>{t("rewards.sporting.captureConfirm")}</span></label>
      {pendingCapture ? <p className="text-sm">{t("rewards.sporting.uncertain")}</p> : null}
      <Button variant="outline" className="h-auto whitespace-normal" disabled={busy || !!pendingSave || (!captureAccepted && !pendingCapture)} onClick={capture}>
        {t(pendingCapture ? "rewards.sporting.retryCapture" : "rewards.sporting.capture")}</Button>
    </div> : null}
    {view?.allocationId ? <p className="rounded-xl border p-4">{t("rewards.preparation.alreadyReserved")}</p> : null}
    {source ? <><dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border p-4"><dt className="text-sm text-muted-foreground">{t("rewards.preparation.budget")}</dt><dd className="font-semibold">{amount(source.budgetWei)}</dd></div>
      <div className="rounded-xl border p-4"><dt className="text-sm text-muted-foreground">{t("rewards.sporting.finishes")}</dt><dd className="font-semibold">{source.finishedCount}</dd></div>
      <div className="rounded-xl border p-4"><dt className="text-sm text-muted-foreground">{t("rewards.sporting.uncertainCount")}</dt><dd className="font-semibold">{source.uncertainMembershipCount}</dd></div>
    </dl><details className="min-w-0 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">{t("rewards.sporting.inspectResults", { shown: source.items.length, total: source.resultCount })}</summary>
      <p className="my-3 break-all text-xs text-muted-foreground">{t("rewards.distribution.snapshot")}: {source.snapshotId} · {new Date(source.capturedAt).toLocaleString(locale)}</p>
      <ul>{source.items.map(r => <li className="space-y-1 border-t py-3 text-sm" key={r.sourceId}><p className="break-words font-medium">{r.athleteName ?? t("rewards.distribution.unnamed")}</p>
        <p>{BigInt(r.distanceMetres).toLocaleString(locale)} m · {sportingTime(r.finishTimeMs)} · {t(r.participationStatus === "finished" ? "rewards.sporting.finished" : "rewards.sporting.notFinished")}</p>
        <p className="text-muted-foreground">{r.clubName ?? t("rewards.sporting.noClub")}</p><p className="break-all text-xs text-muted-foreground">{t("rewards.distribution.resultId")}: {r.sourceId}</p></li>)}</ul>
    </details>
      {source.nextCursor ? <div className="space-y-3"><p className="text-sm">{t("rewards.sporting.loadAll")}</p><Button variant="outline" disabled={disabled}
        onClick={() => void load(source.snapshotId, source.nextCursor)}>{t("rewards.sporting.loadMore")}</Button></div> : !view!.allocationId ? <>
        {source.rounds.some(r => r.openCaseIds.length) ? <p className="rounded-xl border border-destructive/30 p-4">{t("rewards.sporting.openCases")}</p> : null}
        <SportingReviewEditor source={source} draft={draft} disabled={disabled} onChange={change} onReviewRecord={(raceId, gender) => {
          change({ ...draft, records: { ...draft.records, [`${raceId}:${gender}`]: { choice: "approved", approval: null } } });
          setRecordPane({ raceId, gender });
        }} onRecord={(raceId, gender, approvalId) => void work(async ticket => {
          const a = await getOrganizerSportingRecord(selection, source.snapshotId, approvalId); if (ticket !== epoch.current) return;
          if (a.raceId !== raceId || a.gender !== gender) throw Error("records");
          change({ ...draft, records: { ...draft.records, [`${raceId}:${gender}`]: { choice: "approved", approval: a } } });
        })} />
        <Button className="h-auto whitespace-normal" disabled={disabled || source.rounds.some(r => r.openCaseIds.length > 0)} onClick={preview}>{t("rewards.sporting.preview")}</Button>
      </> : null}
    </> : null}
    {p ? <section className="space-y-4 rounded-xl border border-primary/30 p-5" aria-label={t("rewards.sporting.previewTitle")}>
      <h3 className="font-semibold">{t("rewards.sporting.previewTitle")}</h3><p className="text-sm">{t("rewards.preparation.counts", { selected: p.selectedFinishCount, excluded: p.excludedFinishCount, awards: p.awardCount })}</p>
      <ul className="space-y-2">{p.families.map(f => <li key={f.family} className="flex flex-wrap justify-between gap-2 text-sm"><span>{t(families[f.family])}</span><span>{amount(f.allocatedWei)}</span></li>)}</ul>
      <p className="text-sm text-muted-foreground">{t("rewards.distribution.unallocated")}: {amount(p.unallocatedWei)}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" disabled={disabled} checked={accepted} onChange={e => setAccepted(e.target.checked)} />
        <span>{t("rewards.sporting.confirmReview")}</span></label>
      {pendingSave ? <p className="text-sm">{t("rewards.sporting.uncertain")}</p> : null}
      <Button className="h-auto whitespace-normal" disabled={busy || (!accepted && !pendingSave)} onClick={save}>{t(pendingSave ? "rewards.sporting.retrySave" : "rewards.sporting.save")}</Button>
    </section> : null}
  </section>;
}
