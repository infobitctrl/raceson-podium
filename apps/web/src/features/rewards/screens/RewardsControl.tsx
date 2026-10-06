import ControllerClaims from './ControllerClaims';
import RewardReviewViews from '../components/RewardReviewViews';
import ControllerSigningStatus,{type SigningPhase} from "../components/ControllerSigningStatus";
import ControllerCampaignPicker from "../components/ControllerCampaignPicker";
import ControllerWorkflow from "../components/ControllerWorkflow";
import ControllerLoading,{ControllerResultsLoading} from "../components/ControllerLoading";
import tableStyle from "../components/RewardResultsTable.module.css";
import {controllerClaimSelection,controllerSelection,resultsHandoffLink} from "../model/controllerLinks";
import {publicEnv} from '@/lib/public-env';
import ControllerSettings from "../components/ControllerSettings";
import {controllerJobSchema,confirmControllerJob} from "../data/controllerTransactions";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowUpRight,CheckCircle2,ShieldCheck,Wallet} from "lucide-react";
import {decodeControllerSession,decodeControllerCampaigns,decodeControllerExecution,decodeControllerAllocation,
  type ControllerRequest,type ControllerSession,type ControllerCampaign,type ControllerAllocation} from "../data/controller";
import type {RewardWalletProvider} from "../data/browserWallet";
import {setupAmount} from "../model/setupAmount";
import RewardExplorerLink from "../components/RewardExplorerLink";
import s from "./RewardsControl.module.css";
import PodiumOperationsHeader from '../components/PodiumOperationsHeader';

export type ControllerWallet={address:string;provider:RewardWalletProvider};
export type ControllerConnection={subject:string;wallets:string[];request:ControllerRequest;getWallet:(address:string)=>Promise<ControllerWallet>;isCurrent:()=>boolean;signTransaction?:(address:string,transaction:{chainId:10143;to?:string;data:string;value:"0";nonce:string;gas:string;gasPrice:string})=>Promise<string>;addSigner?:(address:string,signerId:string,policyId:string)=>Promise<void>};
const signingLabels:Record<SigningPhase,string>={
 access:'Checking controller access…',results:'Verifying approved rewards…',
 preparing:'Preparing transaction…',wallet:'Confirm in Privy…',
 submitting:'Submitting signed transaction…',recovering:'Checking saved transaction…',
 confirming:'Verifying transaction receipt…',next:'Loading the next step…',
};
const mon=(v:string)=>setupAmount(BigInt(v),false);
const message=(code:string)=>code==="controller_not_configured"?"Wallet connected. Controller access still needs to be enabled in the demo configuration before you can create contracts or approve distributions."
  :code==="controller_automatic_creation"?"Campaign creation is automatic. Use the sponsor launch page."
  :code==="controller_auth_required"?"This Privy account is not the designated controller. Switch accounts to continue."
  :code==="controller_source_not_ready"?"Official results or the allocation have changed. The platform must prepare a fresh handoff."
  :code==="controller_sequence_paused"?"Wallet steps paused. Review the current step and continue when ready. Any submitted transaction will still be checked."
  :code==="controller_preflight_timeout"?"The pre-sign checks took too long. No wallet signature was requested. Try again; any prepared transaction will be reused."
  :code==="controller_request_timeout"?"The server took too long to respond. Retry to check the current state. Any saved transaction is kept for recovery."
  :code==="controller_submission_unknown"?"Your signed transaction is saved, but the server has not confirmed its status. It may already be submitted. Continue to recover the same transaction; no new signature is needed."
  :code==="controller_wallet_rejected"?"Wallet confirmation was cancelled. No transaction was submitted. You can try again when ready."
  :code==="controller_gas_limit"?"The estimated gas fee exceeds this transaction’s safety limit. No wallet signature was requested. Retry when testnet fees are lower."
  :code==="controller_balance_required"?"Your controller wallet needs more test MON for gas. Open Controller settings & gas below. Deposited reward funds cannot pay this fee."
  :code==="controller_transaction_pending"?"Another controller transaction is pending. Complete or recover that transaction before starting this distribution."
  :code==="controller_chain_unavailable"?"The testnet could not be reached. Try again when the connection is available."
  :code==="controller_confirmation_required"?"This step is not confirmed yet. Check the saved transaction before requesting another signature."
  :code==="controller_transaction_reverted"?"The transaction failed on the testnet. Refresh the distribution to check its current state."
  :code.startsWith("controller_wallet_changed:")?"The wallet changed the prepared transaction. It was not submitted. Retry only after checking the wallet settings."
  :code==="controller_session_changed"?"Your account or wallet changed. Reconnect before continuing."
  :"Could not verify this step. Refresh to check again. If a transaction was sent, verify its saved hash before sending another.";

