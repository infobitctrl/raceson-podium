import RewardErrorNotice from "../components/RewardErrorNotice";
import ReviewJourney from './ReviewJourney';
import {useAuth} from '@/lib/auth';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {useEffect,useRef,useState} from 'react';
import {readReviewPublication,type ReviewPublication} from '../data/reviewPublication';
import type {HostedUploadScope} from '../data/hostedAwardUpload';
import {useRewardEmbeddedWallet} from '../components/RewardEmbeddedWalletContext';
import {Check,LoaderCircle} from 'lucide-react';
import s from './HostedReviewPublication.module.css';
import p from '../components/Podium.module.css';
import {ApiError} from '@/lib/api';
function publicationFailure(error:unknown,hr:boolean){
 const code=error instanceof ApiError?error.code:error instanceof Error?error.message:'';
 if(error instanceof ApiError&&error.status===401)return hr?'Vaša je prijava istekla. Prijavite se ponovno kao pregledavatelj.':'Your session expired. Sign in as Reviewer again.';
 if(code==='controller_balance_required')return hr?'Novčaniku pregledavatelja treba test MON za mrežne naknade. Zatim nastavite spremljenu objavu.':'The reviewer wallet needs test MON for network fees. Then resume the saved publication.';
 if(code==='controller_gas_limit')return hr?'Mrežna naknada za objavu prelazi dopušteno ograničenje. Pričekajte niže naknade pa nastavite spremljenu objavu.':'The publication network fee exceeds the allowed limit. Wait for lower fees, then resume the saved publication.';
 if(code==='controller_source_not_ready')return hr?'Odobrene nagrade su promijenjene. Osvježite pregled prije objave.':'The approved awards changed. Refresh award review before publishing.';
 if(code==='controller_transaction_pending')return hr?'Druga kampanja ima nedovršenu objavu u ovom novčaniku. Nastavite tu objavu prije objave ove kampanje.':'Another campaign has an unfinished publication in this wallet. Resume that publication before publishing this campaign.';
 if(code==='review_publication_authorization_failed')return hr?'Pružatelj novčanika odbio je autorizaciju pregledavatelja. Nagrade još nisu objavljene.':'The wallet provider rejected the reviewer authorization. Awards have not been published yet.';
 if(code==='review_publication_request_expired')return hr?'Zahtjev za potpis je istekao. Nastavite objavu za novi zahtjev.':'The signing request expired. Resume publication to request a fresh authorization.';
 if(code==='review_publication_request_invalid')return hr?'Zahtjev za potpis ne odgovara odobrenoj objavi. Osvježite stanje objave.':'The signing request does not match the approved publication. Refresh publication status.';
 if(code==='review_publication_client_authorization_failed')return hr?'Autorizacija novčanika u pregledniku nije uspjela. Ponovno učitajte stranicu pa nastavite objavu.':'Browser wallet authorization failed. Reload this page, then resume publication.';
 if(code==='review_publication_session_changed'||code==='review_publication_session_required')return hr?'Veza s novčanikom pregledavatelja nije spremna. Ponovno učitajte stranicu pa nastavite objavu.':'The reviewer wallet connection is not ready. Reload this page, then resume publication.';
 if(code?.startsWith('review_publication_'))return hr?'Autorizacija novčanika nije dovršena. Nastavite objavu iz povezane prijave pregledavatelja.':'Wallet authorization was not completed. Resume publication from your connected reviewer session.';
 return hr?'Objava nije potvrđena. Osvježite stanje ili nastavite spremljenu objavu.':'Publication could not be confirmed. Refresh its status or resume the saved publication.';
}
export default function HostedReviewPublication({id,slot,approvalId,documentHash,hr}:HostedUploadScope&{documentHash:string;hr:boolean}){
 const embedded=useRewardEmbeddedWallet(),auth=useAuth(),session=useRewardSessionEpoch(auth.session);
 const [reload,setReload]=useState(0);
 const [phase,setPhase]=useState<'checking'|'wallet'|'submitting'|'confirming'>('checking');
 const [view,setView]=useState<ReviewPublication|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState<string|null>(null);
 const epoch=useRef(0),locked=useRef(false),connectionAttempt=useRef<string|null>(null);
 const connectionKey=`${session}:${id}:${slot}:${approvalId}`;
 const connectWallet=embedded.enable,connectionStatus=embedded.status;
 const canAuthorize=embedded.reviewerConnected===true&&!!embedded.authorizePublication;
 useEffect(()=>{const generation=++epoch.current;setView(null);setFailed(null);setBusy(false);locked.current=false;
  void readReviewPublication({id,slot,approvalId},documentHash).then(v=>{if(epoch.current===generation)setView(v);}).catch(error=>{if(epoch.current===generation)setFailed(publicationFailure(error,hr));});
  return()=>{epoch.current=generation+1;};},[id,slot,approvalId,documentHash,embedded.reviewerConnected,session,reload,hr]);
 useEffect(()=>{
  // Reconnect only the existing reviewer's verified wallet. SDK login has
  // createOnLogin disabled; this neither creates wallets nor authorizes a tx.
  if(view?.claimsOpen&&(!view.pending||view.pending.confirmed)||view?.ownership!=='owned'||canAuthorize||connectionStatus!=='off'||!connectWallet||connectionAttempt.current===connectionKey)return;
  connectionAttempt.current=connectionKey;
  connectWallet();
 },[view,canAuthorize,connectionStatus,connectWallet,connectionKey]);
 async function publish(){
  if(locked.current||!canAuthorize)return;locked.current=true;const generation=epoch.current;setBusy(true);setFailed(null);
  try{let lastConfirmedHash:string|null=null;
   for(let attempts=0;attempts<120;attempts++){
   if(epoch.current!==generation)return;
   setPhase('checking');
   let v=await readReviewPublication({id,slot,approvalId},documentHash,true);if(epoch.current!==generation)return;setView(v);
   if(v.authorization){
    if(!embedded.authorizePublication)throw Error('review_publication_session_required');
    setPhase('wallet');
    const authorization=await embedded.authorizePublication(v,()=>epoch.current===generation);
    if(epoch.current!==generation)return;
    setPhase('submitting');
    v=await readReviewPublication({id,slot,approvalId},documentHash,true,authorization);if(epoch.current!==generation)return;setView(v);
   }
   if(v.ownership!=='owned'||v.claimsOpen&&(!v.pending||v.pending.confirmed))return;
   if(!v.next&&!v.pending?.hash)throw Error('publication_paused');
   // A newly verified receipt can advance immediately. Keep pacing unresolved
   // or repeated observations so a stale provider cannot create a tight loop.
   if(v.pending?.confirmed&&v.pending.hash&&v.pending.hash!==lastConfirmedHash){lastConfirmedHash=v.pending.hash;continue;}
   setPhase('confirming');
   await new Promise(resolve=>setTimeout(resolve,2500));
  }throw Error('publication_confirmation_pending');
  }catch(error){if(epoch.current===generation)setFailed(publicationFailure(error,hr));}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 }
 const complete=!!view?.claimsOpen&&(!view.pending||view.pending.confirmed);
 const action=view?.pending&&!view.pending.confirmed?view.pending.action:view?.next;
 const stage=complete?3:action==='activate'?2:action==='stage'?1:0;
 const labels=hr?['Nagrade','Raspodjela','Preuzimanje']:['Upload awards','Confirm allocation','Open claims'];
 const message=complete?null
  :busy?phase==='wallet'?(hr?'Potvrdite u novčaniku.':'Confirm in your wallet.')
   :phase==='submitting'?(hr?'Slanje transakcije…':'Submitting transaction…')
   :phase==='confirming'||view?.pending?.hash&&!view.pending.confirmed?(hr?'Čekamo potvrdu mreže…':'Waiting for network confirmation…')
   :(hr?'Provjeravamo sljedeći korak…':'Checking the next step…')
  :!view&&!failed?(hr?'Provjeravamo objavu…':'Checking publication…'):null;
 return <section className={s.publication} aria-label={hr?'Objava nagrada':'Award publication'}>
  <ReviewJourney stage={complete?4:stage===2?3:2} hr={hr}/>
  {complete?<div className={s.receipt} role="status"><Check size={24} aria-hidden="true"/><div><h3>{hr?'Nagrade su objavljene':'Rewards published'}</h3><p>{hr?'Preuzimanje je otvoreno.':'Claims are open.'}</p></div></div>:<><div className={s.heading}><h3>{busy?(hr?'Objava nagrada':'Publishing awards'):(hr?'Objavi nagrade':'Publish awards')}</h3>
   {busy?<span className={s.step}>{hr?'Korak':'Step'} {stage+1}/3</span>:null}
  </div>
  <ol className={s.steps} aria-label={hr?'Napredak objave':'Publication progress'} aria-busy={busy}>
   {labels.map((label,index)=><li key={label} data-state={index<stage?'complete':index===stage?(busy?'active':'ready'):'upcoming'} aria-current={index===stage?'step':undefined} aria-label={`${label}: ${index<stage?(hr?'dovršeno':'complete'):index===stage?(busy?(hr?'u tijeku':'in progress'):(hr?'sljedeće':'next')):(hr?'na čekanju':'pending')}`}>
    <span className={s.marker} aria-hidden="true">{index<stage?<Check size={18}/>:index===stage&&busy?<LoaderCircle size={18} className={s.spinner}/>:index+1}</span><span>{label}</span>
   </li>)}
  </ol></>}
  {message?<p className={s.status} role="status">{message}</p>:null}
  {busy?<p className={s.hint}>{hr?'Računajte na oko 30 sekundi po koraku; potvrda mreže može potrajati dulje. Ostavite stranicu otvorenu — napredak se sprema.':'Allow about 30 seconds per step; network confirmation can take longer. Keep this page open — progress is saved.'}</p>:null}
  {!complete?<>
   {view?.ownership==='connect_required'||view?.ownership==='transfer_required'?<><p role="status">{hr?'Ovu kampanju može objaviti samo pregledavatelj koji je vlasnik dodijeljenog novčanika. Provjerite svoj račun i pristup novčaniku.':'Only the reviewer who owns the assigned wallet can publish this campaign. Check your account and wallet access.'}</p><a className={p.secondary} href="/rewards/review">{hr?'Provjeri pristup novčaniku':'Check wallet access'}</a></>:null}
   {failed?<><RewardErrorNotice title={hr?'Objava je zaustavljena':'Publication stopped'}>{failed}</RewardErrorNotice><button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Osvježi stanje objave':'Refresh publication status'}</button></>:null}
   {!busy&&view?.ownership==='owned'&&!canAuthorize?<>
    <p role={embedded.status==='error'||embedded.status==='unconfigured'?'alert':'status'}>{embedded.status==='error'||embedded.status==='unconfigured'?(hr?'Novčanik pregledavatelja nije povezan. Ponovno povežite postojeći račun.':'The reviewer wallet could not connect. Reconnect your existing account.'):(hr?'Povezujemo vaš postojeći novčanik pregledavatelja…':'Connecting your existing reviewer wallet…')}</p>
    {embedded.status==='error'&&embedded.enable?<button className={p.secondary} onClick={()=>embedded.enable?.()}>{hr?'Ponovno poveži novčanik pregledavatelja':'Reconnect reviewer wallet'}</button>:null}
   </>:null}
   {!busy&&view?.ownership==='owned'?<button className={p.primary} disabled={!canAuthorize} onClick={()=>void publish()}>{failed||view?.pending?hr?'Nastavi objavu':'Resume publication':hr?'Objavi nagrade i otvori preuzimanje':'Publish awards and open claims'}</button>:null}
  </>:null}
 </section>;
}
