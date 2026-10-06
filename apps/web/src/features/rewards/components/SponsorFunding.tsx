import {walletActionLabel} from "../model/walletActionLabel";
import SponsorCompleteSetup from "./SponsorCompleteSetup";
import RewardExplorerLink from "./RewardExplorerLink";
import {useEffect, useId, useRef, useState, type ReactNode} from "react";
import {ArrowRight, Check, Circle, LoaderCircle, RefreshCw} from "lucide-react";
import {ApiError} from "@/lib/api";
import {sponsorLaunchSourcesReady, type SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import {decodeCopySponsorLaunchBinding,type CopySponsorLaunchBinding} from '@raceson/domain/rewards/copy-sponsor-launch';
import {sponsorTxHash} from "@raceson/domain/rewards/sponsor-execution";
import {sponsorExecution, type SponsorExecutionAction, type SponsorExecutionView} from "../data/sponsorExecution";
import {checkSponsorTransaction, sendSponsorTransaction, sponsorTransactionGasLimit, type SponsorReadiness} from "../data/sponsorTransaction";
import type {DetectedRewardWallet} from "../data/browserWallet";
import SponsorWallet from "./SponsorWallet";
import SponsorDistribution from "./SponsorDistribution";
import {setupAmount} from "../model/setupAmount";
import {clearSponsorReceipt, readSponsorReceipt, saveSponsorReceipt, sponsorReceiptConfirmed, sponsorReceiptKey, type SponsorPendingReceipt as Pending} from "../model/sponsorPendingReceipt";
import s from "./SponsorLaunch.module.css";
import d from "./SponsorDashboard.module.css";

export type SponsorFundingSummary = {launchId: string; view: SponsorExecutionView | null; walletConnected: boolean; balanceWei: string | null};
type Props={copyBinding?:CopySponsorLaunchBinding; allocation?: ReactNode; onSummary?: (summary: SponsorFundingSummary) => void; launch: SponsorLaunch; hr: boolean; published?:boolean; onFunded?: (funded: boolean) => void};
type ReceiptIssue="pending"|"reverted"|"mismatch"|"unavailable";
// Check promptly after broadcast, then back off. One verification at a time;
// none of these checks can send a wallet transaction.
const receiptRetryDelays = [2000, 3000, 5000, 10000, 15000, 30000] as const;
function receiptIssueFrom(error:unknown):ReceiptIssue|null {
  if(!(error instanceof ApiError))return null;
  switch(error.code){
    case "sponsor_receipt_pending":return "pending";
    case "sponsor_receipt_reverted":return "reverted";
    case "sponsor_receipt_mismatch":return "mismatch";
    case "sponsor_observation_unavailable":return "unavailable";
    default:return null;
  }
}
const pausesReceipt=(e:unknown)=>e instanceof ApiError&&[400,401,403,404,409,422].includes(e.status);
function creationCheckAction(view:SponsorExecutionView):SponsorExecutionAction|undefined {
  if(!view.record||view.record.deploymentHash)return undefined;
  // A saved hash needs receipt verification, never another broadcast request.
  if(view.creation?.hash)return {action:"deployment",hash:view.creation.hash};
  return view.creation?.status==="processing"?{action:"launch"}:undefined;
}
function TransactionProgress({phase,hr,creation=false,paused=false,children}:{phase:0|2|3;hr:boolean;creation?:boolean;paused?:boolean;children:ReactNode}) {
  const labels=hr?[creation?"Priprema":"Potvrda u novčaniku","Poslano","Potvrđivanje","Potvrđeno"]:[creation?"Preparing":"Wallet confirmation","Submitted","Confirming","Confirmed"];
  return <div className={s.transactionProgress} role="group" aria-label={hr?creation?"Napredak izrade ugovora":"Napredak uplate":creation?"Contract creation progress":"Prize deposit progress"}>
    <ol aria-label={hr?"Napredak transakcije":"Transaction progress"}>{labels.map((label,index)=><li key={label} data-complete={phase===3||index<phase} aria-current={index===phase&&phase!==3?"step":undefined}><span>{phase===3||index<phase?<Check size={16} aria-hidden="true"/>:index===phase?paused?<Circle size={16} aria-hidden="true"/>:<span className={s.transactionSpinner}><LoaderCircle size={16} aria-hidden="true"/></span>:index+1}</span>{label}</li>)}</ol>
    {children}
  </div>;
}
export default function SponsorFunding(props:Props){
  return <FundingWorkspace key={sponsorReceiptKey(props.launch)} {...props}/>;
}
function FundingWorkspace({launch, hr, onFunded, onSummary, allocation, published=false,copyBinding}: Props) {
  const journeyId = useId();
  let copyReady=false;try{copyReady=Boolean(copyBinding&&decodeCopySponsorLaunchBinding(copyBinding,launch));}catch{/* A stale display binding cannot enable a new deposit. */}
  const sourcesReady = sponsorLaunchSourcesReady(launch.setup)||copyReady;
  const [view, setView] = useState<SponsorExecutionView | null>(null), [wallet, setWallet] = useState<{wallet: DetectedRewardWallet; address: string} | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [requestingCreation,setRequestingCreation]=useState(false),[requestingDeposit,setRequestingDeposit]=useState(false);
  const [recovery, setRecovery] = useState("");
  const [receiptProblem,setReceiptProblem]=useState<(Pending&{kind:ReceiptIssue})|null>(null);
  const receiptIssue=receiptProblem&&pending?.hash===receiptProblem.hash&&pending.action===receiptProblem.action?receiptProblem.kind:null;
  const [copied,setCopied]=useState(false);
  const [checking, setChecking] = useState(false), [checkFailed, setCheckFailed] = useState(false);
  const [receiptPaused,setReceiptPaused]=useState(false),[receiptCheck,setReceiptCheck]=useState(false),[receiptFailed,setReceiptFailed]=useState(false),[durable,setDurable]=useState(true);
  const operatorWallet: {wallet: DetectedRewardWallet; address: string} | null = null;
  const operatorRef = useRef(operatorWallet); operatorRef.current = operatorWallet;
  const [readiness, setReadiness] = useState<SponsorReadiness | null>(null);
  const live = useRef(false), flight = useRef(false), walletRef = useRef(wallet); walletRef.current = wallet;
  const viewEpoch=useRef(0),pendingRef=useRef(pending);pendingRef.current=pending;
  const storageKey = sponsorReceiptKey(launch);
  const verifyRef=useRef<(p:Pending)=>Promise<void>>(async()=>{});
  const t = (en: string, local: string) => hr ? local : en;
  useEffect(() => {setReadiness(null);}, [wallet, operatorWallet, view?.record?.deploymentHash]);
  useEffect(() => {onSummary?.({launchId: launch.id, view, walletConnected: Boolean(wallet), balanceWei: readiness?.balanceWei ?? null});}, [launch.id, view, wallet, readiness, onSummary]);
  useEffect(() => {onFunded?.(view?.observation?.funded === true);}, [view?.observation?.funded, onFunded]);
  useEffect(() => {
    let current = true; live.current = true;
    const p=readSponsorReceipt(launch);if(p){pendingRef.current=p;setPending(p);setDurable(saveSponsorReceipt(launch,p));}
    const epoch=++viewEpoch.current;
    void sponsorExecution(launch.setup.id).then(v => {if (current&&viewEpoch.current===epoch) setView(v);}).catch(() => {if (current&&viewEpoch.current===epoch) setError("load");});
    return () => {current = false; live.current = false;};
    // Exact scope is mounted with sponsorReceiptKey; changing locale must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch.setup.id, storageKey]);
  useEffect(()=>{
    const receive=(event:StorageEvent)=>{
      if(event.key!==storageKey)return;
      const p=readSponsorReceipt(launch);
      // A different tab may already have verified it. Keep our receipt until
      // this tab also sees server confirmation; a storage removal is not proof.
      if(p){
        if(pendingRef.current?.hash!==p.hash||pendingRef.current.action!==p.action){setReceiptProblem(null);setReceiptPaused(false);setReceiptFailed(false);setError(null);}
        pendingRef.current=p;setPending(current=>current?.hash===p.hash&&current.action===p.action?current:p);
      }
    };
    window.addEventListener("storage",receive);return()=>window.removeEventListener("storage",receive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storageKey]);
  const loaded=Boolean(view);
  useEffect(()=>{
    if(!pending||!loaded||receiptPaused)return;
    let current=true,attempts=0,timer:ReturnType<typeof setTimeout>;
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void check(),receiptRetryDelays[Math.min(attempts,receiptRetryDelays.length-1)]);};
    async function check(){
      if(!current)return;
      if(document.visibilityState==="hidden"||flight.current){schedule();return;}
      flight.current=true;setReceiptCheck(true);
      try{await verifyRef.current(pending!);}
      catch(e){if(current&&live.current){
        setReceiptFailed(true);attempts++;
        if(pausesReceipt(e)||attempts>=receiptRetryDelays.length){setReceiptPaused(true);return;}
        schedule();
      }}finally{flight.current=false;if(current&&live.current)setReceiptCheck(false);}
    }
    const visible=()=>{if(document.visibilityState==="visible"){clearTimeout(timer);void check();}};
    schedule();document.addEventListener("visibilitychange",visible);
    return()=>{current=false;clearTimeout(timer);document.removeEventListener("visibilitychange",visible);};
  },[pending,loaded,receiptPaused]);
  // Advance only a sponsor-requested, durable job. GET never starts creation.
  useEffect(()=>{
    if(!view?.record||view.record.deploymentHash||pending||!["processing","submitted"].includes(view?.creation?.status??""))return;
    let current=true,checking=false;
    const timer=setInterval(()=>{
      if(checking||flight.current||document.visibilityState==="hidden")return;
      checking=true; setChecking(true);
      void sponsorExecution(launch.setup.id,creationCheckAction(view)).then(next=>{if(current&&live.current&&!flight.current){setChecking(false);setView(next);setCheckFailed(false);}}).catch(()=>{if(current&&live.current)setCheckFailed(true);}).finally(()=>{checking=false;if(current&&live.current)setChecking(false);});
    },15000);
    return()=>{current=false;clearInterval(timer);};
  },[launch.setup.id,view,pending]);
  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(null);
    try {await action();} catch (e) {if (live.current) {setError(e instanceof Error ? e.message : "failed");if(pausesReceipt(e))setReceiptPaused(true);}}
    finally {flight.current = false; if (live.current) setBusy(false);}
  }
  async function requestCreation(prepare:boolean) {
    setRequestingCreation(true);
    try {
      if(prepare){
        const selected=walletRef.current;if(!selected||!sourcesReady)return;
        const next=await sponsorExecution(launch.setup.id,{action:"prepare",launchId:launch.id,funder:selected.address});
        if(!live.current)return;setView(next);
      }
      const started=await sponsorExecution(launch.setup.id,{action:"launch"});if(live.current)setView(started);
    } finally {if(live.current)setRequestingCreation(false);}
  }
  async function refreshStatus() {
    const next=await sponsorExecution(launch.setup.id,view?creationCheckAction(view):undefined);
    if(live.current){setView(next);setCheckFailed(false);}
  }
  async function verify(p: Pending) {
    let next:SponsorExecutionView;
    try {next=await sponsorExecution(launch.setup.id,p);}
    catch(e){
      if(!live.current||pendingRef.current?.hash!==p.hash||pendingRef.current.action!==p.action)return;
      const kind=receiptIssueFrom(e);setReceiptProblem(kind?{...p,kind}:null);
      throw e;
    }
    if (!live.current) return;
    ++viewEpoch.current;
    setView(next);
    if(pendingRef.current?.hash===p.hash&&pendingRef.current.action===p.action)setReceiptProblem(null);
    if(!sponsorReceiptConfirmed(next,p))throw Error("sponsor_receipt_unconfirmed");
    clearSponsorReceipt(launch,p);
    if(pendingRef.current?.hash===p.hash&&pendingRef.current.action===p.action)pendingRef.current=null;
    setPending(current=>current?.hash===p.hash&&current.action===p.action?null:current);setReceiptProblem(null);setRecovery("");setReceiptFailed(false);setError(null);setReceiptCheck(false);
  }
  verifyRef.current=verify;
  function remember(p:Pending){pendingRef.current=p;setDurable(saveSponsorReceipt(launch,p));setPending(p);setReceiptProblem(null);setReceiptPaused(false);setReceiptFailed(false);}
  async function send(action: "deployment" | "funding", inspect = false) {
    if (!sourcesReady) return;
    const selectedRef = action === "deployment" ? operatorRef : walletRef;
    const selected = selectedRef.current;
    const hasPending=()=>Boolean(pendingRef.current||readSponsorReceipt(launch));
    if (!selected || hasPending()) return;
    const fresh = await sponsorExecution(launch.setup.id), plan = fresh.record?.plan;
    if(hasPending())return;
    if (!live.current || selectedRef.current !== selected || !fresh.enabled || !plan || (action === "deployment" ? plan.operator : plan.funder) !== selected.address
      || action === "deployment" && fresh.record?.deploymentHash || action === "funding" && (!fresh.observation || fresh.observation.funded || fresh.observation.cancelled)) throw Error("sponsor_wallet_changed");
    const request = {plan, action, ...(action === "funding" ? {address: fresh.observation!.address} : {})};
    if (inspect) {
      const result = selected.wallet.checkSponsorTransaction
        ? await selected.wallet.checkSponsorTransaction(request, () => live.current && selectedRef.current === selected&&!hasPending())
        : await checkSponsorTransaction(selected.wallet.provider, request, () => live.current && selectedRef.current === selected&&!hasPending());
      if (live.current && selectedRef.current === selected) setReadiness(result);
      return;
    }
    const hash = selected.wallet.sendSponsorTransaction
      ? await selected.wallet.sendSponsorTransaction(request, () => live.current && selectedRef.current === selected&&!hasPending())
      : await sendSponsorTransaction(selected.wallet.provider, request, () => live.current && selectedRef.current === selected&&!hasPending());
    const p = {action, hash};
    const stored=saveSponsorReceipt(launch,p);
    if (!live.current) return;
    pendingRef.current=p;setDurable(stored);setPending(p);setReceiptPaused(false);await verify(p);
  }
  const record = view?.record, observation = view?.observation, plan = record?.plan;
  const deployment = !record?.deploymentHash;
  const unavailable=Boolean(view&&deployment&&(!view?.enabled||!view?.creation||view?.creation.status==="unavailable"));
  const budget=plan?setupAmount(BigInt(plan.budgetWei),hr):launch.setup.configuration.budgetMon;
  const activeWallet = deployment ? operatorWallet : wallet;
  const requiredAddress = deployment ? plan?.operator : plan?.funder;
  const gasLimit = setupAmount(sponsorTransactionGasLimit(deployment ? "deployment" : "funding"), hr);
  const funded = observation?.funded === true;
  const accountReady = Boolean(record?.deploymentHash && observation);
  const creating = !accountReady && ["processing", "submitted"].includes(view?.creation?.status ?? "");
  const creationBlocked = unavailable && view?.creation?.reason === "controller_busy";
  const creationQueued = creating && view?.creation?.reason === "controller_busy";
  const creationSubmitted = creating && Boolean(view?.creation?.hash);
  const walletReady = Boolean(wallet && (!plan || wallet.address === plan.funder));
  const step = pending ? pending.action === "funding" ? 2 : 1 : funded ? 3 : !plan && !walletReady ? 0 : !accountReady ? 1 : 2;
  const marker = (index: number, complete: boolean) => <span className={s.stepNumber} aria-hidden="true">{complete ? <Check size={16}/> : index + 1}</span>;
  const receiptHeading=receiptIssue==="reverted"?t("Transaction failed","Transakcija nije uspjela")
    :receiptIssue==="mismatch"?t("Transaction needs review","Potrebna je provjera transakcije")
    :receiptIssue==="unavailable"?t("Receipt check unavailable","Provjera potvrde nije dostupna")
    :pending?.action==="funding"?t("Confirming your deposit","Potvrđujemo vašu uplatu"):t("Confirming your reward account","Potvrđujemo račun za nagrade");
  const receiptDetail=receiptIssue==="reverted"?t("The network finalized this transaction as failed. It did not complete this campaign action. Review the transaction in the explorer; its hash is retained.","Mreža je konačno potvrdila neuspjeh ove transakcije. Radnja kampanje nije izvršena. Pregledajte transakciju u pregledniku mreže; hash je sačuvan.")
    :receiptIssue==="mismatch"?t("This receipt could not be matched to the saved campaign. Check the network and hash. Use transaction help below to verify the correct hash.","Potvrda nije povezana sa spremljenom kampanjom. Provjerite mrežu i hash. Za provjeru ispravnog hasha koristite pomoć s transakcijom ispod.")
    :receiptIssue==="unavailable"?t("The receipt service is temporarily unavailable. Your transaction may still complete. Keep its hash and retry verification.","Usluga provjere potvrde trenutačno nije dostupna. Transakcija još može biti izvršena. Sačuvajte hash i ponovite provjeru.")
    :null;
  const pendingStatus = pending ? <TransactionProgress phase={2} hr={hr} creation={pending.action==="deployment"} paused={receiptPaused||Boolean(receiptIssue&&receiptIssue!=="pending")}><div role="status" className={s.transactionStatus}>
        {receiptDetail?<p>{receiptDetail}</p>:<p>{pending.action === "funding" ? t("Your deposit has been sent. We’ll update this page as soon as it’s confirmed.", "Uplata je poslana. Stranicu ćemo ažurirati čim bude potvrđena.") : t("Your reward account is being confirmed. We’ll update this page when it’s ready.", "Potvrda računa za nagrade je u tijeku. Stranicu ćemo ažurirati čim bude spreman.")}</p>}
        <p>{receiptCheck ? t("Checking confirmation…", "Provjera potvrde…") : receiptPaused ? t("Automatic checks paused. Check confirmation to try again.", "Automatske provjere su pauzirane. Ponovno provjerite potvrdu.") : receiptFailed ? t("We’re still checking. You don’t need to deposit again.", "I dalje provjeravamo. Ne morate ponovno uplatiti.") : t("You can leave this page and return through My campaigns.", "Možete napustiti stranicu i vratiti se putem Mojih kampanja.")}</p>
        {!durable ? <p>{t("Browser storage is unavailable. Keep this transaction hash before closing the tab.", "Pohrana preglednika nije dostupna. Sačuvajte hash transakcije prije zatvaranja kartice.")}</p> : null}
        </div><div className={s.transactionActions}><button className={s.secondary} disabled={busy||receiptCheck} onClick={() => {setReceiptPaused(false);void run(() => verify(pending));}}>{t("Check confirmation", "Provjeri potvrdu")}</button></div>
        <details className={s.details} open={!durable || Boolean(receiptIssue && receiptIssue !== "pending")}>
          <summary>{t("Transaction details", "Detalji transakcije")}</summary>
          <p>{t("No new transaction will be sent automatically. Verification only checks the saved hash.", "Nova transakcija neće biti poslana automatski. Provjera koristi samo spremljeni hash.")}</p>
          <p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="tx" value={pending.hash}/></p>
        </details>
      </TransactionProgress> : null;
  return <>
    {plan && observation && funded ? <SponsorDistribution launch={launch} plan={plan} observation={observation} hr={hr}/> : null}
    {funded ? allocation : null}
    {funded && !published?<p role="status" className={s.success}>{published?t("Your campaign is public. Follow results, awards and payouts on its campaign page.","Vaša kampanja je javna. Pratite rezultate, nagrade i isplate na stranici kampanje."):t("All selected pots are funded. Complete setup to open your public campaign page.","Svi odabrani fondovi su financirani. Dovršite postavljanje za otvaranje javne stranice kampanje.")}</p>:null}
    {funded && !published && record?.fundingHash && !pending ? <SponsorCompleteSetup compact published={published} id={launch.setup.id} hr={hr}/> : null}
    <details open={!funded||Boolean(error)||Boolean(pending)} className={`${s.fundingPanel} ${d.card} ${funded ? d.history : d.current}`} aria-label={t("Add reward funds", "Uplatite fond nagrada")}><summary hidden={!funded}>{t("History", "Povijest")} <small>· {record?.deploymentHash ? 3 : 2} {t("completed", "dovršeno")}</small></summary>
      {funded ? <ul className={d.historyList}><li><Check size={14}/>{t("Rules saved", "Pravila spremljena")}</li>{record?.deploymentHash ? <li><Check size={14}/>{t("Reward contract created", "Ugovor za nagrade izrađen")}</li> : null}<li><Check size={14}/>{t("Prize deposit confirmed", "Uplata nagrada potvrđena")}</li></ul> : null}
      <span className={d.eyebrow}>{t("Current task", "Trenutni zadatak")}</span>
      {view || pending ? <ol className={d.milestones} aria-label={t("Funding progress", "Napredak financiranja")}>{[t("Funding wallet connected","Novčanik za uplatu povezan"),t("Reward contract created","Ugovor nagrada izrađen"),t("Prize deposit confirmed","Uplata nagrada potvrđena")].map((label,i)=>{const done=[Boolean(plan||walletReady),accountReady,funded][i];return <li key={label} aria-current={step===i?"step":undefined} data-complete={done}><span className={s.milestoneIcon}>{done?<Check size={20} aria-label={t("Complete","Dovršeno")}/>:<Circle size={20} aria-hidden="true"/>}</span>{label}</li>;})}</ol>:null}
      <div className={d.task}>
      <h2>{pending ? receiptHeading : !view ? t("Your campaign status", "Stanje vaše kampanje") : funded ? t("Your campaign is funded", "Vaša kampanja je financirana") : !sourcesReady ? t("Use a corrected campaign draft", "Koristite ispravljeni nacrt kampanje") : unavailable ? creationBlocked ? t("Waiting for the creation service", "Čeka se usluga izrade") : t("Launch unavailable", "Pokretanje nije dostupno") : accountReady ? t("Deposit the prize funds", "Uplatite fond nagrada") : creating ? creationQueued ? t("Your account creation is queued", "Izrada računa je na čekanju") : creationSubmitted ? t("Waiting for account confirmation", "Čeka se potvrda računa") : t("Preparing your reward account", "Priprema računa za nagrade") : step === 0 ? t("Connect your funding wallet", "Povežite novčanik za uplatu") : t("Create the reward contract", "Izradite ugovor nagrada")}</h2>
      {step === 0 && !pending ? <p className={s.fundingIntro}>{t("Connect the wallet you will use to deposit your prizes.", "Povežite novčanik kojim ćete uplatiti nagrade.")}</p> : null}
      {!funded && plan && wallet?.address !== plan.funder ? <div className={s.stepAddress} aria-label={t("Saved sponsor wallet", "Spremljeni novčanik sponzora")}><span>{t("Funding wallet", "Novčanik za uplatu")}</span><p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={plan.funder}/></p></div> : null}
      {/* Keep the provider mounted when the current task changes. Unmounting it retires the selected wallet. */}
      {sourcesReady && view?.enabled ? <div hidden={funded || Boolean(pending) || creating || requestingCreation || requestingDeposit || (step !== 0 && walletReady)} className={s.walletDock}>
        <SponsorWallet compact showBalance balanceRevision={record?.fundingHash ?? ""} chainId={launch.setup.chainId} hr={hr} onWallet={setWallet} requiredAddress={plan?.funder}/>
      </div> : null}
      {!view && !error ? <p role="status">{t("Checking campaign status…", "Provjera stanja kampanje…")}</p> : null}
      {!sourcesReady ? <div role="status" className={s.notice}>
        <strong>{t("New deposits are blocked for this campaign.", "Nove uplate za ovu kampanju su onemogućene.")}</strong>
        <p>{t("Its frozen rules are missing official source links, so rewards cannot be calculated. Use the corrected draft to connect the league, rounds and categories before launching and funding it.", "Zaključanim pravilima nedostaju službene poveznice pa se nagrade ne mogu izračunati. U ispravljenom nacrtu povežite ligu, kola i kategorije prije pokretanja i financiranja.")}</p>
        <a href="/rewards/manage">{t("Open the corrected draft in My campaigns", "Otvori ispravljeni nacrt u Mojim kampanjama")}</a>
        <p>{t("Contract status and transaction recovery remain available below. If you already sent a deposit, verify its receipt; do not send it again.", "Stanje ugovora i oporavak transakcije ostaju dostupni ispod. Ako ste već poslali uplatu, provjerite potvrdu; nemojte je ponovno slati.")}</p>
      </div> : null}
      {unavailable?<div role="status" className={s.notice}>
        <strong>{t("Reward account creation is temporarily unavailable.", "Izrada računa za nagrade trenutno nije dostupna.")}</strong>
        <p>{creationBlocked?t("RacesOn must resolve an earlier controller request first. No creation transaction has been sent for this campaign, and your prize funds have not moved. Refresh funding status to check availability; creation still requires your explicit action.","RacesOn prvo mora riješiti raniji zahtjev kontrolera. Transakcija izrade ove kampanje nije poslana i fond nagrada nije prenesen. Osvježite stanje financiranja za provjeru dostupnosti; izradu i dalje morate izričito pokrenuti."):t("Your campaign is saved. RacesOn needs to restore this service before you can create the account and deposit your prize budget. Please try again later.", "Kampanja je spremljena. RacesOn mora obnoviti uslugu prije izrade računa i uplate fonda nagrada. Pokušajte kasnije.")}</p>
      </div>:null}

      {view || pending ? <ol className={s.fundingSteps} hidden={!funded && step === 0} aria-label={t("Funding steps", "Koraci financiranja")}>
        <li id={`${journeyId}-0`} hidden={!funded} tabIndex={-1} data-complete={Boolean(plan || walletReady)} aria-current={step === 0 ? "step" : undefined}>
          {marker(0, Boolean(plan || walletReady))}<div>
            <h3>{walletReady ? t("Wallet connected", "Novčanik povezan") : plan ? t("Funding wallet saved", "Novčanik za uplatu spremljen") : t("Connect your wallet", "Povežite novčanik")}</h3>
            {plan && !wallet ? <p>{funded || pending ? t("Your funding wallet is saved for this campaign.", "Novčanik za uplatu spremljen je za ovu kampanju.") : t("Use your saved wallet to continue.", "Nastavite sa spremljenim novčanikom.")}</p> : null}
            {funded && plan && wallet?.address !== plan.funder ? <div className={s.stepAddress} aria-label={t("Saved sponsor wallet", "Spremljeni novčanik sponzora")}><span>{t("Funding wallet", "Novčanik za uplatu")}</span><p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={plan.funder}/></p></div> : null}
          </div>
        </li>
        <li id={`${journeyId}-1`} hidden={!funded && step !== 1} tabIndex={-1} data-complete={accountReady} aria-current={step === 1 ? "step" : undefined}>
          {marker(1, accountReady)}<div>
            {funded ? <h3>{t("Reward account created", "Račun za nagrade izrađen")}</h3> : null}
{launch.setup.chainId===10143 && view?.creation ? <p>{t("Creation uses RacesOn’s authorized Privy wallet. RacesOn pays creation gas; your prize deposit is separate.", "Izrada koristi ovlašteni RacesOn Privy novčanik. RacesOn plaća plin za izradu; vaša uplata nagrada je odvojena.")}</p> : null}
            {accountReady ? <details className={s.completedContract}><summary>{t("Account & creation receipt","Račun i potvrda izrade")}</summary><div className={s.stepAddress}><span>{t("Campaign reward account", "Račun za nagrade kampanje")}</span><p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={observation!.address}/></p>{record?.deploymentHash ? <p><RewardExplorerLink chainId={launch.setup.chainId} kind="tx" value={record.deploymentHash}>{t("View account creation receipt", "Pogledaj potvrdu izrade računa")}</RewardExplorerLink></p> : null}</div></details> : null}
            {accountReady ? <p>{t("Ready to hold your campaign’s prizes.", "Spremno za fond nagrada kampanje.")}</p> : <>
              {step === 0 && !record ? <p>{t("Available after connecting your wallet.", "Dostupno nakon povezivanja novčanika.")}</p> : null}
              <div hidden={step === 0 && !record}>
              {!creating && !requestingCreation && !unavailable ? <p>{t("A dedicated account holds this campaign’s prizes. RacesOn covers the setup fee.", "Poseban račun čuva nagrade ove kampanje. RacesOn pokriva trošak izrade.")}</p> : null}
              {!creating && !requestingCreation && !unavailable ? <p>{t("No prize funds move in this step.", "U ovom koraku nema prijenosa fonda nagrada.")}</p> : null}
              {creating || requestingCreation ? <TransactionProgress phase={creationSubmitted?2:0} hr={hr} creation><div role="status" className={s.transactionStatus}>
                <strong>{creationQueued ? t("Waiting for the creation service", "Čeka se usluga izrade") : creationSubmitted ? t("Creation requested · confirmation pending", "Izrada zatražena · čeka se potvrda") : t("Creation requested · preparing transaction", "Izrada zatražena · priprema transakcije")}</strong>
                <p>{creationQueued ? t("RacesOn has an earlier controller request to resolve before it can create your account. No creation transaction has been sent for this campaign. Your prize funds have not moved.", "RacesOn mora riješiti raniji zahtjev kontrolera prije izrade računa. Transakcija izrade ove kampanje nije poslana. Fond nagrada nije prenesen.") : creationSubmitted ? t("Your reward account is not confirmed yet. This page checks automatically and will show the deposit button when it is ready.", "Račun za nagrade još nije potvrđen. Ova stranica automatski provjerava stanje i prikazat će gumb za uplatu kada račun bude spreman.") : t("RacesOn is preparing the creation transaction. Network confirmation has not started. The deposit step will unlock after account creation is verified.", "RacesOn priprema transakciju izrade. Mrežna potvrda još nije započela. Uplata će biti dostupna nakon potvrde izrade računa.")}</p>
                <small>{checkFailed ? t("The last check failed. Refresh status to try again.", "Posljednja provjera nije uspjela. Osvježite stanje.") : checking ? t("Checking creation status…", "Provjera stanja izrade…") : t("We’ll check again automatically. You can return through My campaigns.", "Automatski ćemo ponovno provjeriti. Možete se vratiti putem Mojih kampanja.")}</small>
              </div><div className={s.transactionActions}><button className={s.secondary} disabled={busy||checking} onClick={()=>void run(refreshStatus)}><RefreshCw size={15} aria-hidden="true"/>{busy||checking?t("Checking status…","Provjera stanja…"):t("Refresh status","Osvježi stanje")}</button>{view?.creation?.hash?<RewardExplorerLink chainId={launch.setup.chainId} kind="tx" value={view.creation.hash}>{t("View transaction","Pogledaj transakciju")}</RewardExplorerLink>:null}</div></TransactionProgress> : null}
              {view?.creation?.status === "failed" ? <p role="status" className={s.notice}>{view?.creation.reason === "balance" ? t("Creation fees are temporarily unavailable. Your reward funds have not moved. Try again later.", "Sredstva za izradu trenutno nisu dostupna. Fond nagrada nije prenesen. Pokušajte kasnije.")
                : view?.creation.reason === "capacity" ? t("Today's account creation limit has been reached. Try again tomorrow.", "Dosegnuto je dnevno ograničenje izrade računa. Pokušajte sutra.")
                : view?.creation.reason === "reverted" ? t("Account creation failed. RacesOn needs to resolve it before you can deposit.", "Izrada računa nije uspjela. RacesOn mora riješiti problem prije uplate.")
                : t("Account creation is not confirmed. Retry to check and resume the same request.", "Izrada računa nije potvrđena. Pokušajte ponovno za nastavak istog zahtjeva.")}</p> : null}
              {sourcesReady && view?.enabled && !record && !unavailable && !requestingCreation ? <button className={s.primary} disabled={!wallet || busy || view?.creation?.status !== "ready"} onClick={() => void run(()=>requestCreation(true))}>{t("Create reward account", "Izradi račun za nagrade")}<ArrowRight size={17} aria-hidden="true"/></button> : null}
              {sourcesReady && record && !unavailable && !requestingCreation && view?.creation && ["ready", "failed"].includes(view?.creation.status) && view?.creation.reason !== "reverted" ? <button className={s.primary} disabled={busy} onClick={()=>void run(()=>requestCreation(false))}>{view?.creation.status === "failed" ? t("Retry creation", "Pokušaj ponovno") : t("Create reward account", "Izradi račun za nagrade")}<ArrowRight size={17} aria-hidden="true"/></button> : null}
              </div>
            </>}
            {pending?.action === "deployment" ? pendingStatus : null}
          </div>
        </li>
        <li id={`${journeyId}-2`} hidden={!funded && step !== 2} tabIndex={-1} data-complete={funded} data-upcoming={!accountReady && !pending} aria-current={step === 2 ? "step" : undefined}>
          {marker(2, funded)}<div>
            {funded ? <h3>{t("Deposit confirmed", "Uplata potvrđena")} <span className={s.stepAmount}>{budget} test MON</span></h3> : <p className={s.stepAmount}>{t("Exact deposit", "Točna uplata")}: <strong>{budget} test MON</strong></p>}
            {plan ? <div className={s.stepAddress}><span>{t("From funding wallet", "Iz novčanika za uplatu")}</span><p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={plan.funder}/></p></div> : null}
            {accountReady ? <div className={s.stepAddress}><span>{t("To reward account", "Na račun za nagrade")}</span><p className={s.address}><RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={observation!.address}/></p></div> : null}
            {funded && !published && record?.fundingHash && !pending ? <p><RewardExplorerLink chainId={launch.setup.chainId} kind="tx" value={record.fundingHash}>{t("View prize deposit receipt", "Pogledaj potvrdu uplate nagrada")}</RewardExplorerLink></p> : null}
            {funded ? null
              : observation?.cancelled ? <p role="status">{t("Funding was cancelled for this account.", "Financiranje ovog računa je otkazano.")}</p>
              : !accountReady ? <p>{t("Available after account creation.", "Dostupno nakon izrade računa.")}</p>
              : !pending ? <p>{t("Your account is ready. Deposit from the funding wallet above; the network fee is shown before you approve.", "Račun je spreman. Uplatite iz novčanika iznad; mrežna naknada prikazuje se prije potvrde.")}</p> : null}
            {plan && sourcesReady && accountReady && !pending && !funded && !observation?.cancelled ? <>
          {!deployment && readiness ? <div role="status">
            <p>{t("Your wallet balance", "Stanje novčanika za uplatu")}: {setupAmount(BigInt(readiness.balanceWei), hr)} test MON</p>
            {readiness.gasCostWei !== null ? <p>{t("Estimated network fee", "Procjena plina s rezervom")}: {setupAmount(BigInt(readiness.gasCostWei), hr)} test MON</p> : null}
            <p>{readiness.blocker === "gas_limit" ? t(`Above the ${gasLimit} test MON gas limit. Nothing was sent.`, `Iznad ograničenja plina od ${gasLimit} test MON. Ništa nije poslano.`)
              : readiness.blocker === "balance" ? BigInt(readiness.balanceWei) >= BigInt(plan.budgetWei)
                ? t("Your reward budget has arrived. Add extra test MON for the deposit’s network fee, then check balance again. The full budget stays reserved for prizes.", "Fond nagrada je stigao. Dodajte još test MON za mrežnu naknadu uplate pa ponovno provjerite stanje. Cijeli fond ostaje namijenjen nagradama.")
                : t("Add test MON to the funding wallet for the prize deposit and network fee. Nothing was sent.", "Dodajte test MON u novčanik za fond nagrada i mrežnu naknadu. Ništa nije poslano.")
                : t("Ready for wallet confirmation. Fees will be checked again before sending.", "Spremno za potvrdu u novčaniku. Naknade će se ponovno provjeriti prije slanja.")}</p>
          </div> : null}
          {requestingDeposit ? <TransactionProgress phase={0} hr={hr}><p role="status" className={s.transactionStatus}>{t("Checking your deposit request. Confirm in your wallet when prompted; nothing is sent until you approve.","Provjeravamo zahtjev za uplatu. Potvrdite u novčaniku kada se zatraži; ništa se ne šalje bez potvrde.")}</p></TransactionProgress>:null}
          {!deployment && !requestingDeposit ? <div className={s.actions}>
          <button className={s.secondary} disabled={busy || !view?.enabled || activeWallet?.address !== requiredAddress || Boolean(record?.deploymentHash && !observation)}
            onClick={() => void run(() => send(record?.deploymentHash ? "funding" : "deployment", true))}>{t("Check balance", "Provjeri stanje")}</button>
          <button className={s.primary}
          disabled={busy || Boolean(readiness?.blocker) || !view?.enabled || activeWallet?.address !== requiredAddress || Boolean(record?.deploymentHash && !observation)}
          onClick={() => void run(async()=>{setRequestingDeposit(true);try{await send(record?.deploymentHash ? "funding" : "deployment");}finally{if(live.current)setRequestingDeposit(false);}})}>
          {walletActionLabel(busy ? t("Checking wallet / transaction…", "Provjera novčanika / transakcije…") : record?.deploymentHash ? t("Deposit reward funds", "Uplati fond nagrada") : t("Create campaign contract", "Izradi ugovor kampanje"),activeWallet?.wallet)}</button></div> : null}
            </> : null}
            {pending?.action === "funding" ? pendingStatus : null}

          </div>
        </li>
      </ol> : null}

      {error&&!receiptIssue ? <p role="alert">{!view && !pending ? t("Could not load contract status. Refresh to try again.", "Stanje ugovora nije učitano. Osvježite za ponovni pokušaj.") : error === "sponsor_gas_limit" ? t(`The gas estimate exceeds ${gasLimit} test MON. Nothing was sent.`, `Procjena plina prelazi ${gasLimit} test MON. Ništa nije poslano.`)
        : error === "sponsor_wallet_changed" ? t("Your wallet or network changed. Reconnect the required wallet on the campaign network. Nothing was sent.", "Novčanik ili mreža su promijenjeni. Ponovno povežite novčanik na mreži kampanje. Ništa nije poslano.")
        : error === "sponsor_wallet_rejected" ? t("Wallet request declined. You can try again when ready.", "Zahtjev u novčaniku je odbijen. Pokušajte ponovno kada budete spremni.")
        : error === "sponsor_insufficient_balance" ? t("Not enough test MON in the selected wallet for this transaction and gas. Nothing was sent.", "Novčanik nema dovoljno test MON za transakciju i plin. Ništa nije poslano.")
        : error === "sponsor_preflight_failed" ? t("Could not estimate this transaction through your wallet. No transaction was requested. Check the network connection and try Check balance.", "Transakcija nije procijenjena putem novčanika. Slanje nije zatraženo. Provjerite mrežu i pokušajte Provjeri stanje.")
        : t("Could not confirm this step. If your wallet sent a transaction, recover its hash below instead of sending again.", "Ovaj korak nije potvrđen. Ako je novčanik poslao transakciju, unesite njezin hash ispod umjesto ponovnog slanja.")}</p> : null}

      </div>
      <details className={`${s.details} ${s.fundingHelp}`}><summary>{t("Details & help", "Detalji i pomoć")}</summary>
      {plan ? <>
        <div>
          {!funded ? <button className={s.textButton} onClick={()=>{void navigator.clipboard.writeText(plan.funder).then(()=>setCopied(true)).catch(()=>setCopied(false));}}>{copied?t("Address copied", "Adresa kopirana"):t("Copy sponsor address", "Kopiraj adresu sponzora")}</button> : null}
        </div>
        {plan.launchId !== launch.id ? <p>{t("This account retains its earlier saved rules.", "Ovaj račun čuva ranije spremljena pravila.")}</p> : null}
        <p className={s.address}>{t("Unallocated rewards", "Neraspodijeljene nagrade")}: <RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={plan.unallocatedTreasury}/></p>
        <p className={s.address}>{t("Expired rewards", "Istekle nagrade")}: <RewardExplorerLink chainId={launch.setup.chainId} kind="address" value={plan.expiredTreasury}/></p>
        <p>{t("Claim window", "Rok preuzimanja")}: {plan.claimLifetime / 86400} {t("days", "dana")}</p>
        {!unavailable && !funded ? <details className={s.details}><summary>{t("Recover a wallet transaction", "Oporavi transakciju novčanika")}</summary>
          <label className={s.field}>{t("Transaction hash", "Hash transakcije")}<input value={recovery} onChange={e => setRecovery(e.target.value)} placeholder="0x…"/></label>
          <button className={s.secondary} disabled={busy || !sponsorTxHash(recovery)} onClick={() => void run(async() => {const p:Pending={action:record?.deploymentHash?"funding":"deployment",hash:recovery};remember(p);await verify(p);})}>{t("Verify and save", "Provjeri i spremi")}</button>
        </details> : null}
      </> : <p>{t("RacesOn covers account creation. You approve the prize deposit separately, including its network fee.", "RacesOn pokriva izradu računa. Uplatu nagrada i mrežnu naknadu potvrđujete zasebno.")}</p>}
      </details>
    </details>
    {!funded ? <>{allocation}<details className={`${d.card} ${d.history}`}><summary>{t("History", "Povijest")} <small>· {t("1 completed", "1 dovršeno")}</small></summary><ul className={d.historyList}><li><Check size={14}/>{t("Rules saved", "Pravila spremljena")}</li></ul></details></> : null}
      <div className={`${s.actions} ${s.fundingFooter}`}>
        {!creating&&!requestingCreation?<button className={s.textButton} disabled={busy || checking || receiptCheck} onClick={() => void run(refreshStatus)}><RefreshCw size={16}/>{busy || checking ? t("Checking status…", "Provjera stanja…") : funded ? t("Refresh campaign status", "Osvježi stanje kampanje") : t("Refresh funding status", "Osvježi stanje financiranja")}</button>:null}
        <a className={s.textButton} href="/rewards/manage">{t("My campaigns", "Moje kampanje")}</a>
      </div>
  </>;
}