export function ControlShell({children}:{children:React.ReactNode}) {
  return <><PodiumOperationsHeader/><main className={s.page}><div className={s.top}><a href="/rewards"><ArrowLeft size={16}/> Podium overview</a><span className={s.network}>Monad testnet · test MON</span></div>
    <header className={s.header}><div><span className={s.eyebrow}>RacesOn Podium / Operations</span><h1>Rewards Control</h1></div><ShieldCheck size={42} strokeWidth={1.2}/></header>
    {children}<footer className={s.footer}><details><summary>About controller access</summary><p>Controller gas is paid separately. Reward funds stay in campaign contracts. Athlete wallet consent remains separate.</p></details></footer></main></>;
}

export default function RewardsControl({connection,onLogout}:{connection:ControllerConnection;onLogout:()=>void}) {
  const [requested]=useState(()=>controllerSelection(typeof window==='undefined'?'':window.location.search));
  const [requestedClaim]=useState(()=>controllerClaimSelection(typeof window==='undefined'?'':window.location.search));
  const [session,setSession]=useState<ControllerSession|null>(null),[campaigns,setCampaigns]=useState<ControllerCampaign[]>([]),[selected,setSelected]=useState<string|null>(requested.campaign);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(true),[loadingLabel,setLoadingLabel]=useState("Checking controller access…"),live=useRef(true);
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  async function refresh(){setBusy(true);setError(null);setSession(null);setCampaigns([]);setLoadingLabel("Checking controller access…");try{
    const verified=decodeControllerSession(await connection.request("/access"));
    if(verified.subject!==connection.subject)throw Error("controller_session_changed");
    if(live.current)setLoadingLabel("Loading your campaigns…");
    const items=decodeControllerCampaigns(await connection.request("/campaigns"));
    if(items.some(c=>c.execution.plan.operator!==verified.wallet))throw Error("controller_session_changed");
    if(live.current&&connection.isCurrent()){setSession(verified);setCampaigns(items);if(!requested.campaign&&items.length===1)setSelected(items[0].setupId);}
  }catch(e){if(live.current)setError(e instanceof Error?e.message:"failed");}finally{if(live.current)setBusy(false);}}
  // Connection is immutable for the lifetime of this keyed account workspace.
  useEffect(()=>{void refresh();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const campaign=campaigns.find(c=>c.setupId===selected);
  if(busy&&!session)return <ControllerLoading label={loadingLabel}/>;
  return <><section className={s.account}><div><span className={s.eyebrow}>Controller account</span>
      {session&&connection.wallets.includes(session.wallet)?<p className={s.verified}><CheckCircle2 size={17}/> Controller access active</p>:null}
      <details><summary>Account details</summary><p className={s.address}>{connection.subject}</p>{connection.wallets.map(w=><p className={s.address} key={w}><Wallet size={14}/> {w}</p>)}</details></div><button className={s.secondary} onClick={onLogout}>Switch account</button></section>
    {error?<div className={s.notice} role="alert"><p>{message(error)}</p><button className={s.secondary} disabled={busy} onClick={()=>void refresh()}>Retry loading workspace</button></div>:null}

    {session&&connection.wallets.length>1?<label className={s.field}>Controller wallet<select value={session.wallet} onChange={e=>{const url=new URL(window.location.href);url.searchParams.set('wallet',e.target.value);window.location.assign(url.href);}}>{connection.wallets.map(wallet=><option key={wallet} value={wallet}>{wallet}</option>)}</select></label>:null}
    {session&&!connection.wallets.includes(session.wallet)?<p className={s.notice}>The designated wallet {session.wallet} is not available in this Privy account. No signing is enabled.</p>:null}
    {session&&campaigns.length===0?<section className={s.card}><h3>No assigned campaigns</h3><p>Prepared campaigns appear here when their contract operator matches this controller. Existing campaigns keep their saved operator.</p></section>:null}
    {session&&requested.campaign&&!campaigns.some(c=>c.setupId===requested.campaign)?<p className={s.notice} role="status">The linked campaign is not assigned to this controller account. Switch to its designated controller or select an assigned campaign below.</p>:null}
    {session&&campaigns.length>1?<ControllerCampaignPicker campaigns={campaigns} selected={campaign?.setupId} busy={busy} onSelect={setSelected} onRefresh={()=>void refresh()}/>:null}
    <div className={s.grid}>
    {session&&campaign?<CampaignControl key={`${campaign.setupId}:${session.subject}`} campaign={campaign} connection={connection} session={session} requestedClaim={campaign.setupId===requested.campaign?requestedClaim:null} requestedSlot={campaign.setupId===requested.campaign?requested.slot:null}/>:campaigns.length?<section className={s.card}><h3>Select a campaign</h3><p>Review its contract and official-results handoff.</p></section>:null}</div>    <details className={s.section} onToggle={e=>setSettingsOpen(e.currentTarget.open)}><summary>Controller settings & gas</summary>
    {session&&settingsOpen?<ControllerSettings key={session.wallet} connection={connection} session={session}/>:null}
    </details>
</>;
}

type Pending={requestId:string;transactionHash:string;operation:"deployment"|"upload"|"stage"|"activate";start:number;end:number;approvalId?:string;journalId?:string};
function CampaignControl({campaign,connection,session,requestedSlot,requestedClaim}:{requestedClaim:ReturnType<typeof controllerClaimSelection>;campaign:ControllerCampaign;connection:ControllerConnection;session:ControllerSession;requestedSlot:number|null}) {
  const [execution,setExecution]=useState(campaign.execution),[slot,setSlot]=useState(()=>campaign.pots.find(p=>p.approvalId===requestedClaim?.approvalId)?.slot??(requestedSlot!==null&&BigInt(campaign.execution.plan.caps[requestedSlot])>0n?requestedSlot:campaign.pots.find(p=>p.ready&&BigInt(campaign.execution.plan.caps[p.slot])>0n)?.slot??campaign.execution.plan.caps.findIndex(cap=>BigInt(cap)>0n))),[allocation,setAllocation]=useState<ControllerAllocation|null>(null);
  const [reviewed,setReviewed]=useState(false),[signingPhase,setSigningPhase]=useState<SigningPhase|null>(null);
  const [continuing,setContinuing]=useState(false),sequence=useRef<{approvalId:string;documentHash:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<Pending|null>(null),[notice,setNotice]=useState<string|null>(null);
  const [recovery,setRecovery]=useState(""),[recoveryAction,setRecoveryAction]=useState<Pending["operation"]>("deployment"),[start,setStart]=useState(0),[end,setEnd]=useState(0);
  const live=useRef(true),flight=useRef(false),epoch=useRef(0),path=`/campaigns/${campaign.setupId}`,selected=campaign.pots.find(p=>p.slot===slot);
  const key=`raceson:controller-tx:10143:${session.subject}:${campaign.setupId}`;
  useEffect(()=>{live.current=true;try{const p=JSON.parse(sessionStorage.getItem(key)??"null");if(p&&/^0x[0-9a-f]{64}$/.test(p.transactionHash)&&["deployment","upload","stage","activate"].includes(p.operation))setPending(p);}catch{/* Optional local recovery. */}return()=>{live.current=false;};},[key]);
  function pauseSequence(){sequence.current=null;setContinuing(false);}
  useEffect(()=>{const hide=()=>{if(document.visibilityState==='hidden')pauseSequence();};document.addEventListener('visibilitychange',hide);return()=>{sequence.current=null;document.removeEventListener('visibilitychange',hide);};},[]);
  async function run(action:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(null);try{await action();}catch(e){if(live.current){pauseSequence();setError(e instanceof Error?e.message:"failed");}}finally{flight.current=false;if(live.current){setBusy(false);setSigningPhase(null);}}}
  async function review(){const approval=selected?.approvalId;if(!approval)return;const current=++epoch.current;
    setReviewed(false);setAllocation(null);const v=decodeControllerAllocation(await connection.request(`${path}/allocations/${approval}`));
    if(live.current&&current===epoch.current)setAllocation(v);
  }
  async function verify(p:Pending){const {approvalId,journalId,...body}=p;
    if(journalId){
      setSigningPhase('confirming');
      const j=controllerJobSchema.parse(await connection.request("/transactions",{action:"resume",id:journalId})),c=j.context;
      if(j.id!==journalId||j.hash!==p.transactionHash||c.kind!=='distribution'||c.setupId!==campaign.setupId||c.approvalId!==approvalId||c.action!==p.operation||c.start!==p.start||c.end!==p.end)throw Error("controller_transaction_invalid");
      if(!j.confirmed)throw Error("controller_confirmation_required");
    }
    if(!live.current||!connection.isCurrent())return;
    const target=`${path}${approvalId?`/allocations/${approvalId}`:""}`;
    setSigningPhase(journalId?'next':'confirming');
    // Journal confirmation already verifies finality and records the exact receipt.
    // Read the next state; only manual hash recovery needs to post a receipt here.
    const v=journalId?await connection.request(target):await connection.request(target,body);
    if(!live.current||!connection.isCurrent())return;if(approvalId){const next=decodeControllerAllocation(v);if(next.review.documentHash!==allocation?.review.documentHash){setReviewed(false);pauseSequence();}epoch.current++;setSlot(next.slot);setAllocation(next);}else setExecution(decodeControllerExecution(v).record!);
    setPending(null);setRecovery("");try{sessionStorage.removeItem(key);}catch{/* Server receipt remains authoritative. */}setNotice("Transaction verified and recorded.");
  }
  async function sign(){if(pending||!reviewed||!allocation?.transaction)return;
    const approval=allocation.approvalId,current=epoch.current,deadline=Date.now()+60_000,startedSequence=sequence.current;
    const active=()=>live.current&&current===epoch.current&&connection.isCurrent();
    // Only unsigned preparation has a deadline. A late response cannot continue
    // this await chain to open a wallet; signed-byte recovery stays untouched.
    async function check<T>(phase:SigningPhase,request:()=>Promise<T>):Promise<T>{
      if(!active())throw Error("controller_session_changed");
      const remaining=deadline-Date.now();if(remaining<=0)throw Error("controller_preflight_timeout");
      setSigningPhase(phase);
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{const value=await Promise.race([request(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("controller_preflight_timeout")),remaining);})]);
        if(!active())throw Error("controller_session_changed");return value;
      }finally{clearTimeout(timer);}
    }
    if(!connection.wallets.includes(session.wallet))throw Error("controller_session_changed");
    const fresh=allocation,transaction=allocation.transaction;
    if(!fresh.current)throw Error("controller_source_not_ready");
    if(!connection.signTransaction)throw Error('controller_confirmation_required');
    // Preparation authenticates the controller, revalidates official sources and
    // finalized contract state, and binds the document already reviewed here.
    const job=controllerJobSchema.parse(await check('preparing',()=>connection.request('/transactions',{action:'prepare',kind:'distribution',setupId:campaign.setupId,approvalId:approval,expectedDocumentHash:fresh.review.documentHash})));
    const t=job.transaction,c=job.context;
    if(c.kind!=='distribution'||c.setupId!==campaign.setupId||c.approvalId!==approval||c.action!==transaction.action||c.start!==transaction.start||c.end!==transaction.end||t.to!==transaction.to||t.data!==transaction.data)throw Error('controller_source_not_ready');
    if(document.visibilityState==='hidden'||startedSequence&&sequence.current!==startedSequence)throw Error('controller_sequence_paused');
    const sent=await confirmControllerJob(connection,session.wallet,job,phase=>{if(active())setSigningPhase(phase);});
    if(!sent.hash)throw Error('controller_confirmation_required');
    const p:Pending={requestId:sent.id,journalId:sent.id,transactionHash:sent.hash,operation:transaction.action,start:transaction.start,end:transaction.end,approvalId:approval};
    try{sessionStorage.setItem(key,JSON.stringify(p));}catch{/* Keep visible hash in memory. */}
    if(live.current){setPending(p);setNotice(null);}
  }
  useEffect(()=>{if(selected?.ready)void run(review);},[selected?.approvalId,selected?.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Polling only recovers the exact sent transaction. A separate, explicitly
  // started sequence may continue after this receipt and the next state verify.
  async function checkConfirmation(){
    if(!pending||flight.current||!connection.isCurrent())return;
    flight.current=true;setBusy(true);
    try{await verify(pending);if(live.current)setError(null);}
    catch(e){if(live.current&&(!(e instanceof Error)||e.message!=="controller_confirmation_required")){pauseSequence();setError(e instanceof Error?e.message:"failed");}}
    finally{flight.current=false;if(live.current){setBusy(false);setSigningPhase(null);}}
  }
  const checkRef=useRef(checkConfirmation);checkRef.current=checkConfirmation;
  useEffect(()=>{
    if(!pending)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>,delay=1000;
    const poll=async()=>{if(cancelled)return;if(document.visibilityState!=="hidden")await checkRef.current();if(!cancelled){delay=Math.min(delay*2,30000);timer=setTimeout(poll,delay);}};
    timer=setTimeout(poll,delay);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[pending]);
  useEffect(()=>{
    const started=sequence.current;
    if(!started||busy||pending)return;
    if(!connection.isCurrent()||document.visibilityState==='hidden'||!reviewed||!allocation?.current||!allocation.transaction||allocation.approvalId!==started.approvalId||allocation.review.documentHash!==started.documentHash){pauseSequence();return;}
    void run(sign);
  },[busy,pending,allocation,reviewed]); // eslint-disable-line react-hooks/exhaustive-deps
  function startSequence(){if(!allocation?.current||!reviewed||busy||pending)return;sequence.current={approvalId:allocation.approvalId,documentHash:allocation.review.documentHash};setContinuing(true);void run(sign);}
  const canSign=connection.wallets.includes(session.wallet),tx=allocation?.transaction;
  return <section className={s.campaignWorkspace}><div className={s.campaignHeading}><div><span className={s.eyebrow}>Selected campaign</span><h2>{campaign.name}</h2></div><a className={s.secondary} href={`/rewards/campaigns/${campaign.setupId}/public`}>View public campaign ↗</a></div>
    {!execution.deploymentHash?<><h3>Sponsor launch</h3><p>Campaign creation starts from the sponsor page. No controller approval is required.</p></>:<div className={s.milestones}><p className={s.verified}><CheckCircle2 size={17}/> Contract created</p>{!execution.fundingHash?<p>Waiting for the sponsor to fund the reward pot.</p>:<p className={s.verified}><CheckCircle2 size={17}/> Sponsor funding recorded</p>}</div>}
    <div className={s.reviewTools}><span className={s.eyebrow}>Distribution</span><div className={s.tabs}>{execution.plan.caps.map((cap,i)=>BigInt(cap)>0n?<button disabled={busy||!!pending} key={i} aria-pressed={slot===i} onClick={()=>{epoch.current++;setSlot(i);setReviewed(false);setAllocation(null);setError(null);}}>{i===0?"League":`Round ${i}`}<small>{mon(cap)} test MON{campaign.pots.some(p=>p.slot===i&&p.ready)?' · Ready for review':''}</small></button>:null)}</div>{selected?.ready?<button disabled={busy||!!pending} className={s.secondary} onClick={()=>void run(review)}>Review official distribution</button>:null}</div>
    <nav className={s.sectionNav} aria-label="Distribution sections">{allocation||selected?.ready?<a href="#controller-results">Results & rewards</a>:null}<a href="#controller-progress">Distribution progress ↓</a></nav>
    <div className={s.distributionLayout}>
    {allocation?<div className={s.resultsPanel} id="controller-results" tabIndex={-1}>
      {allocation.review.results?<><h3>{allocation.review.results.name}</h3><RewardReviewViews data={allocation.review.results} budgetWei={allocation.review.budgetWei} approved/></>:null}
      </div>:selected?.ready?<ControllerResultsLoading pending={!error} label={error?"Results could not be loaded. Use Review official distribution to retry.":"Loading approved results and checking the contract…"}/>:<section className={s.resultsPanel} id="controller-results"><span className={s.eyebrow}>Results team workspace</span><h3>{selected?"Prepare the approved rewards":"Start with official results"}</h3><p>The results team confirms the official source and approves the exact awards before this distribution is ready for wallet signing.</p><a className={s.secondary} href={resultsHandoffLink(campaign.setupId,slot,publicEnv.hostedOperations)}>Review results & rewards ↗</a><div className={s.preparationGuide}><div><span>01</span><strong>Confirm official results</strong><p>Check the published race and category evidence.</p></div><div><span>02</span><strong>Approve & prepare rewards</strong><p>Review the exact amounts, then send the controller handoff.</p></div><div><span>03</span><strong>Controller signs</strong><p>Return here to confirm each required wallet transaction.</p></div></div><p>Funding is recorded separately. No wallet signature or payout is needed to review results.</p></section>}
    <aside className={s.workflowPanel} id="controller-progress" tabIndex={-1} aria-label="Distribution progress">
    <ControllerWorkflow allocation={allocation} ready={!!selected?.ready} hasApproval={!!selected} loading={busy||!!selected?.ready&&!allocation&&!error} checking={!allocation&&!!selected?.ready} reviewHref={resultsHandoffLink(campaign.setupId,slot,publicEnv.hostedOperations)}>
      {pending?<div><strong>Waiting for transaction confirmation</strong><p>{continuing?'Your next wallet prompt opens after confirmation. Keep this page visible.':'We check automatically. Your next signing step appears after confirmation.'}</p>{signingPhase?<ControllerSigningStatus key={signingPhase} phase={signingPhase}/>:null}<button className={s.secondary} disabled={busy} onClick={()=>void checkConfirmation()}>Check confirmation now</button><details><summary>Transaction details</summary><p className={s.address}>{pending.transactionHash}</p></details></div>:tx?<>
       <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed the approved rewards for this pot.</label>
       <p>{tx.action==='upload'?`Upload rewards · ${tx.start+1}–${tx.end} of ${allocation!.review.recipientCount}`:tx.action==='stage'?'Confirm distribution':'Open claims'}</p>
       <button className={s.primary} disabled={busy||!canSign||!reviewed||!allocation?.current} onClick={startSequence}>{busy?(signingPhase?signingLabels[signingPhase]:"Checking…"):tx.action==="activate"?"Open reward claims · Privy":"Start remaining wallet steps · Privy"}<ArrowUpRight size={16}/></button>
       <p>Review once. Each transaction opens in your wallet after the previous one confirms, through opening claims.</p>
       {signingPhase?<ControllerSigningStatus key={signingPhase} phase={signingPhase}/>:null}
      </>:<p role="status">{busy?"Checking the next signing step…":"The contract is not ready for the next step. Refresh to check its status."}</p>}
    </ControllerWorkflow>
    {continuing?<div role="status"><p>Wallet steps will continue automatically while this page is visible. You confirm each transaction in your wallet.</p><button className={s.secondary} onClick={pauseSequence}>Pause wallet steps</button><small>A wallet request already open or transaction already submitted can still complete.</small></div>:null}
    {allocation?<div className={s.review}>
      <details className={tableStyle.technical}><summary>Technical details & award totals</summary><dl><div><dt>Awards</dt><dd>{mon(allocation.review.allocatedWei)} MON</dd></div><div><dt>Recipients</dt><dd>{allocation.review.recipientCount}</dd></div><div><dt>Reserved remainder</dt><dd>{mon(allocation.review.retainedWei)} MON</dd></div></dl>
      <details><summary>Category allocation & publication</summary>{allocation.review.groups.map(g=><div className={s.category} key={g.id}><span>{g.name}</span><strong>{mon(g.amountWei)} MON</strong><small>{g.recipientCount} recipients</small></div>)}<p className={s.address}>Allocation: {allocation.review.documentHash}</p><p>Published: {new Date(Number(allocation.publication?.timing.officialPublishedAt)*1000).toLocaleString()}</p></details></details>
    </div>:null}
    {notice?<p role="status">{notice}</p>:null}{error?<p className={s.notice} role="alert">{message(error)}</p>:null}
    {pending&&(!allocation?.current||allocation.pot?.state===3||!selected?.ready)?<div className={s.notice} role="status"><strong>Transaction confirmation pending</strong><p>The saved transaction is being checked before another can be sent.</p><button disabled={busy} className={s.secondary} onClick={()=>void checkConfirmation()}>Check confirmation now</button></div>:null}
    <details className={s.section}><summary>Advanced · recover a transaction</summary><p>Verify an existing hash instead of sending again.</p><label className={s.field}>Transaction hash<input value={recovery} onChange={e=>setRecovery(e.target.value)}/></label><label className={s.field}>Operation<select value={recoveryAction} onChange={e=>setRecoveryAction(e.target.value as Pending["operation"])}>{Object.entries({deployment:"Create contract",upload:"Upload awards",stage:"Publish distribution",activate:"Open claims"}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {recoveryAction==="upload"?<div className={s.row}><label className={s.field}>Start index<input type="number" min={0} value={start} onChange={e=>setStart(Number(e.target.value))}/></label><label className={s.field}>End index<input type="number" min={0} value={end} onChange={e=>setEnd(Number(e.target.value))}/></label></div>:null}
      <button disabled={busy||!!pending||!/^0x[0-9a-f]{64}$/.test(recovery)||recoveryAction!=="deployment"&&!selected?.approvalId} className={s.secondary} onClick={()=>void run(()=>verify({requestId:crypto.randomUUID(),transactionHash:recovery,operation:recoveryAction,start:recoveryAction==="upload"?start:0,end:recoveryAction==="upload"?end:0,...(recoveryAction!=="deployment"?{approvalId:selected!.approvalId}:{})}))}>Verify existing transaction</button></details>
    </aside></div>
    {publicEnv.hostedOperations&&selected?.ready?<><ControllerClaims connection={connection} wallet={session.wallet} setupId={campaign.setupId} approvalId={selected.approvalId} requestedClaimId={requestedClaim?.approvalId===selected.approvalId&&!requestedClaim.club?requestedClaim.claimId:null} disabled={busy||!!pending}/><ControllerClaims club connection={connection} wallet={session.wallet} setupId={campaign.setupId} approvalId={selected.approvalId} requestedClaimId={requestedClaim?.approvalId===selected.approvalId&&requestedClaim.club?requestedClaim.claimId:null} disabled={busy||!!pending}/></>:null}
  </section>;
}
