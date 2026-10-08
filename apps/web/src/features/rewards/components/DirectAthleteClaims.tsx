import RewardErrorNotice from "./RewardErrorNotice";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {SponsorAward} from '../data/sponsorProgramme';
import {prepareBrowserWalletProof,type DetectedRewardWallet} from '../data/browserWallet';
import {readDirectClaimV5,sendDirectClaimV5,type DirectClaimV5} from '../data/directClaimsV5';
import {setupAmount} from '../model/setupAmount';
import SponsorWallet from './SponsorWallet';
import RewardClaimDialog from './RewardClaimDialog';
import RewardExplorerLink from './RewardExplorerLink';
import s from './AthleteRewards.module.css';
import claimStyle from './AthleteClaimReview.module.css';
export default function DirectAthleteClaims({awards,hr,onRefresh,onAccessError}:{awards:SponsorAward[];hr:boolean;onRefresh:()=>Promise<void>;onAccessError?:(error:unknown)=>void}){
 const [selected,setSelected]=useState<SponsorAward|null>(null),t=(en:string,local:string)=>hr?local:en;
 return <section aria-label={t('Your rewards','Vaše nagrade')}><h2>{t('Awards','Nagrade')}</h2>
  <p>{t('Your awards stay reserved until the claim deadline. Create or connect your wallet when you are ready, then claim.','Nagrade ostaju rezervirane do roka preuzimanja. Kreirajte ili povežite novčanik kada budete spremni, zatim preuzmite nagradu.')}</p>
  <ul className={s.awards}>{awards.map(a=><li className={s.award} key={a.entitlementId}><div className={s.awardTop}><div><h3>{a.slot===0?t('League reward','Nagrada lige'):`${t('Round','Kolo')} ${a.slot}`}</h3><p>{t('Distribution approved. No further reviewer approval is needed.','Raspodjela je odobrena. Dodatno odobrenje pregledavatelja nije potrebno.')}</p></div>
   <div className={s.awardAction}><strong>{setupAmount(BigInt(a.amountWei),hr)} <small>test MON</small></strong><button className={s.primary} onClick={()=>setSelected(a)}>{a.directClaim?.paid?t('View payment','Pregledaj isplatu'):t('Claim reward','Preuzmi nagradu')}</button></div></div></li>)}</ul>
  {selected?<RewardClaimDialog athlete title={t('Claim your reward','Preuzmite svoju nagradu')} hr={hr} onClose={()=>{setSelected(null);void onRefresh().catch(()=>{});}}>{onBusy=><DirectAthleteClaim award={selected} hr={hr} onBusy={onBusy} onAccessError={onAccessError}/>}</RewardClaimDialog>:null}
 </section>;
}
export function DirectAthleteClaim({award,hr,onBusy,onAccessError}:{award:SponsorAward;hr:boolean;onBusy?:(busy:boolean)=>void;onAccessError?:(error:unknown)=>void}){
 const [view,setView]=useState<DirectClaimV5|null>(null),[wallet,setWallet]=useState<{wallet:DetectedRewardWallet;address:string}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState<'balance'|'gas'|'unknown'|null>(null),[ack,setAck]=useState(false),[pending,setPending]=useState<string|null>(null);
 const active=useRef(true),flight=useRef(false),currentWallet=useRef(wallet),abort=useRef<AbortController|null>(null),accessError=useRef(onAccessError);currentWallet.current=wallet;accessError.current=onAccessError;
 const t=(en:string,local:string)=>hr?local:en,storage=`podium:direct-claim:${award.approvalId}:${award.entitlementId}`;
 const choose=useCallback((value:{wallet:DetectedRewardWallet;address:string}|null)=>{setWallet(value);setAck(false);},[]);
 useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
 const load=useCallback(async(hash?:string|null)=>{
  const v=await readDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},hash?{action:'receipt',hash}:undefined);
  if(v.amountWei!==award.amountWei)throw Error('award_changed');
  if(active.current){setView(v);if(v.status==='paid'){setPending(null);try{sessionStorage.removeItem(storage);}catch{/* Optional recovery only. */}}}
 },[award.approvalId,award.entitlementId,award.amountWei,storage]);
 const run=useCallback(async(work:()=>Promise<void>)=>{if(flight.current)return;flight.current=true;setBusy(true);setError(null);
  try{await work();}catch(e){if(active.current){setError(e instanceof Error&&e.message==='claim_insufficient_balance'?'balance':e instanceof Error&&e.message==='claim_gas_limit'?'gas':'unknown');setAck(false);if(e&&typeof e==='object'&&'status'in e&&[401,403].includes(Number(e.status)))accessError.current?.(e);}}
  finally{flight.current=false;if(active.current)setBusy(false);}},[]);
 useEffect(()=>{active.current=true;let hash:string|null=null;try{const saved=sessionStorage.getItem(storage);if(saved&&/^0x[0-9a-f]{64}$/.test(saved))hash=saved;}catch{/* Optional recovery only. */}
  setPending(hash);void run(()=>load(hash));return()=>{active.current=false;abort.current?.abort();};},[load,run,storage]);
 async function claim(){if(!wallet||!ack||view?.status!=='claimable'||pending)return;
  const chosen=wallet,isCurrent=()=>active.current&&currentWallet.current===chosen;
  const controller=new AbortController();abort.current=controller;
  const proof=await prepareBrowserWalletProof(chosen.wallet.provider,window.location.origin,isCurrent,()=>{if(active.current){setWallet(null);setAck(false);}},controller.signal);
  try{
   const confirmed=await proof.confirm();await proof.assertCurrent();
   const fresh=await readDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},{action:'prepare',proofId:confirmed.proofId});
   if(!isCurrent()||fresh.amountWei!==award.amountWei||fresh.transaction?.from!==chosen.address)throw Error('wallet_changed');
   const hash=await(chosen.wallet.sendDirectClaim?chosen.wallet.sendDirectClaim(fresh,isCurrent):sendDirectClaimV5(chosen.wallet.provider,fresh,isCurrent));
   try{sessionStorage.setItem(storage,hash);}catch{/* Keep the returned hash visible. */}
   if(active.current){setPending(hash);setView({...fresh,transaction:null});setAck(false);}
  }finally{proof.dispose();controller.abort();}
 }
 return <section className={s.review}><strong>{setupAmount(BigInt(award.amountWei),hr)} test MON</strong>
  <p>{t('Monad testnet · Your wallet receives the full award. Your wallet pays the network fee.','Monad testnet · Novčanik prima cijelu nagradu i plaća mrežnu naknadu.')}</p>
  {view?.status==='paid'?<><p role="status">{t('Reward paid','Nagrada je isplaćena')}</p>{view.recipient?<RewardExplorerLink chainId={10143} kind="address" value={view.recipient}/>:null}{view.receipt?<RewardExplorerLink chainId={10143} kind="tx" value={view.receipt.transactionHash}/>:null}</>
   :pending?<><p role="status">{t('Claim submitted. Check payment to confirm the receipt.','Preuzimanje je poslano. Provjerite isplatu za potvrdu.')}</p><RewardExplorerLink chainId={10143} kind="tx" value={pending}/></>
   :view?.status==='claimable'?<><SponsorWallet purpose="recipient" chainId={10143} hr={hr} onWallet={choose}/>
    <label className={claimStyle.consent}><input type="checkbox" checked={ack} disabled={busy||!wallet} onChange={e=>setAck(e.target.checked)}/>{t('Claim this reward to my connected wallet.','Preuzmi ovu nagradu na moj povezani novčanik.')}</label>
    <button className={s.primary} disabled={busy||!wallet||!ack} onClick={()=>void run(claim)}>{busy?t('Confirm in your wallet…','Potvrdite u novčaniku…'):t('Claim reward','Preuzmi nagradu')}</button></>
   :view?<p role="status">{view.status==='not_open'?t('Claims have not opened yet.','Preuzimanja još nisu otvorena.'):view.status==='paused'?t('Claims are temporarily paused.','Preuzimanja su privremeno zaustavljena.'):t('The claim deadline has passed.','Rok preuzimanja je istekao.')}</p>:null}
  {busy?<p role="status">{t('Checking your reward…','Provjera nagrade…')}</p>:null}
  {error?<RewardErrorNotice title={error==='balance'?t('Not enough test MON for gas','Nema dovoljno test MON za plin'):error==='gas'?t('Claim blocked by network fee','Mrežna naknada blokira preuzimanje'):t('Claim needs attention','Potrebna je provjera preuzimanja')}>
   {error==='balance'?t('Add test MON to your connected wallet for the claim’s network fee, then claim again. Your award remains reserved until the claim deadline. Nothing was sent.','Dodajte test MON u povezani novčanik za mrežnu naknadu pa ponovno preuzmite nagradu. Nagrada ostaje rezervirana do roka preuzimanja. Ništa nije poslano.'):error==='gas'?t('The claim fee estimate could not pass the allowed limit check. Wait for lower network fees and try again. Nothing was sent.','Procjena naknade nije prošla provjeru dopuštenog ograničenja. Pričekajte niže naknade i pokušajte ponovno. Ništa nije poslano.'):t('The claim could not be confirmed. Check your wallet activity and refresh the payment status before trying again.','Preuzimanje nije potvrđeno. Provjerite aktivnost novčanika i osvježite stanje isplate prije ponovnog pokušaja.')}
  </RewardErrorNotice>:null}
  <button className={s.secondary} disabled={busy} onClick={()=>void run(()=>load(pending))}>{pending?t('Check payment','Provjeri isplatu'):t('Refresh status','Osvježi stanje')}</button>
  <p className={s.note}>{t('Demo account · Wallet proof confirms control of this wallet. It does not verify a real athlete’s identity or age.','Demo račun · Dokaz potvrđuje kontrolu novčanika, ne identitet ili dob stvarnog sportaša.')}</p>
 </section>;
}
