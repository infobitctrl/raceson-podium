import ClubMemberWorkspace from '../components/ClubMemberWorkspace';
import { ShieldCheck, Users, Wallet } from "lucide-react";
import setup from "../components/ClubTreasurySetup.module.css";
import { clubSafeCreationHistory, type ClubCreationRecord } from "../data/clubSafeCreation";
import RewardReadiness from "../components/RewardReadiness";
import RewardExplorerLink from "../components/RewardExplorerLink";
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
const getCreationHistory = async (after: string | null): Promise<ClubRewardPage<ClubCreationRecord>> => {
  if (!publicEnv.hostedOperations) return {items: [], nextCursor: null};
  const page = await clubSafeCreationHistory(after);
  return {items: page.items, nextCursor: page.nextCursor};
};

function Workspace({ onAccessLost }: { onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n(), clubs = usePrivatePage(getRewardOwnedClubs, onAccessLost), history = usePrivatePage(getClubTreasuryHistory, onAccessLost);
  const [open, setOpen] = useState(false);
  const creations = usePrivatePage(getCreationHistory, onAccessLost);
  const refreshCreations = creations.load;
  const [setupChoice, setSetupChoice] = useState<'create' | 'overview' | null>(null);
  const [walletDetailsOpen, setWalletDetailsOpen] = useState(false);
  const treasuryReady = publicEnv.hostedOperations && !clubs.loading && !clubs.error && !clubs.nextCursor
    && !creations.loading && !creations.error && clubs.items.length > 0
    && clubs.items.every(club => creations.items.some(item => item.clubId === club.clubId && item.current && item.verified));
  const onTreasuryVerified = useCallback(() => {
    setWalletDetailsOpen(false);
    setSetupChoice('overview');
    void refreshCreations();
  }, [refreshCreations]);
  const firstSetup = publicEnv.hostedOperations && !clubs.loading && !history.loading && !creations.loading
    && !clubs.error && !history.error && !creations.error && clubs.items.length > 0
    && !history.items.length && !history.nextCursor && !creations.items.length && !creations.nextCursor;
  // Choose the first-visit view once; later history refreshes must not discard an in-progress setup.
  useEffect(() => { if (firstSetup) setSetupChoice(choice => choice ?? 'create'); }, [firstSetup]);
  const createOpen = !open && (setupChoice === 'create' || (setupChoice === null && firstSetup));
  const setupUnavailable = clubs.loading || history.loading || creations.loading || !!clubs.error || !!history.error || !!creations.error || !clubs.items.length;
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const unavailable = !!clubs.error || !!history.error;
  if ((clubs.loading || history.loading) && !clubs.items.length && !history.items.length && !open && !createOpen)
    return <section className={p.empty} aria-busy="true"><p role="status">{locale === "hr" ? "Provjera pristupa klupskim nagradama…" : "Checking your club reward access…"}</p></section>;
  if (!clubs.loading && !history.loading && !unavailable && !clubs.items.length && !history.items.length && !clubs.nextCursor && !history.nextCursor) return <section className={p.empty} aria-labelledby="club-empty-title">
    <h2 id="club-empty-title" className="text-xl font-semibold">{locale === "hr" ? "Nema kluba kojim upravljate" : "No club to manage"}</h2>
    <p className="text-sm text-muted-foreground">{locale === "hr" ? "Klupske nagrade upravlja vlasnik kluba. Članstvo u klubu ne daje pristup isplatama." : "Club rewards are managed by the club owner. Club membership does not grant payment access."}</p>
    <div className="flex flex-wrap items-center gap-3"><RewardAccountSwitch hr={locale==="hr"} label={locale==="hr"?"Prijavite se računom vlasnika kluba":"Sign in with the club owner account"}/><Link className={p.secondary} to="/rewards/campaigns">{locale === "hr" ? "Kampanje" : "Campaigns"}</Link><button className={p.secondary} onClick={()=>{void clubs.load();void history.load();}}>{t("rewards.club.refreshClubs")}</button></div>
  </section>;
  const treasurySetup = publicEnv.hostedOperations && clubs.items.length > 0 ? <section className={setup.card} aria-labelledby="club-setup-title">
      <div className={setup.intro}><span className={setup.icon}><ShieldCheck size={24} aria-hidden="true"/></span><div>
        <span className={setup.badge}>{locale === 'hr' ? 'Preporučeno · Privy' : 'Recommended · Privy'}</span>
        <h2 id="club-setup-title">{locale === 'hr' ? 'Postavite klupsku riznicu uz Privy' : 'Set up your club treasury with Privy'}</h2>
        <p>{locale === 'hr' ? 'Započnite ovdje kako bi vaš klub mogao preuzimati nagrade. Odaberite tri člana i postavite zajedničku riznicu u Podiumu.' : 'Start here so your club can claim rewards. Choose three members and set up a shared treasury in Podium.'}</p>
      </div></div>
      <ul className={setup.benefits}>
        <li><Users size={16} aria-hidden="true"/>{locale === 'hr' ? 'Tri člana · dva potpisa' : 'Three members · two approvals'}</li>
        <li><Wallet size={16} aria-hidden="true"/>{locale === 'hr' ? 'Privy novčanici članova' : 'Members’ Privy wallets'}</li>
        <li><ShieldCheck size={16} aria-hidden="true"/>{locale === 'hr' ? 'Naknadu pokriva RacesOn' : 'Setup fee covered by RacesOn'}</li>
      </ul>
      {creations.loading ? <p role="status">{locale === 'hr' ? 'Provjera postojeće riznice…' : 'Checking existing treasury setup…'}</p> : creations.error ? <div role="alert"><p>{locale === 'hr' ? 'Nije moguće provjeriti postojeću riznicu.' : 'Existing treasury setup could not be checked.'}</p><Button variant="outline" onClick={()=>void creations.load()}>{locale === 'hr' ? 'Pokušaj ponovno' : 'Retry treasury check'}</Button></div> : null}
      {!createOpen && !open ? <Button disabled={setupUnavailable} onClick={()=>setSetupChoice('create')} className={setup.primary}>{locale === 'hr' ? 'Postavi klupsku riznicu uz Privy' : 'Create club treasury with Privy'}</Button> : null}
      {createOpen ? <Suspense fallback={<p role="status">{t('rewards.loading')}</p>}><Creation clubs={clubs.items} onBack={()=>setSetupChoice('overview')} onVerified={onTreasuryVerified} onSaved={()=>{setSetupChoice('create');void history.load();void creations.load();}}/></Suspense> : null}
      {!createOpen ? <details className={setup.alternatives}><summary>{locale === 'hr' ? 'Druge mogućnosti riznice' : 'Other treasury options'}</summary>
        <p>{locale === 'hr' ? 'Već imate klupsku Safe riznicu? Predložite postojeću adresu s pravilom dva od tri potpisa.' : 'Already have a club Safe treasury? Nominate its existing address with two-of-three approval.'}</p>
        <Button variant="outline" disabled={setupUnavailable || open} onClick={()=>{setSetupChoice('overview');setOpen(true);}}>{t('rewards.club.nominate')}</Button>
      </details> : null}
      {open ? <Suspense fallback={<p role="status">{t('rewards.loading')}</p>}><Nomination clubs={clubs.items} onAccessLost={onAccessLost} onBack={()=>setOpen(false)} onSaved={()=>void history.load()}/></Suspense> : null}
    </section> : null;
  const treasuryOverview = <aside className={p.recipientReadiness} aria-label={locale === "hr" ? "Klub i riznica" : "Club and treasury"}>
    <section aria-labelledby="club-owner-title" className={`${p.panel} space-y-3`}>
      <h2 id="club-owner-title" className="text-xl font-semibold">{t("rewards.club.yourClubs")}</h2>
      {clubs.loading ? <p role="status">{t("rewards.loading")}</p> : clubs.error ? <p role="alert">{t(clubTreasuryErrorKey(clubs.error))}</p>
        : clubs.items.length ? <ul className="list-inside list-disc space-y-1 text-sm">{clubs.items.map(c => <li key={c.clubId} className="break-words">{c.name}</li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t("rewards.club.noClubs")}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={clubs.loading || open || createOpen} onClick={() => void clubs.load()}>{t("rewards.club.refreshClubs")}</Button>
        {clubs.nextCursor ? <Button variant="outline" disabled={clubs.loading || open || createOpen} onClick={() => void clubs.load(clubs.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
        {!publicEnv.hostedOperations && !open ? <Button className="h-auto whitespace-normal" disabled={clubs.loading || history.loading || unavailable || !clubs.items.length} onClick={() => setOpen(true)}>{t("rewards.club.nominate")}</Button> : null}</div>
    </section>
    {!unavailable&&!clubs.loading&&!history.loading?<RewardReadiness label={locale==='hr'?'Spremnost kluba':'Club readiness'} steps={[
      {id:'owner',title:locale==='hr'?'Pristup vlasnika kluba':'Club owner access',detail:locale==='hr'?'Pristup potvrđen za gore navedene klubove.':'Access checked for the clubs listed above.',state:clubs.items.length?'complete':'waiting'},
      {id:'treasury',title:locale==='hr'?'Klupska riznica':'Club treasury',detail:treasuryReady?(locale==='hr'?'Riznica je potvrđena. Klupske nagrade preuzimaju dva odabrana vlasnika.':'Treasury verified. Two selected owners approve club reward claims.'):publicEnv.hostedOperations?(locale==='hr'?'Postavite riznicu uz Privy iznad. Postojeća Safe riznica dostupna je pod drugim mogućnostima.':'Set up with Privy above. An existing Safe treasury is available under other options.'):(locale==='hr'?'Predložite klupski Safe s pravilom dva od tri potpisa.':'Nominate the club’s 2-of-3 Safe.'),state:(publicEnv.hostedOperations?treasuryReady:history.items.some(item=>item.status==='pending_review'))?'complete':'current'},
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
    </aside>;
  const claims = <SponsorClubClaims role="recipient" hr={locale==="hr"} chainId={publicEnv.rewardDemo?.mode==="local"?31337:10143} onAccessError={onAccessLost}/>;
  return <div className="space-y-4">
    {treasuryReady ?
      <details className={setup.completed} open={walletDetailsOpen} onToggle={event=>setWalletDetailsOpen(event.currentTarget.open)}>
        <summary><Wallet size={18} aria-hidden="true"/><span>{locale==='hr'?'Novčanik i riznica':'Wallet & treasury'}</span><span className={setup.ready}><ShieldCheck size={15} aria-hidden="true"/>{locale==='hr'?'Potvrđeno':'Verified'}</span></summary>
        <div className={setup.completedBody}>
          <p className="text-sm text-muted-foreground">{locale==='hr'?'Riznica je spremna. Detalji stvaranja i povijest dostupni su ovdje.':'Your treasury is ready. Creation details and history are available here.'}</p>
          <ul className={setup.creationHistory}>{creations.items.filter(item=>clubs.items.some(club=>club.clubId===item.clubId)).map(item=><li key={item.requestId}>
            <strong>{clubs.items.find(club=>club.clubId===item.clubId)?.name}</strong>
            <p>{item.current&&item.verified?(locale==='hr'?'Potvrđena riznica · 2 od 3 potpisa':'Verified treasury · 2 of 3 approvals'):(locale==='hr'?'Prethodni zahtjev za stvaranje':'Previous creation request')}</p>
            {item.verified?<><RewardExplorerLink chainId={10143} kind="address" value={item.verified.safeAddress}/><p><RewardExplorerLink chainId={10143} kind="tx" value={item.verified.transactionHash}/></p></>:null}
            <details><summary>{locale==='hr'?'Podaci o stvaranju i vlasnicima':'Creation and owner details'}</summary><p className="break-all">{item.requestId}</p><ul>{item.owners.map(owner=><li key={owner}><RewardExplorerLink chainId={10143} kind="address" value={owner}/></li>)}</ul></details>
          </li>)}</ul>
          {creations.nextCursor?<Button variant="outline" disabled={creations.loading} onClick={()=>void creations.load(creations.nextCursor)}>{t('rewards.loadMore')}</Button>:null}
          {!createOpen&&!open?<Button variant="outline" onClick={()=>setSetupChoice('create')}>{locale==='hr'?'Upravljaj riznicom':'Manage treasury'}</Button>:null}
          {createOpen||open?treasurySetup:null}
          {treasuryOverview}
        </div>
      </details> : treasurySetup}
    {/* Keep the claims subtree mounted when treasury history finishes loading;
        moving it between conditional branches restarted all status checks. */}
    <div className={treasuryReady ? undefined : `${p.recipientLayout} ${p.clubLayout}`}>
      {!treasuryReady ? treasuryOverview : null}
      <div className={p.recipientAwards}>{claims}</div>
    </div>
    {!publicEnv.hostedOperations && open ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Nomination clubs={clubs.items} onAccessLost={onAccessLost}
      onBack={() => setOpen(false)} onSaved={() => { void history.load(); }} /></Suspense> : null}
    {!publicEnv.hostedOperations?<Button variant="outline" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen(v => !v)}>{t("rewards.clubLedger.open")}</Button>:null}
    {ledgerOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Ledger clubs={clubs.items} onAccessLost={onAccessLost} /></Suspense> : null}
  </div>;
}
function PrivateWorkspace() {
  const { t, locale } = useI18n(), [error, setError] = useState<unknown>(null);
  return error ? <div role="alert" className={`${p.panel} space-y-3`}><p>{t(clubTreasuryErrorKey(error))}</p>
    <Button variant="outline" onClick={() => setError(null)}>{t("rewards.organizer.checkAccess")}</Button>
    <RewardAccountSwitch hr={locale==='hr'} label={locale==='hr'?'Prijavite se računom vlasnika kluba':'Sign in with the club owner account'}/></div> : publicEnv.hostedOperations ? <ClubMemberWorkspace hr={locale==='hr'}><Workspace onAccessLost={setError}/></ClubMemberWorkspace> : <Workspace onAccessLost={setError} />;
}
export default function ClubRewards() {
  const { t, locale } = useI18n(), { user, account, session, isLoading } = useAuth();
  const viewKey = useMemo(() => session ? crypto.randomUUID() : "signed-out", [session]);
  const signedIn = !isLoading && user && session && account?.userId === user.id;
  return <div className={`${p.page} ${p.workspace} space-y-6`}>
    <header className={p.heading}><div><span className={p.eyebrow} translate="no">RacesOn Podium</span>
      <h1>{t("rewards.club.title")}</h1><p>{locale==="hr"?"Klupske nagrade idu u riznicu s dva od tri potpisa. Nakon objave raspodjele dva vlasnika potpisuju i šalju preuzimanje nagrade nove kampanje.":"Club awards go to your 2-of-3 treasury. Once distribution is published, two owners sign and submit each new campaign’s claim."}</p></div><Link className={p.secondary} to="/rewards/campaigns">{locale === "hr" ? "Istraži kampanje" : "Explore campaigns"}</Link></header>
    {!publicEnv.rewardPortalEnabled || !publicEnv.rewardDemo ? <p role="status">{t("rewards.unavailable")}</p>
      : isLoading ? <p role="status">{t("rewards.loading")}</p> : signedIn ? <PrivateWorkspace key={`${user.id}:${viewKey}`} />
        : <div className="space-y-3"><p role="alert">{t("rewards.error.signIn")}</p><Link className="text-primary underline" to="/auth?next=%2Fclub%2Frewards">{t("common.signIn")}</Link></div>}
  </div>;
}
