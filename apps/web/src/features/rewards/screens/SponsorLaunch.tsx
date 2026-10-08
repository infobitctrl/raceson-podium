import {CampaignSponsor} from '../components/CampaignSponsor';
import {useEffect, useRef, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {ArrowLeft, ArrowRight, RefreshCw} from "lucide-react";
import {useAuth} from "@/lib/auth";
import {ApiError} from "@/lib/api";
import {useI18n} from "@/shared/i18n/I18nContext";
import {useRewardSessionEpoch} from "../model/useRewardSessionEpoch";
import {sponsorLaunchPlan, sponsorLaunchSourcesReady, type SponsorLaunchView} from "@raceson/domain/rewards/sponsor-launch";
import {setupId} from "@raceson/domain/rewards/distribution-setup";
import {sponsorLaunch} from "../data/sponsorLaunch";
import {readPublicDirectory} from "../data/publicDirectory";
import SponsorFunding, {type SponsorFundingSummary} from "../components/SponsorFunding";
import SponsorRecoveryCopy from "../components/SponsorRecoveryCopy";
import {sponsorDiscoveryLink} from "../model/sponsorOpportunities";
import {setupAmount,walletBalanceAmount} from "../model/setupAmount";
import s from "../components/SponsorLaunch.module.css";
import d from "../components/SponsorDashboard.module.css";
import RewardExplorerLink from "../components/RewardExplorerLink";
import {sponsorCampaignStatus} from "../model/sponsorDashboard";

export default function SponsorLaunch() {
  const {id = ""} = useParams(), {locale} = useI18n(), auth = useAuth();
  const epoch = useRewardSessionEpoch(auth.session), hr = locale === "hr";
  if (auth.isLoading) return <p className={s.page} role="status">{hr ? "Učitavanje…" : "Loading…"}</p>;
  if (!auth.user || auth.account?.userId !== auth.user.id) return <CampaignRecovery id={id} hr={hr} kind="signin"/>;
  if (!setupId(id)) return <CampaignRecovery id={id} hr={hr} kind="missing"/>;
  return <LaunchWorkspace key={`${auth.user.id}:${epoch}:${id}`} id={id} hr={hr}/>;
}

function CampaignRecovery({id, hr, kind, retry}: {id: string; hr: boolean; kind: "signin" | "auth" | "missing" | "load"; retry?: () => void}) {
  const signIn = kind === "signin" || kind === "auth";
  const t = (en: string, local: string) => hr ? local : en;
  return <article className={s.page}>
    <Link className={s.back} to="/rewards/manage"><ArrowLeft size={16}/>{t("My campaigns", "Moje kampanje")}</Link>
    <section className={`${s.card} ${s.recovery}`} aria-labelledby="campaign-recovery-title">
      <span className={s.eyebrow}>{t("Campaign access", "Pristup kampanji")}</span>
      <h1 id="campaign-recovery-title">{signIn ? t("Sign in to manage this campaign", "Prijavite se za upravljanje kampanjom") : kind === "missing" ? t("Campaign unavailable", "Kampanja nije dostupna") : t("Campaign could not be loaded", "Kampanju nije moguće učitati")}</h1>
      <p role={kind === "signin" ? undefined : "alert"}>{signIn
        ? t("Use the account that saved this campaign to continue. Your saved rules and prize funds are not changed by signing in.", "Za nastavak koristite račun kojim je kampanja spremljena. Prijava ne mijenja spremljena pravila ni nagradni fond.")
        : kind === "missing" ? t("This link is not available to this account. Check the link or open My campaigns to find a campaign you can manage.", "Ova poveznica nije dostupna ovom računu. Provjerite poveznicu ili otvorite Moje kampanje kako biste pronašli kampanju kojom možete upravljati.")
        : t("We could not retrieve the campaign details. Try again, or return to your campaigns.", "Nismo uspjeli dohvatiti podatke kampanje. Pokušajte ponovno ili se vratite na svoje kampanje.")}</p>
      <div className={s.actions}>
        {signIn ? <Link className={s.primary} to={`/auth?next=${encodeURIComponent(`/rewards/campaigns/${id}`)}`}>{t("Sign in to continue", "Prijavi se za nastavak")}<ArrowRight size={17}/></Link>
          : kind === "load" ? <button className={s.primary} onClick={retry}><RefreshCw size={16}/>{t("Try again", "Pokušaj ponovno")}</button>
          : <Link className={s.primary} to="/rewards/manage">{t("Open my campaigns", "Otvori moje kampanje")}<ArrowRight size={17}/></Link>}
        <Link className={s.secondary} to="/rewards/campaigns">{t("Browse campaigns", "Pregledaj kampanje")}</Link>
      </div>
    </section>
  </article>;
}

function LaunchWorkspace({id, hr}: {id: string; hr: boolean}) {
  const [view, setView] = useState<SponsorLaunchView | null>(null), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<"load" | "unknown" | "conflict" | "auth" | "missing" | null>(null), [busy, setBusy] = useState(false);
  const [published,setPublished]=useState(false);
  useEffect(()=>{const controller=new AbortController();setPublished(false);
    void readPublicDirectory(controller.signal).then(directory=>{if(!controller.signal.aborted)setPublished(directory.items.some(item=>item.campaign.id===id));}).catch(()=>{/* Publication is never inferred from funding or a failed directory read. */});
    return()=>controller.abort();
  },[id,attempt]);
  const [funding, setFunding] = useState<SponsorFundingSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const active = useRef(false), flight = useRef(false), request = useRef<{requestId: string; expectedRevision: number} | null>(null);
  const t = (en: string, local: string) => hr ? local : en;
  useEffect(() => {
    let current = true; active.current = true; setView(null); setError(null);
    void sponsorLaunch(id).then(result => {if (current) setView(result);}).catch(e => {if (current) setError(e instanceof ApiError && e.status === 401 ? "auth" : e instanceof ApiError && [403, 404].includes(e.status) ? "missing" : "load");});
    return () => {current = false; active.current = false;};
  }, [id, attempt]);
  async function prepare() {
    if (!view || flight.current || !sponsorLaunchSourcesReady(view.setup) || !sponsorLaunchPlan(view.setup).complete) return;
    const fixed = request.current ?? {requestId: crypto.randomUUID(), expectedRevision: view.setup.revision};
    request.current = fixed; flight.current = true; setBusy(true); setError(null);
    try {const next = await sponsorLaunch(id, fixed); if (active.current) {setView(next); request.current = null;}}
    catch (e) {if (active.current) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {setView(null); request.current = null; setError(e.status === 401 ? "auth" : "missing");}
      else if (e instanceof ApiError && [400, 409].includes(e.status)) {request.current = null; setError("conflict");}
      else setError("unknown");
    }} finally {flight.current = false; if (active.current) setBusy(false);}
  }
  useEffect(() => {
    // Freezing the reviewed revision creates no contract and moves no funds.
    if (view && !view.launch && !error && !flight.current && sponsorLaunchSourcesReady(view.setup) && sponsorLaunchPlan(view.setup).complete) void prepare();
    // An uncertain response waits for explicit retry with the original request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, error]);
  if (!view) return error
    ? <CampaignRecovery id={id} hr={hr} kind={error === "auth" ? "auth" : error === "missing" ? "missing" : "load"} retry={() => setAttempt(n => n + 1)}/>
    : <p className={s.page} role="status">{t("Loading your campaign…", "Učitavanje kampanje…")}</p>;
  const stale = Boolean(view.launch && view.launch.setup.revision !== view.setup.revision);
  const frozen = view.launch?.setup ?? view.setup, plan = sponsorLaunchPlan(frozen), currentPlan = sponsorLaunchPlan(view.setup);
  // Saved plans retain zero-share compatibility slots; they are not campaign rewards.
  const pots = plan.pots.filter(p => p.shareBps > 0);
  const pot = pots.find(p => p.id === selected) ?? pots[0];
  const edit = `/rewards/create?step=5&setup=${id}`;
  const sourceEdit=!view.setup.configuration.context&&!view.setup.configuration.sponsorSelection?sponsorDiscoveryLink(id):`/rewards/create?step=1&setup=${id}`;
  const amount = (wei: string | null) => setupAmount(wei === null ? null : BigInt(wei), hr);
  const execution = funding?.launchId === view.launch?.id && !stale ? funding : null;
  const observation = execution?.view?.observation, contractPlan = execution?.view?.record?.plan;
  const colors = ['#f56617', '#201c19', '#a89884', '#dccfb9', '#e79a67', '#586e62'];
  const allocation = <section className={d.card} aria-label={t("Campaign distribution", "Raspodjela kampanje")}>
    <h2>{t("Where the prize pool goes", "Raspodjela nagradnog fonda")}</h2>
    <div className={d.bar} role="img" aria-label={pots.map(p => `${p.name}: ${p.shareBps / 100}%`).join('; ')}>{pots.map((p, i) => <span key={p.id} style={{width: `${p.shareBps / 100}%`, background: colors[i % colors.length]}}/>)}</div>
    <div>{pots.map((p, i) => <button className={d.allocationRow} key={p.id} aria-pressed={pot?.id === p.id} onClick={() => setSelected(p.id)}><span className={d.allocationName}><i className={d.dot} style={{background: colors[i % colors.length]}}/>{p.name}</span><strong>{amount(p.amountWei)} <small className={d.unit}>test MON</small></strong><span className={d.percent}>{p.shareBps / 100}%</span></button>)}</div>
    {pot ? <details className={d.details} open={selected !== null}><summary>{t("Category budgets", "Iznosi po kategorijama")}</summary><div className={s.groups}><h3>{pot.name}</h3>{pot.groups.map(g => <div key={g.id}><span>{g.name}</span><strong>{amount(g.amountWei)}</strong></div>)}<small>test MON · {t("planned amounts", "planirani iznosi")}</small></div></details> : null}
  </section>;
  return <article className={`${s.page} ${d.page}`}>
    <header className={d.header}><div><span className={d.eyebrow}>{t("My campaigns", "Moje kampanje")}</span><h1>{frozen.configuration.name}</h1></div><div className={d.headerActions}><span className={d.badge}>{stale ? t("Setup changed · review needed", "Postavke izmijenjene · potreban pregled") : observation?.funded ? sponsorCampaignStatus(observation, hr) : observation?.cancelled ? t("Cancelled", "Otkazano") : view.launch ? t("Rewards saved", "Nagrade spremljene") : t("Saved draft", "Spremljen nacrt")}</span>{published ? <Link className={d.publicLink} to={`/rewards/campaigns/${id}/public`}>{t("Public page", "Javna stranica")}</Link> : null}</div></header>
    {stale ? <p role="status" className={s.notice}>{t(`Setup is now version ${view.setup.revision}. This launch still preserves version ${view.launch?.setup.revision}. Review the updated rules below before preparing a replacement.`, `Postavke su sada verzija ${view.setup.revision}. Ovo pokretanje čuva verziju ${view.launch?.setup.revision}. Pregledajte nove postavke ispod prije pripreme zamjene.`)} <Link to={edit}>{t("Review changes", "Pregledaj izmjene")}</Link></p> : null}
    {error ? <div role="alert" className={s.notice}><p>{error === "unknown" ? t("We could not confirm preparation. Try again to resume this campaign safely.", "Potvrda je izgubljena. Ponovite isti zahtjev za oporavak pokretanja.") : t("The campaign changed. Reload before continuing.", "Kampanja je izmijenjena. Učitajte je ponovno prije nastavka.")}</p>{error === "conflict" ? <button className={s.secondary} onClick={() => setAttempt(n => n + 1)}>{t("Reload", "Učitaj ponovno")}</button> : null}</div> : null}
    <div className={d.layout}><div className={d.main}>
      {!view.launch || stale || error === "unknown" ? <section className={s.card} aria-label={t("Campaign preparation", "Priprema kampanje")}>
        <h2>{t("Your reward account", "Vaš račun za nagrade")}</h2>
        {busy?<p role="status">{t("Getting your saved campaign ready…", "Priprema spremljene kampanje…")}</p>:null}
        {error === "unknown" || stale ? <button className={s.primary} disabled={busy || !currentPlan.complete || !sponsorLaunchSourcesReady(view.setup) || error === "conflict"} onClick={() => void prepare()}>{busy ? t("Preparing…", "Priprema…") : stale ? t("Use latest saved setup", "Koristi najnovije spremljene postavke") : t("Try again", "Pokušaj ponovno")}<ArrowRight size={17}/></button>:null}
        {!sponsorLaunchSourcesReady(view.setup)?<p role="status">{t("This campaign needs its official reward categories connected before its reward account can be created.","Kampanja treba povezane službene kategorije prije izrade računa za nagrade.")} <Link to={sourceEdit}>{t("Open campaign setup", "Otvori postavke kampanje")}</Link></p>:null}
        {!currentPlan.complete?<p><Link to={edit}>{t("Complete the pot distributions first.", "Najprije dovršite raspodjelu fondova.")}</Link></p>:null}
        {error?<button className={s.secondary} disabled={busy || error === "unknown"} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16}/>{t("Refresh status", "Osvježi status")}</button>:null}
      </section>:null}
      {view.launch&&!sponsorLaunchSourcesReady(view.launch.setup)?<SponsorRecoveryCopy key={`recovery:${view.launch.id}`} launch={view.launch} hr={hr}/>:null}
      {view.launch && !stale ? <SponsorFunding key={view.launch.id} launch={view.launch} hr={hr} published={published} onSummary={setFunding} allocation={allocation}/> : null}
      {!view.launch || stale ? allocation : null}
    </div><aside className={d.aside}>
      <section className={d.card} aria-label={t("Money", "Sredstva")}><h2>{t("Money", "Sredstva")}</h2><dl className={d.money}>
        <div><dt>{t("Total campaign budget", "Ukupni proračun kampanje")}</dt><dd><strong>{amount(plan.budgetWei)}</strong> <small className={d.unit}>test MON</small></dd></div>
        <div><dt>{t("Selected prize pool", "Odabrani nagradni fond")}</dt><dd><strong>{amount(contractPlan?.budgetWei ?? plan.budgetWei)}</strong> <small className={d.unit}>test MON</small></dd></div>
        <div><dt>{t("Deposited prize funds", "Uplaćene nagrade")}</dt><dd>{observation ? <><strong>{amount(observation.funded ? contractPlan?.budgetWei ?? null : '0')}</strong> <small className={d.unit}>test MON</small></> : t("Not yet verified", "Još nije provjereno")}</dd></div>
        <div><dt>{t("Your wallet balance", "Stanje vašeg novčanika")}</dt><dd>{execution?.walletConnected ? execution.balanceWei !== null ? <><strong>{walletBalanceAmount(BigInt(execution.balanceWei),hr)}</strong> <small className={d.unit}>test MON</small></> : t("Connected · check balance", "Povezan · provjerite stanje") : t("Not connected", "Nije povezan")}</dd></div>
        <div><dt>{t("Platform gas reserve", "Rezerva za plin platforme")}</dt><dd className={d.gas}>{t("RacesOn pays creation gas", "RacesOn plaća plin za izradu")}<br/>{t("not part of your budget", "nije dio vašeg proračuna")}</dd></div>
      </dl></section>
      <section className={`${d.card} ${d.terms}`}><h2>{t("Terms", "Uvjeti")}</h2>
        <p>{t("Claim window", "Rok preuzimanja")}: <strong>{contractPlan ? contractPlan.claimLifetime / 86400 : frozen.configuration.policy?.claimWindowDays} {t("days", "dana")}</strong></p>
        <p>{t("Unclaimed funds", "Nepreuzeta sredstva")}: <strong>{contractPlan ? contractPlan.expiredTreasury === contractPlan.funder ? t("Back to the sponsor wallet", "Povrat u novčanik sponzora") : <RewardExplorerLink chainId={frozen.chainId} kind="address" value={contractPlan.expiredTreasury}>{`${contractPlan.expiredTreasury.slice(0, 6)}…${contractPlan.expiredTreasury.slice(-4)}`}</RewardExplorerLink> : frozen.configuration.policy?.treasuryReturn === 'original_sender' ? t("Back to the sponsor wallet", "Povrat u novčanik sponzora") : t("RacesOn treasury", "RacesOn riznica")}</strong></p>
        {contractPlan && contractPlan.unallocatedTreasury !== contractPlan.expiredTreasury ? <p className={d.contract}>{t("Unallocated funds return to", "Neraspodijeljena sredstva vraćaju se na")} <RewardExplorerLink chainId={frozen.chainId} kind="address" value={contractPlan.unallocatedTreasury}>{`${contractPlan.unallocatedTreasury.slice(0, 6)}…${contractPlan.unallocatedTreasury.slice(-4)}`}</RewardExplorerLink></p> : null}
        <p className={d.contract}>{observation ? <>{t("Contract", "Ugovor")} <RewardExplorerLink chainId={frozen.chainId} kind="address" value={observation.address}>{`${observation.address.slice(0, 6)}…${observation.address.slice(-4)}`}</RewardExplorerLink> · {t("rules locked", "pravila zaključana")}</> : frozen.chainId === 10143 ? 'Monad testnet' : t('Local simulation', 'Lokalna simulacija')}</p>
        {contractPlan && contractPlan.launchId !== view.launch?.id ? <p className={d.contract}>{t("This contract retains its earlier saved rules and budget.", "Ovaj ugovor čuva ranija spremljena pravila i proračun.")}</p> : null}
        <details className={d.sponsorDetails}><summary>{t("Campaign settings & sponsor", "Postavke kampanje i sponzor")}</summary><CampaignSponsor id={id} hr={hr}/><Link to={edit}>{t("Campaign setup", "Postavke kampanje")}</Link></details>
      </section>
    </aside></div>
  </article>;
}
