import RewardExplorerLink from "./RewardExplorerLink";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClubRewardAward, ClubRewardClaim, ClubRewardPayment } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getClubAwards, getClubClaims, getClubPaymentStatus } from "../data/clubPortal";
import { clubAccessLost, clubTreasuryErrorKey, type RewardOwnedClub } from "../model/clubTreasuries";
import { formatTestMon } from "../model/athleteRewards";
import { productCopy } from "../model/productCopy";
const ProgrammeAwards = lazy(() => import("./ProgrammeClubAllocationsV3"));

type Lost = (e: unknown) => void;
type Page<T> = { items: T[]; nextCursor: string | null };
function usePage<T>(fetchPage: (after: string | null) => Promise<Page<T>>, onAccessLost: Lost) {
  const [view, setView] = useState<Page<T> & { loading: boolean; error: unknown }>({ items: [], nextCursor: null, loading: true, error: null });
  const epoch = useRef(0), flight = useRef(false), lost = useRef(onAccessLost); lost.current = onAccessLost;
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return; const ticket = ++epoch.current; flight.current = true;
    setView(old => ({ items: after ? old.items : [], nextCursor: null, loading: true, error: null }));
    try { const page = await fetchPage(after); if (epoch.current === ticket) setView(old => ({ ...page, items: after ? [...old.items, ...page.items] : page.items, loading: false, error: null })); }
    catch (error) { if (epoch.current === ticket) { setView({ items: [], nextCursor: null, loading: false, error }); if (clubAccessLost(error)) lost.current(error); } }
    finally { if (epoch.current === ticket) flight.current = false; }
  }, [fetchPage]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; }; }, [load]);
  return { ...view, load };
}
function Scope({ award }: { award: ClubRewardAward }) {
  const { t } = useI18n();
  return <span>{award.pot === "league" ? t("rewards.clubLedger.league") : `${t("rewards.clubLedger.round", { number: award.roundNumber ?? "" })}${award.raceName ? ` · ${award.raceName}` : ""}`}</span>;
}
function Awards({ clubId, onAccessLost }: { clubId: string; onAccessLost: Lost }) {
  const { t, locale } = useI18n(), read = useCallback((after: string | null) => getClubAwards(clubId, after), [clubId]), page = usePage(read, onAccessLost);
  return <div className="space-y-3">
    <Button variant="outline" disabled={page.loading} onClick={() => void page.load()}>{t("rewards.clubLedger.refreshAwards")}</Button>
    {page.loading ? <p role="status">{t("rewards.loading")}</p> : page.error ? <p role="alert">{t(clubTreasuryErrorKey(page.error))}</p> : null}
    {!page.loading && !page.error && !page.items.length ? <p>{t("rewards.clubLedger.emptyAwards")}</p> : null}
    <ul className="grid gap-3 sm:grid-cols-2">{page.items.map(a => <li key={a.entitlementId} className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4">
      <h4 className="font-semibold"><Scope award={a} /></h4><p className="text-2xl font-bold tabular-nums">{formatTestMon(a.amountWei, locale)} <span className="text-sm">{t("rewards.testMon")}</span></p>
      <p className="text-sm text-muted-foreground">{t(a.pot === "race" ? "rewards.clubLedger.performance" : "rewards.clubLedger.finishes")}</p>
      <p className="text-xs font-semibold">{t("rewards.clubLedger.allocated")}</p>
      <details className="text-xs"><summary className="cursor-pointer">{t("rewards.clubLedger.references")}</summary>
        <p className="mt-2 break-all font-mono">{a.programmeId}<br />{a.entitlementId}</p></details>
    </li>)}</ul>
    {page.nextCursor ? <Button variant="outline" disabled={page.loading} onClick={() => void page.load(page.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
  </div>;
}
function Payment({ history, onAccessLost, onClose }: { history: ClubRewardClaim; onAccessLost: Lost; onClose: () => void }) {
  const { t, locale } = useI18n(), [view, setView] = useState<{ loading: boolean; error: unknown; payment: ClubRewardPayment | null }>({ loading: true, error: null, payment: null });
  const epoch = useRef(0), flight = useRef(false), region = useRef<HTMLElement>(null), lost = useRef(onAccessLost); lost.current = onAccessLost;
  const load = useCallback(async () => {
    if (flight.current) return; const ticket = ++epoch.current; flight.current = true; setView({ loading: true, error: null, payment: null });
    try { const payment = await getClubPaymentStatus(history); if (ticket === epoch.current) setView({ loading: false, error: null, payment }); }
    catch (error) { if (ticket === epoch.current) { setView({ loading: false, error, payment: null }); if (clubAccessLost(error)) lost.current(error); } }
    finally { if (ticket === epoch.current) flight.current = false; }
  }, [history]);
  useEffect(() => { region.current?.focus(); void load(); return () => { epoch.current += 1; flight.current = false; }; }, [load]);
  const p = view.payment, r = p?.receipt;
  return <section ref={region} tabIndex={-1} aria-labelledby="club-payment-title" className="min-w-0 space-y-3 rounded-xl border-2 border-primary/30 bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 id="club-payment-title" className="font-semibold">{t("rewards.payment.title")}</h4>
      <Button variant="ghost" onClick={onClose}>{t("rewards.claim.close")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("rewards.payment.readOnly")}</p>
    {view.loading ? <p role="status">{t("rewards.loading")}</p> : view.error ? <div role="alert"><p>{t(clubTreasuryErrorKey(view.error))}</p><p className="text-sm">{t("rewards.payment.errorHelp")}</p></div> : null}
    {p ? <><p role="status" className="rounded-lg bg-secondary/60 p-3 font-semibold">{t(`rewards.payment.status.${p.status}`)}</p>
      <p className="text-sm">{t(r ? "rewards.payment.confirmedHelp" : "rewards.payment.unconfirmedHelp")}</p>
      <p className="text-xl font-bold">{formatTestMon(p.claim.amountWei, locale)} {t("rewards.testMon")}</p>
      <dl className="space-y-2 text-sm"><div><dt>{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={p.claim.chainId} kind="address" value={p.claim.recipientAddress}/></dd></div>
        {r ? <><div><dt>{t("rewards.payment.transaction")}</dt><dd className="break-all font-mono">{r.transactionHash}</dd></div>
          <div><dt>{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={p.claim.chainId} kind="address" value={r.contractAddress}/></dd></div></> : null}</dl>
      {r ? <details className="text-xs"><summary className="cursor-pointer font-semibold">{t("rewards.payment.evidence")}</summary><dl className="mt-3 space-y-2">
        <div><dt>{t("rewards.payment.paymentBlock")}</dt><dd className="break-all">{r.blockNumber} · {r.blockHash}</dd></div>
        <div><dt>{t("rewards.clubLedger.twoLogs")}</dt><dd>{r.logIndex} → {r.safeReceivedLogIndex}</dd></div>
        <div><dt>{t("rewards.payment.finalizedBlock")}</dt><dd className="break-all">{r.finalizedBlock.number} · {r.finalizedBlock.hash}</dd></div>
        <div><dt>{t("rewards.payment.recordedAt")}</dt><dd>{r.recordedAt}</dd></div></dl></details> : null}
      <p className="text-xs text-muted-foreground">{t("rewards.payment.exactClaim")}</p></> : null}
    <Button variant="outline" disabled={view.loading} onClick={() => void load()}>{t("rewards.payment.refresh")}</Button>
  </section>;
}
function Claims({ onAccessLost }: { onAccessLost: Lost }) {
  const { t, locale } = useI18n(), page = usePage(getClubClaims, onAccessLost), [selected, setSelected] = useState<string | null>(null);
  const history = !page.loading && !page.error ? page.items.find(c => c.intentId === selected) : null;
  return <section className="space-y-3" aria-labelledby="club-claims-title">
    <h3 id="club-claims-title" className="text-lg font-semibold">{t("rewards.clubLedger.claims")}</h3>
    <p className="text-sm text-muted-foreground">{t("rewards.clubLedger.claimHelp")}</p>
    <Button variant="outline" disabled={page.loading} onClick={() => { setSelected(null); void page.load(); }}>{t("rewards.clubLedger.refreshClaims")}</Button>
    {page.loading ? <p role="status">{t("rewards.loading")}</p> : page.error ? <p role="alert">{t(clubTreasuryErrorKey(page.error))}</p> : null}
    {!page.loading && !page.error && !page.items.length ? <p>{t("rewards.clubLedger.emptyClaims")}</p> : null}
    <ul className="space-y-3">{page.items.map(c => <li key={c.intentId} className="min-w-0 space-y-2 rounded-xl border border-border p-4">
      <h4 className="font-semibold">{c.clubName ?? t("rewards.clubLedger.unnamed")} · <Scope award={c} /></h4>
      <p className="text-lg font-bold">{formatTestMon(c.amountWei, locale)} {t("rewards.testMon")}</p>
      <p className="text-sm">{t(c.recipientConsentRecordedAt ? "rewards.clubLedger.consentRecorded" : "rewards.claim.prepared")}</p>
      <p className="text-xs text-muted-foreground">{t("rewards.clubLedger.preparedAt")} {c.preparedAt}</p>
      <Button variant="outline" onClick={() => setSelected(c.intentId)}>{t("rewards.payment.open")}</Button>
    </li>)}</ul>
    {page.nextCursor ? <Button variant="outline" disabled={page.loading} onClick={() => { setSelected(null); void page.load(page.nextCursor); }}>{t("rewards.loadMore")}</Button> : null}
    {history ? <Payment key={history.intentId} history={history} onAccessLost={onAccessLost} onClose={() => setSelected(null)} /> : null}
  </section>;
}
export default function ClubRewardLedger({ clubs, onAccessLost }: { clubs: RewardOwnedClub[]; onAccessLost: Lost }) {
  const { t, locale } = useI18n(), [selected, setSelected] = useState(""), [programmeOpen, setProgrammeOpen] = useState(false), copy = productCopy(locale);
  const club = clubs.find(c => c.clubId === selected);
  return <section aria-labelledby="club-ledger-title" className="space-y-6 rounded-xl border border-border p-4 sm:p-5">
    <header className="space-y-2"><h2 id="club-ledger-title" className="text-xl font-semibold">{t("rewards.clubLedger.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("rewards.clubLedger.help")}</p></header>
    <div className="space-y-3"><label className="block text-sm font-medium" htmlFor="club-award-choice">{t("rewards.clubLedger.select")}</label>
      <select id="club-award-choice" value={club?.clubId ?? ""} onChange={e => setSelected(e.target.value)} className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2">
        <option value="">{t("rewards.club.chooseClub")}</option>{clubs.map(c => <option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select>
      {club ? <Awards key={club.clubId} clubId={club.clubId} onAccessLost={onAccessLost} /> : <p className="text-sm text-muted-foreground">{t("rewards.clubLedger.selectionHelp")}</p>}
      {club ? <><Button variant="outline" aria-expanded={programmeOpen} onClick={() => setProgrammeOpen(v => !v)}>{copy.clubProgrammeAwards}</Button>
        {programmeOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><ProgrammeAwards key={club.clubId} clubId={club.clubId} onAccessLost={onAccessLost} /></Suspense> : null}</> : null}
    </div>
    <Claims onAccessLost={onAccessLost} />
  </section>;
}
