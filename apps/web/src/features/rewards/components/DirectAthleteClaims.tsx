import RewardErrorNotice from "./RewardErrorNotice";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {SponsorAward} from '../data/sponsorProgramme';
import {prepareBrowserWalletProof,type DetectedRewardWallet} from '../data/browserWallet';
import {readDirectClaimV5,type DirectClaimV5} from '../data/directClaimsV5';
import {setupAmount} from '../model/setupAmount';
import SponsorWallet from './SponsorWallet';
import RewardClaimDialog from './RewardClaimDialog';
import RewardExplorerLink from './RewardExplorerLink';
import s from './AthleteRewards.module.css';
import claimStyle from './AthleteClaimReview.module.css';
import d from './DirectAthleteClaims.module.css';
import {Check,Circle,LoaderCircle} from 'lucide-react';
import {awardDisplay} from '../model/awardDisplay';
export default function DirectAthleteClaims({awards,hr,onRefresh,onAccessError}:{awards:SponsorAward[];hr:boolean;onRefresh:()=>Promise<void>;onAccessError?:(error:unknown)=>void}){
 const [selected,setSelected]=useState<SponsorAward|null>(null),t=(en:string,local:string)=>hr?local:en;
 return <section aria-label={t('Your rewards','Vaše nagrade')}><h2>{t('Awards','Nagrade')}</h2>
  <ul className={s.awards}>{awards.map(a=><li className={s.award} key={a.entitlementId}><div className={s.awardTop}><div><h3>{awardDisplay(a,hr).title}</h3>{awardDisplay(a,hr).subtitle?<p className={s.scope}>{awardDisplay(a,hr).subtitle}</p>:null}<span className={s.badge} data-state={a.directClaim?.paid?'paid':'held'}>{a.directClaim?.paid?t('Paid','Isplaćeno'):t('Award approved','Nagrada odobrena')}</span></div>
   <div className={s.awardAction}><strong>{setupAmount(BigInt(a.amountWei),hr)} <small>test MON</small></strong><button className={s.primary} onClick={()=>setSelected(a)}>{a.directClaim?.paid?t('View payment','Pregledaj isplatu'):t('Claim reward','Preuzmi nagradu')}</button></div></div></li>)}</ul>
  {selected?<RewardClaimDialog athlete showCloseReview={false} description={[awardDisplay(selected,hr).title,awardDisplay(selected,hr).subtitle].filter(Boolean).join(' · ')} title={t('Claim your reward','Preuzmite svoju nagradu')} hr={hr} onClose={()=>{setSelected(null);void onRefresh().catch(()=>{});}}>{onBusy=><DirectAthleteClaim award={selected} hr={hr} onBusy={onBusy} onAccessError={onAccessError}/>}</RewardClaimDialog>:null}
 </section>;
}
export function DirectAthleteClaim({award,hr,onBusy,onAccessError}:{award:SponsorAward;hr:boolean;onBusy?:(busy:boolean)=>void;onAccessError?:(error:unknown)=>void}){
 const [view,setView]=useState<DirectClaimV5|null>(null),[wallet,setWallet]=useState<{wallet:DetectedRewardWallet;address:string}|null>(null);
 const [phase,setPhase]=useState<'checking'|'wallet'|'preparing'|'sending'|'receipt'>('checking');
 const [busy,setBusy]=useState(false),[error,setError]=useState<'sponsorship'|'unknown'|null>(null),[ack,setAck]=useState(false),[pending,setPending]=useState<string|null>(null),[submittedTo,setSubmittedTo]=useState<string|null>(null);
 const active=useRef(true),flight=useRef(false),currentWallet=useRef(wallet),abort=useRef<AbortController|null>(null),accessError=useRef(onAccessError);currentWallet.current=wallet;accessError.current=onAccessError;
 const t=(en:string,local:string)=>hr?local:en,storage=`podium:direct-claim:${award.approvalId}:${award.entitlementId}`;
 const choose=useCallback((value:{wallet:DetectedRewardWallet;address:string}|null)=>{setWallet(value);setAck(false);},[]);
 useEffect(()=>{onBusy?.(busy&&phase!=='checking'&&phase!=='receipt');},[busy,phase,onBusy]);
 const load=useCallback(async(hash?:string|null)=>{
  const v=await readDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},hash?{action:'receipt',hash}:undefined);
  if(v.amountWei!==award.amountWei)throw Error('award_changed');
  if(active.current){setView(v);if(v.status==='paid'){setPending(null);try{sessionStorage.removeItem(storage);}catch{/* Optional recovery only. */}}}
 },[award.approvalId,award.entitlementId,award.amountWei,storage]);
 const run=useCallback(async(work:()=>Promise<void>,operation:typeof phase='checking')=>{if(flight.current)return;flight.current=true;setPhase(operation);setBusy(true);setError(null);
  try{await work();}catch(e){if(active.current){setError(e instanceof Error&&e.message==='claim_sponsorship_unavailable'?'sponsorship':'unknown');setAck(false);if(e&&typeof e==='object'&&'status'in e&&[401,403].includes(Number(e.status)))accessError.current?.(e);}}
  finally{flight.current=false;if(active.current)setBusy(false);}},[]);
 useEffect(()=>{active.current=true;let hash:string|null=null;try{const saved=sessionStorage.getItem(storage);if(saved&&/^0x[0-9a-f]{64}$/.test(saved))hash=saved;}catch{/* Optional recovery only. */}
  setPending(hash);void run(()=>load(hash));return()=>{active.current=false;abort.current?.abort();};},[load,run,storage]);
 async function claim(){if(!wallet||!ack||view?.status!=='claimable'||pending)return;
  if(!wallet.wallet.sendDirectClaim)throw Error('claim_sponsorship_unavailable');
  const chosen=wallet,isCurrent=()=>active.current&&currentWallet.current===chosen;
  const controller=new AbortController();abort.current=controller;
  const proof=await prepareBrowserWalletProof(chosen.wallet.provider,window.location.origin,isCurrent,()=>{if(active.current){setWallet(null);setAck(false);}},controller.signal);
  try{
   const confirmed=await proof.confirm();await proof.assertCurrent();if(active.current)setPhase('preparing');
   const fresh=await readDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},{action:'prepare',proofId:confirmed.proofId});
   if(!isCurrent()||fresh.amountWei!==award.amountWei||fresh.transaction?.from!==chosen.address)throw Error('wallet_changed');
   if(active.current)setPhase('sending');
   const hash=await chosen.wallet.sendDirectClaim!(fresh,isCurrent);
   try{sessionStorage.setItem(storage,hash);}catch{/* Keep the returned hash visible. */}
   if(active.current){setPending(hash);setSubmittedTo(chosen.address);setView({...fresh,transaction:null});setAck(false);}
  }finally{proof.dispose();controller.abort();}
 }
 const paid=view?.status==='paid',claiming=busy&&phase!=='checking'&&phase!=='receipt';
 const destination=paid?view.recipient:pending?submittedTo??view?.recipient:wallet?.address??view?.recipient;
 const date=view&&Number(view.deadline)>0?new Date(Number(view.deadline)*1000):null;
 const deadline=date&&Number.isFinite(date.getTime())?date.toLocaleString(hr?'hr-HR':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':null;
 const status=busy?phase==='wallet'?t('Confirm wallet ownership…','Potvrdite vlasništvo novčanika…'):phase==='preparing'?t('Preparing your claim…','Priprema preuzimanja…'):phase==='sending'?t('Confirm in your wallet…','Potvrdite u novčaniku…'):phase==='receipt'?t('Checking payment…','Provjera isplate…'):t('Checking your reward…','Provjera nagrade…')
  :paid?t('Reward paid','Nagrada je isplaćena'):pending?t('Submitted · awaiting confirmation','Poslano · čeka potvrdu'):null;
 const steps=[
  {title:t('Award','Nagrada'),done:!!view,current:!view,detail:view?t('Verified','Provjereno'):t('Checking…','Provjera…')},
  {title:t('Wallet','Novčanik'),done:!!destination||!!pending,current:!!view&&!destination&&!pending,detail:destination?`${destination.slice(0,6)}…${destination.slice(-4)}`:pending?t('Confirmed','Potvrđeno'):t('Connect to receive','Povežite za primitak')},
  {title:t('Payment','Isplata'),done:paid,current:(!!destination||!!pending)&&!paid,detail:paid?t('Confirmed','Potvrđeno'):pending?t('Confirming','Potvrđivanje'):t('Your confirmation','Vaša potvrda')},
 ];
 return <section className={`${claimStyle.review} ${d.review}`}>
  <ol className={d.steps} aria-label={t('Claim progress','Napredak preuzimanja')}>{steps.map(step=><li key={step.title} data-state={step.done?'complete':step.current?'current':'waiting'} aria-current={step.current?'step':undefined}>
   <span aria-hidden="true">{step.done?<Check size={17}/>:step.current&&busy?<LoaderCircle size={17} className={d.spinner}/>:<Circle size={17}/>}</span>
   <div><strong>{step.title}</strong><small>{step.detail}</small></div>
  </li>)}</ol>
  <dl className={claimStyle.facts}>
   <div><dt>{t('Amount','Iznos')}</dt><dd className={d.amount}>{setupAmount(BigInt(award.amountWei),hr)} <small>test MON</small></dd></div>
   <div><dt>{t('Destination','Odredište')}</dt><dd>{destination?<RewardExplorerLink chainId={10143} kind="address" value={destination}>{`${destination.slice(0,6)}…${destination.slice(-4)}`}</RewardExplorerLink>:pending?t('See transaction','Pogledajte transakciju'):t('Choose your wallet','Odaberite novčanik')}</dd></div>
   {deadline?<div><dt>{t('Claim by','Preuzmi do')}</dt><dd className={claimStyle.expiry}>{deadline}</dd></div>:null}
   <div><dt>{t('Network fee','Mrežna naknada')}</dt><dd>{paid||pending?t('See transaction receipt','Pogledajte potvrdu transakcije'):t('Covered by RacesOn','Pokriva RacesOn')}</dd></div>
  </dl>
  {status?<p className={d.status} role="status">{busy?<LoaderCircle size={16} className={d.spinner} aria-hidden="true"/>:paid?<Check size={16} aria-hidden="true"/>:null}{status}</p>:null}
  {paid?view.receipt?<RewardExplorerLink chainId={10143} kind="tx" value={view.receipt.transactionHash}>{t('View receipt','Pregledaj potvrdu')}</RewardExplorerLink>:null
   :pending?<><RewardExplorerLink chainId={10143} kind="tx" value={pending}>{t('View transaction','Pregledaj transakciju')}</RewardExplorerLink><button className={s.primary} disabled={busy} onClick={()=>void run(()=>load(pending),'receipt')}>{t('Check payment','Provjeri isplatu')}</button></>
   :view?.status==='claimable'?<>
    <div className={d.wallet} hidden={claiming}><SponsorWallet compact hideConnectedSummary purpose="recipient" chainId={10143} hr={hr} onWallet={choose}/></div>
    {wallet&&!wallet.wallet.sendDirectClaim?<p role="status">{t('Use your Privy wallet for RacesOn-paid fees.','Za naknade koje plaća RacesOn koristite Privy novčanik.')}</p>:null}
    {!claiming?<><label className={claimStyle.consent}><input type="checkbox" checked={ack} disabled={busy||!wallet?.wallet.sendDirectClaim} onChange={e=>setAck(e.target.checked)}/>{t('Send this reward to the wallet above.','Pošalji nagradu na navedeni novčanik.')}</label>
     <button className={s.primary} disabled={busy||!wallet?.wallet.sendDirectClaim||!ack} onClick={()=>void run(claim,'wallet')}>{t('Claim reward','Preuzmi nagradu')}</button></>:null}
   </>
   :view?<p role="status">{view.status==='not_open'?t('Claims have not opened yet.','Preuzimanja još nisu otvorena.'):view.status==='paused'?t('Claims are temporarily paused.','Preuzimanja su privremeno zaustavljena.'):t('The claim deadline has passed.','Rok preuzimanja je istekao.')}</p>:null}
  {error?<RewardErrorNotice title={error==='sponsorship'?t('Sponsored claim unavailable','Sponzorirano preuzimanje nije dostupno'):t('Claim needs attention','Potrebna je provjera preuzimanja')}>
   {error==='sponsorship'?t('Try your Privy wallet again. You do not need to add test MON.','Pokušajte ponovno s Privy novčanikom. Ne trebate dodavati test MON.'):t('Check wallet activity, then refresh payment status before retrying.','Provjerite aktivnost novčanika pa osvježite stanje prije ponovnog pokušaja.')}
  </RewardErrorNotice>:null}
  {!busy&&!pending&&!paid&&(error||view?.status!=='claimable')?<button className={d.refresh} onClick={()=>void run(()=>load())}>{t('Refresh status','Osvježi stanje')}</button>:null}
  <details className={d.details}><summary>{t('Claim details','Detalji preuzimanja')}</summary>{destination?<p><RewardExplorerLink chainId={10143} kind="address" value={destination}/></p>:null}
   {!busy&&!pending&&!paid&&!error&&view?.status==='claimable'?<button className={d.refresh} onClick={()=>void run(()=>load())}>{t('Refresh status','Osvježi stanje')}</button>:null}
   <p>{paid?t('Monad testnet · Payment confirmed to your wallet.','Monad testnet · Isplata na vaš novčanik je potvrđena.'):pending?t('Monad testnet · Confirming payment to your wallet.','Monad testnet · Provjera isplate na vaš novčanik.'):t('Monad testnet · You receive the full award. RacesOn covers the network fee.','Monad testnet · Primate cijelu nagradu. RacesOn pokriva mrežnu naknadu.')}</p>
   <p>{t('Demo account · Wallet proof confirms control of this wallet. It does not verify a real athlete’s identity or age.','Demo račun · Dokaz potvrđuje kontrolu novčanika, ne identitet ili dob stvarnog sportaša.')}</p>
  </details>
 </section>;
}
