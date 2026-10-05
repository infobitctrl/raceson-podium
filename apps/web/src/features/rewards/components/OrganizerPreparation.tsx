import { useCallback, useEffect, useRef, useState } from "react";
import type { RewardPreparationSelection, RewardPreparationView } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { TranslationKey } from "@/shared/i18n/messages";
import { getOrganizerPreparation, reserveOrganizerAllocation, type RewardReservationConfirmation } from "../data/organizerPreparation";
import { organizerAccessLost, organizerErrorKey } from "../model/organizerRewards";
import { formatTestMon } from "../model/athleteRewards";

const families: Record<string, TranslationKey> = { podium: "rewards.programme.podium", record: "rewards.programme.record",
  club_performance: "rewards.programme.clubPerformance", athlete_metres: "rewards.programme.athleteDistance", club_finishes: "rewards.programme.clubFinishes" };
type Reservation = Awaited<ReturnType<typeof reserveOrganizerAllocation>>;
const conflict = (e: unknown) => e !== null && typeof e === "object" && "status" in e && e.status === 409;
function Amount({ wei }: { wei: string }) {
  const { locale, t } = useI18n(); return <span className="tabular-nums">{wei === "0" ? "0" : formatTestMon(wei, locale)} {t("rewards.testMon")}</span>;
}
export default function OrganizerPreparation({ selection, raceName, onBack, onAccessLost }: { selection: RewardPreparationSelection;
  raceName: string | null; onBack: () => void; onAccessLost: (error: unknown) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<RewardPreparationView | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState<unknown>(null);
  const [accepted, setAccepted] = useState(false), [pending, setPending] = useState<RewardReservationConfirmation | null>(null), [saved, setSaved] = useState<Reservation | null>(null);
  const epoch = useRef(0), flight = useRef(false), current = useRef<RewardPreparationView | null>(null), access = useRef(onAccessLost); access.current = onAccessLost;
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return; flight.current = true; const ticket = ++epoch.current;
    if (!after) { current.current = null; setView(null); }
    setBusy(true); setError(null); setAccepted(false); setPending(null); setSaved(null);
    try {
      let next = await getOrganizerPreparation(selection, after); if (ticket !== epoch.current) return;
      if (after) {
        const old = current.current?.preview, page = next.preview;
        if (!old || !page || old.previewDigest !== page.previewDigest || old.reviewId !== page.reviewId || old.awardCount !== page.awardCount)
          throw Error("reward_preparation_changed");
        next = { ...next, stage: "preview", allocationId: null, preview: { ...page, items: [...old.items, ...page.items] } };
      }
      current.current = next; setView(next);
    } catch (e) { if (ticket === epoch.current) {
      current.current = null; setView(null); setError(e); if (organizerAccessLost(e)) access.current(e);
    } } finally { if (ticket === epoch.current) { flight.current = false; setBusy(false); } }
  }, [selection]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; current.current = null; }; }, [load]);
  const reserve = async () => {
    const p = current.current?.preview; if (!p || flight.current || (!accepted && !pending) || saved) return;
    const request = pending ?? { reviewId: p.reviewId, previewDigest: p.previewDigest, idempotencyKey: crypto.randomUUID(), confirmAllocation: true as const };
    flight.current = true; const ticket = ++epoch.current; setBusy(true); setError(null); setPending(request);
    try {
      const result = await reserveOrganizerAllocation(selection, request); if (ticket !== epoch.current) return;
      if (result.allocatedWei !== p.allocatedWei || result.unallocatedWei !== p.unallocatedWei || result.entitlementCount !== p.awardCount)
        throw Error("invalid_reward_preparation_document");
      setSaved(result); setPending(null); setAccepted(false); current.current = null; setView(null);
    } catch (e) { if (ticket === epoch.current) {
      setError(e); if (organizerAccessLost(e)) access.current(e);
      if (conflict(e)) { current.current = null; setView(null); setPending(null); setAccepted(false); }
    } } finally { if (ticket === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const p = view?.preview;
  return <section aria-label={t("rewards.preparation.title")} className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={onBack}>{t("rewards.distribution.backCampaigns")}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>{t("rewards.distribution.refresh")}</Button></div>
    <h2 className="break-words text-xl font-semibold">{raceName ?? t("rewards.programme.leaguePot")} · {t("rewards.preparation.title")}</h2>
    <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t("rewards.preparation.notice")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-destructive/30 p-4">{conflict(error) ? t("rewards.preparation.changed") : t(organizerErrorKey(error))}</p> : null}
    {saved ? <div className="space-y-3 rounded-xl border border-primary/30 p-5" role="status"><h3 className="font-semibold">{t("rewards.preparation.saved")}</h3>
      <p><Amount wei={saved.allocatedWei} /> · {t("rewards.distribution.awardCount", { count: saved.entitlementCount })}</p>
      <p className="text-sm text-muted-foreground">{t("rewards.preparation.savedHelp")}</p><Button onClick={onBack}>{t("rewards.preparation.returnPots")}</Button></div> : null}
    {view?.stage === "awaiting_review" ? <p className="rounded-xl border border-dashed p-5">{t("rewards.preparation.noReview")}</p> : null}
    {view?.stage === "reserved" ? <div className="space-y-3"><p>{t("rewards.preparation.alreadyReserved")}</p><Button onClick={onBack}>{t("rewards.preparation.returnPots")}</Button></div> : null}
    {p ? <><div className="space-y-2"><p className="font-semibold">{t("rewards.preparation.revision", { number: p.revision })}</p>
      <p className="text-sm text-muted-foreground">{t("rewards.preparation.counts", { selected: p.selectedFinishCount, excluded: p.excludedFinishCount, awards: p.awardCount })}</p></div>
      <dl className="grid gap-4 sm:grid-cols-3">{[["rewards.preparation.budget", view!.budgetWei], ["rewards.distribution.allocated", p.allocatedWei], ["rewards.distribution.unallocated", p.unallocatedWei]].map(([key, amount]) =>
        <div key={key} className="min-w-0 rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{t(key as TranslationKey)}</dt><dd className="mt-2 break-words font-semibold"><Amount wei={amount} /></dd></div>)}</dl>
      <div className="grid gap-3 sm:grid-cols-3">{p.families.map(f => <article className="min-w-0 space-y-2 rounded-xl border p-4" key={f.family}>
        <h3 className="font-semibold">{t(families[f.family])}</h3><p><Amount wei={f.allocatedWei} /></p>
        <p className="text-xs text-muted-foreground">{t("rewards.distribution.unallocated")}: <Amount wei={f.unallocatedWei} /></p></article>)}</div>
      <section className="space-y-3" aria-label={t("rewards.preparation.awards")}><h3 className="font-semibold">{t("rewards.preparation.awards")}</h3>
        <p className="text-sm text-muted-foreground">{t("rewards.distribution.awardsHelp")}</p>
        <ul className="space-y-3">{p.items.map(a => <li className="min-w-0 space-y-2 rounded-xl border bg-card p-4" key={a.key}>
          <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><p className="text-xs uppercase text-muted-foreground">{t(a.kind === "athlete" ? "rewards.distribution.athlete" : "rewards.distribution.club")}</p>
            <h4 className="break-words font-semibold">{a.name ?? t("rewards.distribution.unnamed")}</h4></div><p><Amount wei={a.amountWei} /></p></div>
          <ul className="space-y-1 text-sm text-muted-foreground">{a.breakdown.map(b => <li key={b.family}>{t(families[b.family])}: <Amount wei={b.amountWei} /></li>)}</ul></li>)}</ul>
        {!p.items.length ? <p>{t("rewards.distribution.noAwards")}</p> : null}
        {p.nextCursor ? <Button variant="outline" disabled={busy || !!pending} onClick={() => void load(p.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
      </section>
      <div className="space-y-3 rounded-xl border border-primary/30 p-5">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={accepted} disabled={busy || !!pending}
          onChange={e => setAccepted(e.target.checked)} /><span>{t("rewards.preparation.confirm")}</span></label>
        {pending ? <p className="text-sm text-muted-foreground">{t("rewards.preparation.uncertain")}</p> : null}
        <Button className="h-auto whitespace-normal" disabled={busy || (!accepted && !pending)} onClick={() => void reserve()}>
          {t(pending ? "rewards.preparation.retry" : "rewards.preparation.reserve")}</Button>
      </div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("rewards.preparation.references")}</summary>
        <dl className="mt-3 space-y-2 break-all"><div><dt>{t("rewards.preparation.review")}</dt><dd className="font-mono">{p.reviewId}</dd></div>
          <div><dt>{t("rewards.distribution.snapshot")}</dt><dd className="font-mono">{p.snapshotId}</dd></div></dl></details>
    </> : null}
  </section>;
}
