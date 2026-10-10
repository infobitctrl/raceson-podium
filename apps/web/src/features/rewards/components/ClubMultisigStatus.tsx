import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Clock3} from 'lucide-react';
import type {ClubOwnerAward} from '../data/clubOwnerApprovals';
import type {ClubDirectClaimV5} from '../data/clubDirectClaimsV5';

// Keep only presentation facts: signed payloads are never stored in this summary.
type Progress = {
 status: ClubDirectClaimV5['status']; phase: 'register'|'claim'; separateRegistration: boolean;
 requested: boolean; expiresAt: string|null; count: number; signed: boolean; signer: boolean; submitted: boolean;
};
export default function ClubMultisigStatus({item,hr,onAccessError}:{item:ClubOwnerAward;hr:boolean;onAccessError?:(error:unknown)=>void}){
 const [progress,setProgress]=useState<Progress|null>(null),[failed,setFailed]=useState(false),[now,setNow]=useState(Date.now);
 const access=useRef(onAccessError);access.current=onAccessError;
 useEffect(()=>{
  let active=true;setProgress(null);setFailed(false);
  void import('../data/clubDirectClaimsV5').then(({readClubDirectClaimV5})=>readClubDirectClaimV5({approvalId:item.award.approvalId,entitlementId:item.award.entitlementId},item.creationId)).then(view=>{
   if(!active)return;
   if(view.clubId!==item.award.clubId||view.safeAddress!==item.safeAddress||view.amountWei!==item.award.amountWei||(view.protocolVersion??5)!==(item.award.protocolVersion??5))throw Error('award_changed');
   const approval=view.ownerApproval,signers=new Set((approval?.signatures??[]).map(signature=>signature.address).filter(address=>view.owners.includes(address)));
   setProgress({status:view.status,phase:view.phase??'claim',separateRegistration:view.protocolVersion===6,
    requested:!!approval?.requestId,expiresAt:approval?.expiresAt??null,count:Math.min(signers.size,2),
    signed:!!approval?.signerAddress&&signers.has(approval.signerAddress),signer:!!approval?.signerAddress,submitted:!!approval?.submissions.length});
   setNow(Date.now());
  }).catch(error=>{if(!active)return;setFailed(true);setProgress(null);if(error&&typeof error==='object'&&'status'in error&&[401,403].includes(Number(error.status)))access.current?.(error);});
  return()=>{active=false;};
 },[item]);
 useEffect(()=>{
  if(!progress?.expiresAt)return;
  const delay=Date.parse(progress.expiresAt)-Date.now();
  if(delay<=0)return;
  const timer=setTimeout(()=>setNow(Date.now()),Math.min(delay+1,2_147_483_647));
  return()=>clearTimeout(timer);
 },[progress]);
 const t=(en:string,local:string)=>hr?local:en;
 if(failed)return <p className="mt-2 text-sm text-muted-foreground" role="status">{t('Multisig status unavailable. Refresh approvals to retry.','Stanje potpisa nije dostupno. Osvježite odobrenja.')}</p>;
 if(!progress)return <p className="mt-2 text-sm text-muted-foreground" role="status">{t('Checking multisig status…','Provjera stanja potpisa…')}</p>;
 const paid=progress.status==='paid',expired=!!progress.expiresAt&&Date.parse(progress.expiresAt)<=now;
 const stage=paid?(progress.separateRegistration?t('3 · Reward paid','3 · Nagrada isplaćena'):t('Reward paid','Nagrada isplaćena')):progress.phase==='register'?t('1 · Treasury registration','1 · Registracija riznice'):progress.separateRegistration?t('2 · Reward claim','2 · Preuzimanje nagrade'):t('Reward claim','Preuzimanje nagrade');
 const state=paid?t('Payment confirmed','Isplata potvrđena'):progress.submitted?t('Submitted · awaiting confirmation','Poslano · čeka se potvrda'):progress.status==='not_open'?t('Claims not open','Preuzimanje nije otvoreno'):progress.status==='paused'?t('Claims paused','Preuzimanje zaustavljeno'):progress.status==='expired'?t('Claim deadline passed','Rok preuzimanja istekao'):expired?t('Request expired · prepare again','Zahtjev istekao · pripremite ponovno'):!progress.requested?t('Awaiting preparation','Čeka se priprema'):progress.count>=2?t('Ready to submit','Spremno za slanje'):t('Collecting signatures','Prikupljanje potpisa');
 const personal=paid?t('No further signature needed','Nije potreban dodatni potpis'):!progress.signer?t('You are not a selected signer','Niste odabrani potpisnik'):expired&&!progress.submitted?t('No valid signature · new request needed','Nema važećeg potpisa · potreban je novi zahtjev'):!progress.requested?t('You have not signed · no active request','Niste potpisali · nema aktivnog zahtjeva'):progress.signed?t('You signed this request','Potpisali ste ovaj zahtjev'):t('You have not signed this request','Niste potpisali ovaj zahtjev');
 const validSigned=progress.signed&&(!expired||progress.submitted);
 return <div className="mt-2 space-y-1 text-sm" aria-label={t('Multisig progress','Napredak potpisa')}>
  <p className="font-medium">{stage}</p>
  <p className="text-muted-foreground">{state}{!paid&&progress.requested?` · ${expired&&!progress.submitted?0:progress.count}/2 ${t('signatures','potpisa')}`:''}</p>
  <p className={`flex items-center gap-1.5 ${validSigned||paid?'text-emerald-700':'text-muted-foreground'}`}>
   {validSigned||paid?<CheckCircle2 size={15} aria-hidden="true"/>:<Clock3 size={15} aria-hidden="true"/>}{personal}
  </p>
 </div>;
}
