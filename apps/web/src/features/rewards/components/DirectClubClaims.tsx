import RewardErrorNotice from "./RewardErrorNotice";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Hex} from 'viem';
import type {SponsorClubAward} from '../data/sponsorClubClaims';
import {clubSafeCreationHistory,type ClubCreationRecord} from '../data/clubSafeCreation';
import {prepareBrowserWalletProof,type DetectedRewardWallet} from '../data/browserWallet';
import {readClubDirectClaimV5,signDirectClubClaimV5,sendDirectClubClaimV5,type ClubDirectClaimV5} from '../data/clubDirectClaimsV5';
import {setupAmount} from '../model/setupAmount';
import SponsorWallet from './SponsorWallet';
import RewardClaimDialog from './RewardClaimDialog';
import RewardExplorerLink from './RewardExplorerLink';
import s from './SponsorLaunch.module.css';
export default function DirectClubClaims({awards,hr,onRefresh,onAccessError}:{awards:SponsorClubAward[];hr:boolean;onRefresh:()=>Promise<void>;onAccessError?:(e:unknown)=>void}){
 const [selected,setSelected]=useState<SponsorClubAward|null>(null),t=(en:string,local:string)=>hr?local:en;
 return <section aria-label={t('Direct club rewards','Izravne klupske nagrade')}>
  <p>{t('Distribution is approved. Two treasury owners consent, then either owner submits the claim. No further reviewer approval is needed.','Raspodjela je odobrena. Dva vlasnika riznice daju pristanak, zatim jedan šalje preuzimanje. Dodatno odobrenje pregledavatelja nije potrebno.')}</p>
  <ul>{awards.map(a=><li key={a.entitlementId}><strong>{a.slot===0?t('League','Liga'):`${t('Round','Kolo')} ${a.slot}`} · {setupAmount(BigInt(a.amountWei),hr)} test MON</strong>{' '}
   <button className={s.primary} onClick={()=>setSelected(a)}>{a.directClaim?.paid?t('View payment','Pregledaj isplatu'):t('Claim to club treasury','Preuzmi u klupsku riznicu')}</button></li>)}</ul>
  {selected?<RewardClaimDialog club hr={hr} onClose={()=>{setSelected(null);void onRefresh().catch(()=>{});}}>{onBusy=><DirectClubClaim award={selected} hr={hr} onBusy={onBusy} onAccessError={onAccessError}/>}</RewardClaimDialog>:null}
 </section>;
}
export function DirectClubClaim({award,hr,onBusy,onAccessError,fixedCreation}:{award:SponsorClubAward;fixedCreation?:{creationId:string;safeAddress:string};hr:boolean;onBusy?:(busy:boolean)=>void;onAccessError?:(e:unknown)=>void}){
 const [treasuries,setTreasuries]=useState<ClubCreationRecord[]>([]),[creationId,setCreationId]=useState(''),[view,setView]=useState<ClubDirectClaimV5|null>(null);
 const [wallet,setWallet]=useState<{wallet:DetectedRewardWallet;address:string}|null>(null),[proofs,setProofs]=useState<{address:string;signature:Hex}[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<'balance'|'gas'|'unknown'|null>(null),[ack,setAck]=useState(false),[pending,setPending]=useState<string|null>(null);
 const [pendingKind,setPendingKind]=useState<'receipt'|'registrationReceipt'>('receipt');
 const active=useRef(true),flight=useRef(false),currentWallet=useRef(wallet),accessError=useRef(onAccessError);currentWallet.current=wallet;accessError.current=onAccessError;
 const t=(en:string,local:string)=>hr?local:en,storage=`podium:club-direct:${award.approvalId}:${award.entitlementId}`;
 const choose=useCallback((w:typeof wallet)=>{setWallet(w);setAck(false);},[]);
 useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
 const run=useCallback(async(work:()=>Promise<void>)=>{if(flight.current)return;flight.current=true;setBusy(true);setError(null);
  try{await work();}catch(e){if(active.current){setError(e instanceof Error&&e.message==='claim_insufficient_balance'?'balance':e instanceof Error&&e.message==='claim_gas_limit'?'gas':'unknown');setAck(false);if(e&&typeof e==='object'&&'status'in e&&[401,403].includes(Number(e.status)))accessError.current?.(e);}}
  finally{flight.current=false;if(active.current)setBusy(false);}},[]);
 const load=useCallback(async(id:string,hash?:string|null,kind:'receipt'|'registrationReceipt'='receipt')=>{
  const v=await readClubDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},id,hash?{action:kind,hash}:undefined);
  if(v.amountWei!==award.amountWei||v.clubId!==award.clubId||(v.protocolVersion??5)!==(award.protocolVersion??5))throw Error('award_changed');
  if(active.current){setView(v);setCreationId(id);setProofs((v.ownerApproval?.signatures??[]) as {address:string;signature:Hex}[]);setAck(false);if(v.status==='paid'||v.registrationReceipt){setPending(null);try{sessionStorage.removeItem(storage);}catch{/* Optional recovery. */}}else if(v.ownerApproval?.submissions.length){setPending(v.ownerApproval.submissions[0]);setPendingKind(v.phase==='register'?'registrationReceipt':'receipt');}}
 },[award,storage]);
 useEffect(()=>{active.current=true;void run(async()=>{
  const records:ClubCreationRecord[]=[];let after:string|null=null;
  if(!fixedCreation)do{const page=await clubSafeCreationHistory(after);records.push(...page.items.filter(r=>r.clubId===award.clubId&&r.current&&r.verified));after=page.nextCursor;}while(after&&active.current);
  if(!active.current)return;setTreasuries(records);
  let saved:{creationId:string;hash:string;kind?:'receipt'|'registrationReceipt'}|null=null;try{const value=JSON.parse(sessionStorage.getItem(storage)??'null');if(value&&/^[0-9a-f-]{36}$/.test(value.creationId)&&/^0x[0-9a-f]{64}$/.test(value.hash)&&[undefined,'receipt','registrationReceipt'].includes(value.kind))saved=value;}catch{/* Optional recovery. */}
  if(saved&&(!fixedCreation||saved.creationId===fixedCreation.creationId)){setCreationId(saved.creationId);setPending(saved.hash);setPendingKind(saved.kind??'receipt');await load(saved.creationId,saved.hash,saved.kind??'receipt');}else if(fixedCreation)await load(fixedCreation.creationId);else if(records.length===1)await load(records[0].requestId);
 });return()=>{active.current=false;};},[award.clubId,load,run,storage,fixedCreation]);
 async function prepare(){if(!wallet||!creationId)return;const chosen=wallet,controller=new AbortController(),current=()=>active.current&&currentWallet.current===chosen;
  const proof=await prepareBrowserWalletProof(chosen.wallet.provider,window.location.origin,current,()=>{if(active.current)setWallet(null);},controller.signal);
  try{const confirmed=await proof.confirm();await proof.assertCurrent();const v=await readClubDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},creationId,{action:'prepare',proofId:confirmed.proofId});
   if(!current()||v.clubId!==award.clubId||v.amountWei!==award.amountWei||!v.owners.includes(chosen.address)||(v.protocolVersion??5)!==(award.protocolVersion??5)||v.clubClaim&&v.clubClaim.pot!==(award.slot===0?1:0))throw Error('claim_changed');setView(v);setProofs((v.ownerApproval?.signatures??[]) as {address:string;signature:Hex}[]);setAck(false);
  }finally{proof.dispose();controller.abort();}
 }
 async function fresh(){if(!view?.transaction)throw Error('claim_changed');const v=await readClubDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},creationId);
  if(!active.current||v.status!=='claimable'||v.safeAddress!==view.safeAddress||v.safeNonce!==view.safeNonce||v.owners.join()!==view.owners.join()||v.amountWei!==view.amountWei||v.recipient!==view.recipient||v.protocolVersion!==view.protocolVersion||v.phase!==view.phase||JSON.stringify(v.chainState)!==JSON.stringify(view.chainState)||v.ownerApproval?.requestId!==view.ownerApproval?.requestId)throw Error('claim_changed');return view;
 }
 async function sign(){if(!wallet||!ack||proofs.length>=2||proofs.some(p=>p.address===wallet.address))return;const chosen=wallet,v=await fresh();
  const signature=await signDirectClubClaimV5(chosen.wallet.provider,v,chosen.address,()=>active.current&&currentWallet.current===chosen);await fresh();
  if(!v.ownerApproval?.requestId)throw Error('claim_changed');
  const saved=await readClubDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},creationId,{action:'sign',requestId:v.ownerApproval.requestId,signature});
  if(active.current){setView(saved);setProofs((saved.ownerApproval?.signatures??[]) as {address:string;signature:Hex}[]);setAck(false);}
 }
 async function send(){if(!wallet||!ack||proofs.length<2||pending)return;const chosen=wallet,v=await fresh(),current=()=>active.current&&currentWallet.current===chosen;
  const signatures=proofs.slice(0,2).map(p=>p.signature);const hash=await(chosen.wallet.sendDirectClubClaim?chosen.wallet.sendDirectClubClaim(v,signatures,chosen.address,current):sendDirectClubClaimV5(chosen.wallet.provider,v,signatures,chosen.address,current));
  try{sessionStorage.setItem(storage,JSON.stringify({creationId,hash,kind:v.phase==='register'?'registrationReceipt':'receipt'}));}catch{/* Keep receipt hash visible. */}
  if(active.current){setPending(hash);setPendingKind(v.phase==='register'?'registrationReceipt':'receipt');setAck(false);setProofs([]);}
  if(v.ownerApproval?.requestId)await readClubDirectClaimV5({approvalId:award.approvalId!,entitlementId:award.entitlementId!},creationId,{action:'submitted',requestId:v.ownerApproval.requestId,hash});
 }
 return <section className={s.card}><h3>{setupAmount(BigInt(award.amountWei),hr)} test MON</h3>
  <p>{t('The full award goes to the club treasury. RacesOn sponsors network fees with Privy. External wallets pay their own network fees.','Cijela nagrada ide u klupsku riznicu. RacesOn pokriva mrežne naknade uz Privy. Vanjski novčanici plaćaju vlastite mrežne naknade.')}</p>
  {!fixedCreation&&!treasuries.length&&!busy?<p>{t('Create your club’s 2-of-3 treasury in Club and treasury first. Your award remains reserved.','Prvo stvorite klupsku riznicu s dva od tri potpisa u odjeljku Klub i riznica. Nagrada ostaje rezervirana.')}</p>:null}
  {treasuries.length>1?<label className={s.field}>{t('Club treasury','Klupska riznica')}<select value={creationId} disabled={busy||!!pending} onChange={e=>void run(()=>load(e.target.value))}><option value="" disabled>{t('Choose a treasury','Odaberite riznicu')}</option>{treasuries.map(r=><option key={r.requestId} value={r.requestId}>{r.verified!.safeAddress}</option>)}</select></label>:null}
  {view?<><RewardExplorerLink chainId={10143} kind="address" value={view.safeAddress}/>
   {view.status==='paid'?<><p role="status">{t('Reward paid','Nagrada je isplaćena')}</p>{view.receipt?<RewardExplorerLink chainId={10143} kind="tx" value={view.receipt.transactionHash}/>:null}</>
    :pending?<><p role="status">{pendingKind==='registrationReceipt'?t('Treasury registration submitted. Check registration before preparing the reward claim.','Registracija riznice je poslana. Provjerite registraciju prije pripreme preuzimanja nagrade.'):t('Claim submitted. Check payment to confirm its receipt.','Preuzimanje je poslano. Provjerite isplatu za potvrdu.')}</p><RewardExplorerLink chainId={10143} kind="tx" value={pending}/></>
    :view.status==='claimable'?<><SponsorWallet purpose="recipient" chainId={10143} hr={hr} onWallet={choose}/>
     {view.ownerApproval?.signerAddress===null?<p role="status">{t('You manage this club. The three selected treasury owners can prepare and approve this request from their own athlete accounts.','Upravljate ovim klubom. Tri odabrana vlasnika riznice pripremaju i odobravaju zahtjev iz vlastitih računa sportaša.')}</p>:null}
     {view.ownerApproval?.expiresAt?<p>{t('Approvals expire:','Odobrenja istječu:')} {new Date(view.ownerApproval.expiresAt).toLocaleString(hr?'hr-HR':'en-GB')}</p>:null}
     {view.protocolVersion===6?<p>{view.phase==='register'?t('First, two owners register this treasury. Registration does not pay the award. After confirmation, two owners sign the reward claim.','Prvo dva vlasnika registriraju riznicu. Registracija ne isplaćuje nagradu. Nakon potvrde dva vlasnika potpisuju preuzimanje nagrade.'):t('Two current owners must sign this specific reward claim. Signatures expire and cannot be reused.','Dva trenutačna vlasnika moraju potpisati ovo preuzimanje nagrade. Potpisi istječu i ne mogu se ponovno upotrijebiti.')}</p>:null}
     {!view.transaction?<button className={s.primary} disabled={busy||!wallet||!view.owners.includes(wallet.address)||view.ownerApproval?.signerAddress!==wallet.address} onClick={()=>void run(prepare)}>{view.phase==='register'?t('Prepare treasury registration','Pripremi registraciju riznice'):t('Prepare club claim','Pripremi klupsko preuzimanje')}</button>:<>
      <p>{Math.min(proofs.length,2)}/2 {proofs.length>=2?view.phase==='register'?t('owner signatures collected. Either owner can now submit the registration.','potpisa vlasnika prikupljeno. Jedan vlasnik sada može poslati registraciju.'):t('owner signatures collected. Either owner can now submit the claim.','potpisa vlasnika prikupljeno. Jedan vlasnik sada može poslati preuzimanje.'):t('owner signatures collected. Other selected owners can sign from Club treasury approvals in their own athlete account. Refresh to see their approvals.','potpisa vlasnika prikupljeno. Drugi odabrani vlasnici potpisuju iz vlastitog računa sportaša. Osvježite za pregled odobrenja.')}</p>
      <ul>{view.owners.map(owner=><li key={owner}><code>{owner.slice(0,8)}…{owner.slice(-6)}</code>{' · '}{proofs.some(p=>p.address===owner)?t('Signed','Potpisano'):t('Awaiting signature','Čeka se potpis')}</li>)}</ul>
      <label><input type="checkbox" checked={ack} disabled={busy||!wallet} onChange={e=>setAck(e.target.checked)}/>{view.phase==='register'?t('I consent to registering this treasury and its three owners for club rewards.','Pristajem na registraciju ove riznice i njezina tri vlasnika za klupske nagrade.'):t('I consent to this reward being paid to this club treasury.','Pristajem na isplatu ove nagrade u ovu klupsku riznicu.')}</label>
      {proofs.length<2?<button className={s.primary} disabled={busy||!ack||!wallet||!view.owners.includes(wallet.address)||view.ownerApproval?.signerAddress!==wallet.address||proofs.some(p=>p.address===wallet.address)} onClick={()=>void run(sign)}>{t('Sign as treasury owner','Potpiši kao vlasnik riznice')}</button>
       :<button className={s.primary} disabled={busy||!ack||!wallet||!view.owners.includes(wallet.address)||view.ownerApproval?.signerAddress!==wallet.address} onClick={()=>void run(send)}>{view.phase==='register'?t('Submit treasury registration','Pošalji registraciju riznice'):t('Submit club claim','Pošalji klupsko preuzimanje')}</button>}
     </>}
    </>:<p role="status">{view.status==='not_open'?t('Claims have not opened yet.','Preuzimanja još nisu otvorena.'):view.status==='paused'?t('Claims are temporarily paused.','Preuzimanja su privremeno zaustavljena.'):t('The claim deadline has passed.','Rok preuzimanja je istekao.')}</p>}
  </>:null}
  {busy?<p role="status">{t('Checking club reward…','Provjera klupske nagrade…')}</p>:null}
  {error?<RewardErrorNotice title={error==='balance'?t('Not enough test MON for gas','Nema dovoljno test MON za plin'):error==='gas'?t('Claim blocked by network fee','Mrežna naknada blokira preuzimanje'):t('Claim needs attention','Potrebna je provjera preuzimanja')}>
   {error==='balance'?t('Add test MON to the connected owner’s wallet for the network fee, then submit again. The full award goes to the club treasury. Nothing was sent.','Dodajte test MON u novčanik povezanog vlasnika za mrežnu naknadu pa ponovno pošaljite preuzimanje. Cijela nagrada ide u klupsku riznicu. Ništa nije poslano.'):error==='gas'?t('The claim fee estimate could not pass the allowed limit check. Wait for lower network fees and try again. Nothing was sent.','Procjena naknade nije prošla provjeru dopuštenog ograničenja. Pričekajte niže naknade i pokušajte ponovno. Ništa nije poslano.'):t('The claim could not be confirmed. Check wallet activity, then refresh. Preparing again requires both owners to sign again.','Preuzimanje nije potvrđeno. Provjerite aktivnost novčanika i osvježite. Nova priprema zahtijeva nove potpise oba vlasnika.')}
  </RewardErrorNotice>:null}
  <button className={s.secondary} disabled={busy||!creationId} onClick={()=>void run(()=>load(creationId,pending,pendingKind))}>{pending?pendingKind==='registrationReceipt'?t('Check registration','Provjeri registraciju'):t('Check payment','Provjeri isplatu'):t('Refresh status','Osvježi stanje')}</button>
 </section>;
}
