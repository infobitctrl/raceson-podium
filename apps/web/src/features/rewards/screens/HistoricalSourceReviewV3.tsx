import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestHistoricalSourceV3, type HistoricalReviewContextV3, type HistoricalReviewRequestV3 } from "../data/historicalSourceV3";

type Data = Awaited<ReturnType<typeof requestHistoricalSourceV3>>;
const AllocationApprovalV3 = lazy(() => import("./AllocationApprovalV3"));
export default function HistoricalSourceReviewV3({ context, dirty, sourceOnly = false, onReviewed }: { context: HistoricalReviewContextV3; dirty: boolean; sourceOnly?: boolean; onReviewed?: () => void }) {
  const { t, locale } = useI18n(), [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false), [confirmed, setConfirmed] = useState(false), [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<HistoricalReviewRequestV3 | null>(null);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const live = useRef(false), sending = useRef(false), generation = useRef(0);
  // Parent is keyed to source/rules/mapping/slot. The private workspace above it
  // is additionally keyed to the actual Auth session; no cross-account replay.
  useEffect(() => {
    live.current = true; const current = ++generation.current;
    void requestHistoricalSourceV3(context).then(v => { if (live.current && current === generation.current) setData(v); })
      .catch(() => { if (live.current && current === generation.current) setFailed(true); })
      .finally(() => { if (live.current && current === generation.current) setBusy(false); });
    return () => { live.current = false; generation.current = current + 1; };
  }, [context]);
  async function act(decision?: HistoricalReviewRequestV3["decision"]) {
    if (sending.current || busy || dirty || (decision === "confirmed_final" && !confirmed)) return;
    const request = pending ?? (decision && data ? { slot: context.slot, requestId: crypto.randomUUID(),
      expectedReviewId: data.decisions.find(d => d.slot === context.slot)?.id ?? null, contextHash: data.contextHash, decision } : null);
    if (decision && !request) return;
    sending.current = true; setBusy(true); setFailed(false); setSaved(false); setData(null);
    if (request) setPending(request);
    try {
      const result = await requestHistoricalSourceV3(context, request ?? undefined);
      if (live.current) { setData(result); setPending(null); setConfirmed(false); setSaved(Boolean(request)); if (request) onReviewed?.(); }
    } catch { if (live.current) setFailed(true); }
    finally { sending.current = false; if (live.current) setBusy(false); }
  }
  const review = data?.decisions.find(d => d.slot === context.slot), round = data?.source.rounds[context.slot - 1];
  const pot = data?.preview.rounds[context.slot - 1];
  const synthetic = data?.source.kind === "synthetic_rehearsal";
  return <section className="space-y-3 rounded-md border border-primary/40 p-3" aria-label={t(synthetic ? "rewards.pilot.reviewTitle" : "rewards.historical.title")}>
    <h4 className="text-lg font-semibold">{sourceOnly ? (locale === "hr" ? "Potvrda izvora rezultata" : "Confirm the results source") : t(synthetic ? "rewards.pilot.reviewTitle" : "rewards.historical.title")}</h4>
    <p className="text-sm">{sourceOnly ? (locale === "hr" ? "Pregledajte postojeću službenu objavu za nagrade ovog kola." : "Review the existing official publication for this round’s rewards.") : t(synthetic ? "rewards.pilot.reviewHelp" : "rewards.historical.help")}</p>
    <p className="rounded bg-muted p-3 text-sm">{sourceOnly ? (locale === "hr" ? "Potvrda izvora ne odobrava nagrade niti šalje isplate." : "Confirming the source does not approve awards or send payments.") : t("rewards.historical.notPayment")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t(pending ? "rewards.historical.uncertain" : "rewards.historical.error")}</p> : null}
    {saved ? <p role="status" className="text-sm">{t("rewards.historical.saved")}</p> : null}
    {data && round && pot ? <>
      <p className="font-medium">{sourceOnly ? (!review ? "Final-source review has not been recorded." : !review.current ? "The saved source review is out of date." : review.decision === "held" ? "The results team has placed this source on hold." : "The current source is confirmed.") : t(!review ? "rewards.historical.unreviewed" : !review.current ? "rewards.historical.stale"
        : review.decision === "held" ? "rewards.historical.held" : "rewards.historical.reviewed")}</p>
      {review ? <p className="break-all text-xs text-muted-foreground">{review.id} · {new Date(review.reviewedAt).toLocaleString(locale)}</p> : null}
      {!sourceOnly ? <p className="text-sm">{t("rewards.historical.totals", { proposed: formatUnits(pot.proposedWei, 18), retained: formatUnits(pot.retainedWei, 18) })}</p> : null}
      <details className="text-xs" open={sourceOnly || undefined}><summary className="cursor-pointer">{t("rewards.historical.evidence")}</summary>
        <p>{t("rewards.frozen.binding", { rules: context.record.revision, mapping: context.workspace.revision })}</p>
        <p className="break-all font-mono">{data.contextHash}</p>
        {context.workspace.catalogue.rounds.find(r => r.slot === context.slot)?.races.map(r => <p className="mt-2 break-all" key={r.id}>{r.name} · {t(synthetic ? "rewards.pilot.simulatedPublication" : r.publicationState === "corrected" ? "rewards.historical.corrected" : "rewards.historical.official")} · {r.publicationId}</p>)}
        <p>{round.evidence?.publishedAt ? new Date(round.evidence.publishedAt).toLocaleString(locale) : t("rewards.historical.missingTime")}</p>
      </details>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || dirty}
        onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span>{t(synthetic ? "rewards.pilot.confirm" : "rewards.historical.confirm")}</span></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={busy || dirty || !confirmed || !round.evidence} onClick={() => void act("confirmed_final")}>{t(synthetic ? "rewards.pilot.save" : "rewards.historical.save")}</button>
        <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || dirty}
          onClick={() => void act("held")}>{t("rewards.historical.hold")}</button>
      </div>
      {!sourceOnly ? <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setAllocationOpen(v => !v)} aria-expanded={allocationOpen}>
        {t("rewards.allocationApproval.title")}</button> : null}
      {!sourceOnly && allocationOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><AllocationApprovalV3
        key={`${data.contextHash}:${review?.id ?? "none"}:${review?.current}`} context={context} dirty={dirty} /></Suspense> : null}
    </> : null}
    {!busy ? <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={dirty}
      onClick={() => void act()}>{t(pending ? "rewards.historical.retry" : "rewards.historical.reload")}</button> : null}
    {dirty ? <p className="text-sm" role="status">{t("rewards.published.savedOnly")}</p> : null}
  </section>;
}
