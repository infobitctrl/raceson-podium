import {useAuth} from '@/lib/auth';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {useEffect,useRef,useState} from 'react';
import {readReviewPublication,type ReviewPublication} from '../data/reviewPublication';
import type {HostedUploadScope} from '../data/hostedAwardUpload';
import {useRewardEmbeddedWallet} from '../components/RewardEmbeddedWalletContext';
import RewardActionProgress from '../components/RewardActionProgress';
import p from '../components/Podium.module.css';
import {ApiError} from '@/lib/api';
function publicationFailure(error:unknown,hr:boolean){
 const code=error instanceof ApiError?error.code:error instanceof Error?error.message:'';
 if(error instanceof ApiError&&error.status===401)return hr?'Vaša je prijava istekla. Prijavite se ponovno kao pregledavatelj.':'Your session expired. Sign in as Reviewer again.';
 if(code==='controller_balance_required')return hr?'Novčaniku pregledavatelja treba test MON za mrežne naknade. Zatim nastavite spremljenu objavu.':'The reviewer wallet needs test MON for network fees. Then resume the saved publication.';
 if(code==='controller_source_not_ready')return hr?'Odobrene nagrade su promijenjene. Osvježite pregled prije objave.':'The approved awards changed. Refresh award review before publishing.';
 if(code?.startsWith('review_publication_'))return hr?'Autorizacija novčanika nije dovršena. Nastavite objavu iz povezane prijave pregledavatelja.':'Wallet authorization was not completed. Resume publication from your connected reviewer session.';
 return hr?'Objava nije potvrđena. Osvježite stanje ili nastavite spremljenu objavu.':'Publication could not be confirmed. Refresh its status or resume the saved publication.';
}
export default function HostedReviewPublication({id,slot,approvalId,documentHash,hr}:HostedUploadScope&{documentHash:string;hr:boolean}){
 const embedded=useRewardEmbeddedWallet(),auth=useAuth(),session=useRewardSessionEpoch(auth.session);
 const [reload,setReload]=useState(0);
 const [view,setView]=useState<ReviewPublication|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState<string|null>(null);
 const epoch=useRef(0),locked=useRef(false);
 useEffect(()=>{const generation=++epoch.current;setView(null);setFailed(null);setBusy(false);locked.current=false;
  void readReviewPublication({id,slot,approvalId},documentHash).then(v=>{if(epoch.current===generation)setView(v);}).catch(error=>{if(epoch.current===generation)setFailed(publicationFailure(error,hr));});
  return()=>{epoch.current=generation+1;};},[id,slot,approvalId,documentHash,embedded.reviewerConnected,session,reload,hr]);
 async function publish(){
  if(locked.current)return;locked.current=true;const generation=epoch.current;setBusy(true);setFailed(null);
  try{for(let attempts=0;attempts<120;attempts++){
   if(epoch.current!==generation)return;
   let v=await readReviewPublication({id,slot,approvalId},documentHash,true);if(epoch.current!==generation)return;setView(v);
   if(v.authorization){
    if(!embedded.authorizePublication)throw Error('review_publication_authorization_required');
    const authorization=await embedded.authorizePublication(v,()=>epoch.current===generation);
    if(epoch.current!==generation)return;
    v=await readReviewPublication({id,slot,approvalId},documentHash,true,authorization);if(epoch.current!==generation)return;setView(v);
   }
   if(v.ownership!=='owned'||v.claimsOpen&&(!v.pending||v.pending.confirmed))return;
   if(!v.next&&!v.pending?.hash)throw Error('publication_paused');
   await new Promise(resolve=>setTimeout(resolve,2500));
  }throw Error('publication_confirmation_pending');
  }catch(error){if(epoch.current===generation)setFailed(publicationFailure(error,hr));}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 }
 const stage=view?.pending?.action??view?.next;
 return <section aria-label={hr?'Objava nagrada':'Award publication'}>
  <h4>{hr?'Objavi nagrade i otvori preuzimanje':'Publish awards and open claims'}</h4>
  <p>{hr?'Vaš račun pregledavatelja odobrava raspodjelu i objavljuje nagrade. Ostanite na stranici dok mreža potvrđuje objavu.':'Your reviewer account approves the allocation and publishes the awards. Keep this page open while the network confirms publication.'}</p>
  {view?.claimsOpen&&(!view.pending||view.pending.confirmed)?<p role="status">{hr?'Nagrade su objavljene. Preuzimanje je otvoreno.':'Awards published. Claims are open.'}</p>:<>
   {busy?<RewardActionProgress label={hr?'Objava nagrada':'Award publication'} labels={hr?['Učitavanje','Potvrda raspodjele','Otvaranje']:['Uploading','Confirming allocation','Opening claims']} stage={stage==='activate'?2:stage==='stage'?1:0} message={hr?'Objavljujemo odobrene nagrade s vašeg računa. Čekamo potvrdu mreže.':'Publishing the approved awards with your account. Waiting for network confirmation.'}/>:null}
   {view?.ownership==='connect_required'||view?.ownership==='transfer_required'?<><p role="status">{hr?'Ovu kampanju može objaviti samo pregledavatelj koji je vlasnik dodijeljenog novčanika. Provjerite svoj račun i pristup novčaniku.':'Only the reviewer who owns the assigned wallet can publish this campaign. Check your account and wallet access.'}</p><a className={p.secondary} href="/rewards/review">{hr?'Provjeri pristup novčaniku':'Check wallet access'}</a></>:null}
   {failed?<><p role="alert">{failed}</p><button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Osvježi stanje objave':'Refresh publication status'}</button></>:null}
   {!busy&&view?.ownership==='owned'?<button className={p.primary} onClick={()=>void publish()}>{failed||view?.pending?hr?'Nastavi objavu':'Resume publication':hr?'Objavi nagrade i otvori preuzimanje':'Publish awards and open claims'}</button>:null}
  </>}
 </section>;
}
