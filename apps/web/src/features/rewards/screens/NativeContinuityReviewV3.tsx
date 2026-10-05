import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { decodeNativeFinaleContinuityV3, type NativeFinaleContinuityV3, type NativeContinuityChangeV3, type NativeContinuityViewV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestNativeContinuityV3 } from "../data/nativeContinuityV3";

const empty = (): NativeFinaleContinuityV3 => ({ schema: "raceson-native-finale-continuity-v3", athletes: [], clubs: [], classifications: [] });
type Target = NativeFinaleContinuityV3["athletes"][number]["target"];
export default function NativeContinuityReviewV3({ record, bindingId, dirty }: { record: SavedRewardPlanningDraft; bindingId: string; dirty: boolean }) {
  const { t } = useI18n(), [view, setView] = useState<NativeContinuityViewV3 | null>(null), [selection, setSelection] = useState(empty);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [confirmed, setConfirmed] = useState(false), [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<NativeContinuityChangeV3 | null>(null), [page, setPage] = useState(0);
  const generation = useRef(0), sending = useRef(false);
  function accept(v: NativeContinuityViewV3) {
    setView(v); setSelection(v.review && v.review.contextHash === v.contextHash ? v.review.selection : empty()); setConfirmed(false); setPage(0);
  }
  useEffect(() => {
    const requestGeneration = generation, current = ++requestGeneration.current;
    setView(null); setSelection(empty()); setPending(null); setBusy(true); setFailed(false); setSaved(false);
    void requestNativeContinuityV3(record, bindingId).then(v => { if (current === requestGeneration.current) accept(v); })
      .catch(() => { if (current === requestGeneration.current) setFailed(true); })
      .finally(() => { if (current === requestGeneration.current) setBusy(false); });
    return () => { requestGeneration.current++; };
  }, [record, bindingId]);
  let valid = false;
  try { decodeNativeFinaleContinuityV3(selection); valid = true; } catch { /* Duplicate targets are never confirmable. */ }
  const complete = Boolean(view) && valid && selection.athletes.length === view?.options.athletes.length
    && selection.clubs.length === view?.options.clubs.length && Boolean(view?.options.rows.every(r => !r.finished || selection.classifications.some(c => c.resultId === r.id)));
  function update(next: NativeFinaleContinuityV3) { setSelection(next); setConfirmed(false); setSaved(false); }
  async function act(decision?: "confirmed" | "held") {
    if (sending.current || busy || dirty || (decision && (!view || !valid || (decision === "confirmed" && (!complete || !confirmed || !view.sourceReady))))) return;
    const change = pending ?? (decision && view ? { requestId: crypto.randomUUID(), expectedReviewId: view.review?.id ?? null,
      contextHash: view.contextHash, decision, selection: decodeNativeFinaleContinuityV3(selection) } : null);
    const current = ++generation.current; sending.current = true; setBusy(true); setFailed(false); setSaved(false); setView(null); if (change) setPending(change);
    try { const v = await requestNativeContinuityV3(record, bindingId, change ?? undefined);
      if (current === generation.current) { accept(v); setPending(null); setSaved(Boolean(change)); } }
    catch { if (current === generation.current) setFailed(true); }
    finally { sending.current = false; if (current === generation.current) setBusy(false); }
  }
  function identityControl(kind: "athletes" | "clubs", id: string, name: string) {
    const chosen = kind === "athletes" ? selection.athletes.find(a => a.nativeAthleteId === id)?.target : selection.clubs.find(c => c.nativeClubId === id)?.target;
    const old = kind === "athletes" ? view!.options.historicalAthletes : view!.options.historicalClubs;
    const used = new Set((kind === "athletes" ? selection.athletes : selection.clubs).map(v => v.target.beneficiaryId));
    return <label className="block min-w-0 space-y-1 text-sm" key={id}><span className="block font-medium">{name}</span>
      <span className="block break-all font-mono text-xs text-muted-foreground">{id}</span>
      <select aria-label={t(kind === "athletes" ? "rewards.continuity.athlete" : "rewards.continuity.club", { name })}
        className="w-full min-w-0 rounded border bg-background p-2" disabled={busy || dirty} value={chosen ? `${chosen.kind}:${chosen.beneficiaryId}` : ""}
        onChange={e => { const [targetKind, beneficiaryId] = e.target.value.split(":"), target = { kind: targetKind, beneficiaryId } as Target;
          update(kind === "athletes" ? { ...selection, athletes: [...selection.athletes.filter(a => a.nativeAthleteId !== id), ...(beneficiaryId ? [{ nativeAthleteId: id, target }] : [])] }
            : { ...selection, clubs: [...selection.clubs.filter(c => c.nativeClubId !== id), ...(beneficiaryId ? [{ nativeClubId: id, target }] : [])] }); }}>
        <option value="">{t("rewards.continuity.choose")}</option>
        {!old.some(o => o.id === id) ? <option value={`new_native:${id}`}>{t("rewards.continuity.new")}</option> : null}
        {old.map(o => <option key={o.id} value={`historical:${o.id}`} disabled={used.has(o.id) && chosen?.beneficiaryId !== o.id}>{o.name} · {o.id.slice(-6)}</option>)}
      </select></label>;
  }
  return <section aria-label={t("rewards.continuity.title")} className="space-y-4 rounded border border-primary/40 p-4">
    <h4 className="text-lg font-semibold">{t("rewards.continuity.title")}</h4><p className="text-sm">{t("rewards.continuity.help")}</p>
    <p className="rounded bg-muted p-3 text-sm">{t("rewards.continuity.boundary")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t(pending ? "rewards.continuity.uncertain" : "rewards.continuity.error")}</p> : null}
    {saved ? <p role="status">{t("rewards.continuity.saved")}</p> : null}
    {view ? <>
      <p className="font-semibold">{t(`rewards.continuity.state.${view.reviewState}`)}</p>
      <p className="text-sm">{t("rewards.historical.totals", { proposed: formatUnits(BigInt(view.proposedWei), 18), retained: formatUnits(BigInt(view.retainedWei), 18) })}</p>
      {!view.sourceReady ? <p role="status">{t("rewards.continuity.sourceHeld")}</p> : null}
      <h5 className="font-semibold">{t("rewards.continuity.athletes")}</h5>
      <div className="grid gap-3 md:grid-cols-2">{view.options.athletes.slice(page * 20, page * 20 + 20).map(a => identityControl("athletes", a.id, a.name))}</div>
      <div className="flex gap-2"><button type="button" className="rounded border p-2 text-sm disabled:opacity-50" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("rewards.nativeFinale.previous")}</button>
        <button type="button" className="rounded border p-2 text-sm disabled:opacity-50" disabled={(page + 1) * 20 >= view.options.athletes.length} onClick={() => setPage(p => p + 1)}>{t("rewards.nativeFinale.next")}</button></div>
      <h5 className="font-semibold">{t("rewards.continuity.clubs")}</h5>
      <div className="grid gap-3 md:grid-cols-2">{view.options.clubs.map(c => identityControl("clubs", c.id, c.name))}</div>
      <h5 className="font-semibold">{t("rewards.continuity.categories")}</h5>
      <div className="grid gap-3 md:grid-cols-2">{view.options.rows.filter(r => r.finished && view.options.athletes.slice(page * 20, page * 20 + 20).some(a => a.id === r.athleteId)).map(r => {
        const name = view.options.athletes.find(a => a.id === r.athleteId)!.name;
        return <label key={r.id} className="block min-w-0 text-sm">{name}<select className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={busy || dirty}
          aria-label={t("rewards.continuity.category", { name })} value={selection.classifications.find(c => c.resultId === r.id)?.categoryId ?? ""}
          onChange={e => update({ ...selection, classifications: [...selection.classifications.filter(c => c.resultId !== r.id), ...(e.target.value ? [{ resultId: r.id, categoryId: e.target.value }] : [])] })}>
          <option value="">{t("rewards.continuity.choose")}</option>{view.options.categories.filter(c => c.competitionId === r.competitionId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>;
      })}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || dirty || !complete || !view.sourceReady}
        onChange={e => setConfirmed(e.target.checked)} /><span>{t("rewards.continuity.confirm")}</span></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        disabled={busy || dirty || !complete || !confirmed || !view.sourceReady} onClick={() => void act("confirmed")}>{t("rewards.continuity.save")}</button>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || dirty || !valid} onClick={() => void act("held")}>{t("rewards.continuity.hold")}</button></div>
      {view.review ? <p className="break-all text-xs text-muted-foreground">{view.review.id} · {view.review.reviewedAt}</p> : null}
      <details className="text-xs"><summary>{t("rewards.nativeFinale.digest")}</summary><p className="break-all font-mono">{view.contextHash}</p></details>
    </> : null}
    <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || dirty} onClick={() => void act()}>
      {t(pending ? "rewards.continuity.retry" : "rewards.continuity.reload")}</button>
    {dirty ? <p role="status">{t("rewards.published.savedOnly")}</p> : null}
  </section>;
}
