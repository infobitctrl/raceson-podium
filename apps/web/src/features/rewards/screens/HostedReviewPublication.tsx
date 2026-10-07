import {useAuth} from '@/lib/auth';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {useEffect,useRef,useState} from 'react';
import {readReviewPublication,type ReviewPublication} from '../data/reviewPublication';
import type {HostedUploadScope} from '../data/hostedAwardUpload';
import {useRewardEmbeddedWallet} from '../components/RewardEmbeddedWalletContext';
import RewardActionProgress from '../components/RewardActionProgress';
import p from '../components/Podium.module.css';
export default function HostedReviewPublication({id,slot,approvalId,documentHash,hr}:HostedUploadScope&{documentHash:string;hr:boolean}){
 const embedded=useRewardEmbeddedWallet(),auth=useAuth(),session=useRewardSessionEpoch(auth.session);
 const [reload,setReload]=useState(0);
 const [view,setView]=useState<ReviewPublication|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const epoch=useRef(0),locked=useRef(false);
 useEffect(()=>{const generation=++epoch.current;setView(null);setFailed(false);setBusy(false);locked.current=false;
  void readReviewPublication({id,slot,approvalId},documentHash).then(v=>{if(epoch.current===generation)setView(v);}).catch(()=>{if(epoch.current===generation)setFailed(true);});
  return()=>{epoch.current=generation+1;};},[id,slot,approvalId,documentHash,embedded.reviewerConnected,session,reload]);
 async function publish(){
  if(locked.current)return;locked.current=true;const generation=epoch.current;setBusy(true);setFailed(false);
  try{for(let attempts=0;attempts<120;attempts++){
   if(epoch.current!==generation)return;
   const v=await readReviewPublication({id,slot,approvalId},documentHash,true);if(epoch.current!==generation)return;setView(v);
   if(v.ownership!=='owned'||v.claimsOpen&&(!v.pending||v.pending.confirmed))return;
   if(!v.next&&!v.pending?.hash)throw Error('publication_paused');
   await new Promise(resolve=>setTimeout(resolve,2500));
  }throw Error('publication_confirmation_pending');
  }catch{if(epoch.current===generation)setFailed(true);}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 }
 const stage=view?.pending?.action??view?.next;
 return <section aria-label={hr?'Objava nagrada':'Award publication'}>
  <h4>{hr?'Objavi nagrade i otvori preuzimanje':'Publish awards and open claims'}</h4>
  <p>{hr?'Vaš račun pregledavatelja odobrava raspodjelu i objavljuje nagrade. Ostanite na stranici dok mreža potvrđuje objavu.':'Your reviewer account approves the allocation and publishes the awards. Keep this page open while the network confirms publication.'}</p>
  {view?.claimsOpen&&(!view.pending||view.pending.confirmed)?<p role="status">{hr?'Nagrade su objavljene. Preuzimanje je otvoreno.':'Awards published. Claims are open.'}</p>:<>
   {busy?<RewardActionProgress label={hr?'Objava nagrada':'Award publication'} labels={hr?['Učitavanje','Potvrda raspodjele','Otvaranje']:['Uploading','Confirming allocation','Opening claims']} stage={stage==='activate'?2:stage==='stage'?1:0} message={hr?'Objavljujemo odobrene nagrade s vašeg računa. Čekamo potvrdu mreže.':'Publishing the approved awards with your account. Waiting for network confirmation.'}/>:null}
   {view?.ownership==='connect_required'||view?.ownership==='transfer_required'?<><p role="status">{hr?'Objava s računa pregledavatelja još nije dostupna. Privy ne podržava predaju ovog novčanika kroz trenutačnu prijavu. Potrebno je postaviti podržan pristup.':'Reviewer publication is not available yet. Privy does not support handing over this wallet through the current sign-in flow. A supported access setup is required.'}</p><a className={p.secondary} href={`/rewards/wallet-handover?setup=${encodeURIComponent(id)}&slot=${slot}&approval=${encodeURIComponent(approvalId)}`}>{hr?'Provjeri pristup novčaniku':'Check wallet access'}</a></>:null}
   {failed?<><p role="alert">{hr?'Objava nije potvrđena. Ponovite kako biste nastavili spremljenu transakciju.':'Publication could not be confirmed. Retry to continue the saved transaction.'}</p><button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Osvježi stanje objave':'Refresh publication status'}</button></>:null}
   {!busy&&view?.ownership==='owned'?<button className={p.primary} onClick={()=>void publish()}>{failed||view?.pending?hr?'Nastavi objavu':'Resume publication':hr?'Objavi nagrade i otvori preuzimanje':'Publish awards and open claims'}</button>:null}
  </>}
 </section>;
}
