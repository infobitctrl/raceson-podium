import RewardReadiness from "../components/RewardReadiness";
import RewardAccountSwitch from "../components/RewardAccountSwitch";
import SponsorClubClaims from "../components/SponsorClubClaims";
import p from "../components/Podium.module.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { publicEnv } from "@/lib/public-env";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getClubTreasuryHistory, getRewardOwnedClubs } from "../data/clubTreasuries";
import { clubAccessLost, clubTreasuryErrorKey, type ClubRewardPage } from "../model/clubTreasuries";
import ClubTreasuryHistory from "../components/ClubTreasuryHistory";
const Nomination = lazy(() => import("../components/ClubTreasuryNomination"));
const Creation = lazy(() => import("../components/ClubTreasuryCreation"));
const Ledger = lazy(() => import("../components/ClubRewardLedger"));

function usePrivatePage<T>(fetchPage: (after: string | null) => Promise<ClubRewardPage<T>>, onAccessLost: (error: unknown) => void) {
  const [state, setState] = useState<ClubRewardPage<T> & { loading: boolean; error: unknown }>({ items: [], nextCursor: null, loading: true, error: null });
  const epoch = useRef(0), flight = useRef(false);
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return; const ticket = ++epoch.current; flight.current = true;
    setState(old => ({ items: after ? old.items : [], nextCursor: null, loading: true, error: null }));
    try { const page = await fetchPage(after); if (ticket === epoch.current) setState(old => ({ ...page, items: after ? [...old.items, ...page.items] : page.items, loading: false, error: null })); }
    catch (error) { if (ticket === epoch.current) { setState({ items: [], nextCursor: null, loading: false, error }); if (clubAccessLost(error)) onAccessLost(error); } }
    finally { if (ticket === epoch.current) flight.current = false; }
  }, [fetchPage, onAccessLost]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; }; }, [load]);
  return { ...state, load };
}
function Workspace({ onAccessLost }: { onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n(), clubs = usePrivatePage(getRewardOwnedClubs, onAccessLost), history = usePrivatePage(getClubTreasuryHistory, onAccessLost);
  const [open, setOpen] = useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const unavailable = !!clubs.error || !!history.error;
  if ((clubs.loading || history.loading) && !clubs.items.length && !history.items.length && !open && !createOpen)
    return <section className={p.empty} aria-busy="true"><p role="status">{locale === "hr" ? "Provjera pristupa klupskim nagradama…" : "Checking your club reward access…"}</p></section>;
  if (!clubs.loading && !history.loading && !unavailable && !clubs.items.length && !history.items.length && !clubs.nextCursor && !history.nextCursor) return <section className={p.empty} aria-labelledby="club-empty-title">
    <h2 id="club-empty-title" className="text-xl font-semibold">{locale === "hr" ? "Nema kluba kojim upravljate" : "No club to manage"}</h2>
    <p className="text-sm text-muted-foreground">{locale === "hr" ? "Klupske nagrade upravlja vlasnik kluba. Članstvo u klubu ne daje pristup isplatama." : "Club rewards are managed by the club owner. Club membership does not grant payment access."}</p>
    <div className="flex flex-wrap items-center gap-3"><RewardAccountSwitch hr={locale==="hr"} label={locale==="hr"?"Prijavite se računom vlasnika kluba":"Sign in with the club owner account"}/><Link className={p.secondary} to="/rewards/campaigns">{locale === "hr" ? "Kampanje" : "Campaigns"}</Link><button className={p.secondary} onClick={()=>{void clubs.load();void history.load();}}>{t("rewards.club.refreshClubs")}</button></div>
  </section>;
  return <div className="space-y-6">
    <div className={`${p.recipientLayout} ${p.clubLayout}`}><aside className={p.recipientReadiness} aria-label={locale === "hr" ? "Klub i riznica" : "Club and treasury"}>
    <section aria-labelledby="club-owner-title" className={`${p.panel} space-y-3`}>
      <h2 id="club-owner-title" className="text-xl font-semibold">{t("rewards.club.yourClubs")}</h2>
      {clubs.loading ? <p role="status">{t("rewards.loading")}</p> : clubs.error ? <p role="alert">{t(clubTreasuryErrorKey(clubs.error))}</p>
        : clubs.items.length ? <ul className="list-inside list-disc space-y-1 text-sm">{clubs.items.map(c => <li key={c.clubId} className="break-words">{c.name}</li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t("rewards.club.noClubs")}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={clubs.loading || open || createOpen} onClick={() => void clubs.load()}>{t("rewards.club.refreshClubs")}</Button>
        {clubs.nextCursor ? <Button variant="outline" disabled={clubs.loading || open || createOpen} onClick={() => void clubs.load(clubs.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
        {!open&&!createOpen ? <><Button className="h-auto whitespace-normal" disabled={clubs.loading || history.loading || unavailable || !clubs.items.length} onClick={() => setOpen(true)}>{t("rewards.club.nominate")}</Button>
        {publicEnv.hostedOperations?<Button variant="outline" disabled={clubs.loading||history.loading||unavailable||!clubs.items.length} onClick={()=>setCreateOpen(true)}>Create club treasury</Button>:null}</> : null}</div>
    </section>
    {!unavailable&&!clubs.loading&&!history.loading?<RewardReadiness label={locale==='hr'?'Spremnost kluba':'Club readiness'} steps={[
      {id:'owner',title:locale==='hr'?'Pristup vlasnika kluba':'Club owner access',detail:locale==='hr'?'Pristup potvrđen za gore navedene klubove.':'Access checked for the clubs listed above.',state:clubs.items.length?'complete':'waiting'},
      {id:'treasury',title:locale==='hr'?'Zahtjev za riznicu':'Treasury nomination',detail:history.items.some(item=>item.status==='pending_review')?(locale==='hr'?'Zahtjev je zabilježen. Provjera Safea i potpisi vlasnika slijede za svaku nagradu.':'Nomination recorded. Safe verification and owner signatures follow for each reward.'):(locale==='hr'?'Predložite klupski Safe s pravilom dva od tri potpisa.':'Nominate the club’s 2-of-3 Safe.'),state:history.items.some(item=>item.status==='pending_review')?'complete':'current'},
    ]}/>:null}
    <section aria-labelledby="club-history-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="club-history-title" className="text-xl font-semibold">{t("rewards.club.history")}</h2>
        <Button variant="outline" disabled={history.loading} onClick={() => void history.load()}>{t("rewards.club.refreshHistory")}</Button></div>
      <details className={p.howDisclosure}><summary>{locale==="hr"?"Što se bilježi":"What is recorded"}</summary><p>{t("rewards.club.historyHelp")}</p></details>
      {history.loading ? <p role="status">{t("rewards.loading")}</p> : history.error ? <p role="alert">{t(clubTreasuryErrorKey(history.error))}</p>
        : history.items.length ? <ClubTreasuryHistory items={history.items} clubs={clubs.items} onAccessLost={onAccessLost} />
          : <p className="rounded-xl border border-dashed border-border p-5 text-sm">{t("rewards.club.emptyHistory")}</p>}
      {history.nextCursor ? <Button variant="outline" disabled={history.loading} onClick={() => void history.load(history.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
    </section>
    </aside><div className={p.recipientAwards}>
    <SponsorClubClaims role="recipient" hr={locale==="hr"} chainId={publicEnv.rewardDemo?.mode==="local"?31337:10143} onAccessError={onAccessLost}/>
    </div></div>
    {open ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Nomination clubs={clubs.items} onAccessLost={onAccessLost}
      onBack={() => setOpen(false)} onSaved={() => { void history.load(); }} /></Suspense> : null}
    {createOpen?<Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Creation clubs={clubs.items} onBack={()=>setCreateOpen(false)} onSaved={()=>{void history.load();}}/></Suspense>:null}
    {!publicEnv.hostedOperations?<Button variant="outline" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen(v => !v)}>{t("rewards.clubLedger.open")}</Button>:null}
    {ledgerOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Ledger clubs={clubs.items} onAccessLost={onAccessLost} /></Suspense> : null}
  </div>;
}
function PrivateWorkspace() {
  const { t } = useI18n(), [error, setError] = useState<unknown>(null);
  return error ? <div role="alert" className={`${p.panel} space-y-3`}><p>{t(clubTreasuryErrorKey(error))}</p>
    <Button variant="outline" onClick={() => setError(null)}>{t("rewards.organizer.checkAccess")}</Button>
    <Link className="block text-primary underline" to="/auth?next=%2Fclub%2Frewards">{t("common.signIn")}</Link></div> : <Workspace onAccessLost={setError} />;
}
export default function ClubRewards() {
  const { t, locale } = useI18n(), { user, account, session, isLoading } = useAuth();
  const viewKey = useMemo(() => session ? crypto.randomUUID() : "signed-out", [session]);
  const signedIn = !isLoading && user && session && account?.userId === user.id;
  return <div className={`${p.page} ${p.workspace} space-y-6`}>
    <header className={p.heading}><div><span className={p.eyebrow} translate="no">RacesOn Podium</span>
      <h1>{t("rewards.club.title")}</h1><p>{locale==="hr"?"Klupske nagrade idu u pregledanu riznicu. Dva vlasnika Safea daju pristanak za točnu nagradu.":"Club awards go to the reviewed treasury. Two Safe owners consent to the exact reward."}</p></div><Link className={p.secondary} to="/rewards/campaigns">{locale === "hr" ? "Istraži kampanje" : "Explore campaigns"}</Link></header>
    {!publicEnv.rewardPortalEnabled || !publicEnv.rewardDemo ? <p role="status">{t("rewards.unavailable")}</p>
      : isLoading ? <p role="status">{t("rewards.loading")}</p> : signedIn ? <PrivateWorkspace key={`${user.id}:${viewKey}`} />
        : <div className="space-y-3"><p role="alert">{t("rewards.error.signIn")}</p><Link className="text-primary underline" to="/auth?next=%2Fclub%2Frewards">{t("common.signIn")}</Link></div>}
  </div>;
}
