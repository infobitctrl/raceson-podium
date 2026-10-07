import HostedClubClaimReviews from './HostedClubClaimReviews';
import HostedReviewPublication from './HostedReviewPublication';
import HostedClaimReviews from './HostedClaimReviews';
import {useEffect,useRef,useState} from 'react';
import {readHostedAwardUpload,readHostedAwardHandoff,type HostedUploadScope} from '../data/hostedAwardUpload';
import p from '../components/Podium.module.css';
import s from './HostedReviewWorkspace.module.css';
import RewardActionProgress from '../components/RewardActionProgress';
import {Check} from 'lucide-react';
type Upload=Awaited<ReturnType<typeof readHostedAwardUpload>>;
type Handoff=Awaited<ReturnType<typeof readHostedAwardHandoff>>;
export default function HostedAwardUpload({id,slot,approvalId,contextHash,documentHash,hr}:HostedUploadScope&{contextHash:string;documentHash:string;hr:boolean}){
 const [view,setView]=useState<Upload|null>(null),[handoff,setHandoff]=useState<Handoff|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0);
 const epoch=useRef(0),pending=useRef<{kind:'upload'|'handoff';requestId:string;documentHash:string}|null>(null);
 useEffect(()=>{const generation=++epoch.current;setBusy(true);setError(false);setView(null);setHandoff(null);pending.current=null;
  void (async()=>{const scope={id,slot,approvalId},v=await readHostedAwardUpload(scope);
   if(v.contextHash!==contextHash||v.documentHash!==documentHash)throw Error('reward_planning_revision_changed');
   if(generation!==epoch.current)return;
   const h=v.current&&v.prepared?await readHostedAwardHandoff(scope):null;
   if(generation===epoch.current){setView(v);setHandoff(h);}
  })().catch(()=>{if(generation===epoch.current)setError(true);}).finally(()=>{if(generation===epoch.current)setBusy(false);});
  return()=>{epoch.current=generation+1;};},[id,slot,approvalId,contextHash,documentHash,reload]);
 async function act(kind:'upload'|'handoff'){
  const generation=epoch.current,scope={id,slot,approvalId};
  if(!pending.current){if(!view?.current||kind==='handoff'&&!handoff?.current)return;pending.current={kind,requestId:crypto.randomUUID(),documentHash:kind==='upload'?documentHash:handoff!.publicationHash};}
  const command=pending.current;setBusy(true);setError(false);
  try{
   if(command.kind==='upload'){
    const v=await readHostedAwardUpload(scope,{requestId:command.requestId,contextHash,documentHash:command.documentHash});
    if(generation!==epoch.current)return;setView(v);pending.current=null;
    if(v.current&&v.prepared){const h=await readHostedAwardHandoff(scope);if(generation!==epoch.current)return;setHandoff(h);}
   }else{
    const h=await readHostedAwardHandoff(scope,{action:'publication',requestId:command.requestId,documentHash:command.documentHash});if(generation!==epoch.current)return;
    const v=await readHostedAwardUpload(scope);if(generation!==epoch.current)return;
    if(v.contextHash!==contextHash||v.documentHash!==documentHash)throw Error('reward_planning_revision_changed');
    setView(v);setHandoff(h);pending.current=null;
   }
  }catch{if(generation===epoch.current){setError(true);setView(null);setHandoff(null);}}
  finally{if(generation===epoch.current)setBusy(false);}
 }
 return <section className={p.panel} aria-label={hr?'Priprema i objava nagrada':'Award preparation and publication'}><h3>{hr?'Pripremi odobrene nagrade':'Prepare approved awards'}</h3>
  <p>{hr?'Provjerite uplatu, pripremite nagrade i potvrdite predaju rezultata.':'Verify funding, prepare the awards and confirm the results handoff.'}</p>
  {busy||error?<RewardActionProgress paused={error&&!busy} messageRole={error&&!busy?'alert':'status'} label={hr?'Napredak pripreme':'Preparation progress'} labels={hr?['Provjera','Priprema','Potvrđeno']:['Checking','Preparing','Confirmed']} stage={pending.current?1:0} message={error?(hr?'Priprema nije potvrđena. Ponovite istu pripremu ili učitajte trenutačno stanje.':'Preparation could not be confirmed. Retry the same preparation or reload the current state.'):pending.current?.kind==='handoff'?(hr?'Potvrđivanje predaje službenih rezultata. Pričekajte odgovor poslužitelja.':'Confirming the official results handoff. Wait for the server response.'):pending.current?(hr?'Provjera uplate i priprema odobrenog paketa.':'Verifying funding and preparing the approved package.'):(hr?'Provjera trenutačne pripreme i predaje.':'Checking the current package and handoff.')}/>:null}
  {error&&!busy?<>
   {pending.current?<button className={p.primary} disabled={busy} onClick={()=>void act(pending.current!.kind)}>{hr?'Ponovi istu pripremu':'Retry same preparation'}</button>:null}
   <button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload preparation'}</button></>:null}
  {view&&!busy?view.current?<>
   {view.prepared?<><p className={s.confirmed}><Check size={18} aria-hidden="true"/>{hr?'Paket nagrada je pripremljen.':'Award package prepared.'}</p><details><summary>{hr?'Dokaz paketa':'Package evidence'}</summary><p style={{overflowWrap:'anywhere'}}>{view.prepared.packageHash}</p></details></>:<button className={p.primary} disabled={busy} onClick={()=>void act('upload')}>{hr?'Provjeri uplatu i pripremi paket':'Verify funding and prepare package'}</button>}
   {handoff?.current?handoff.publication?<><p>{hr?'Pregled rezultata je dovršen. Odobrene nagrade spremne su za objavu na ugovoru.':'Results review complete. Approved awards are ready for contract publication.'}</p><HostedReviewPublication id={id} slot={slot} approvalId={approvalId} documentHash={documentHash} hr={hr}/>{view.protocolVersion===5?<p>{hr?'Nakon otvaranja preuzimanja primatelji sami preuzimaju nagrade. Novčanik mogu postaviti kasnije.':'Once claims open, recipients claim their awards themselves. They can set up a wallet later.'}</p>:<><HostedClaimReviews approvalId={approvalId} hr={hr}/><HostedClubClaimReviews approvalId={approvalId} hr={hr}/></>}</>:<button className={p.primary} disabled={busy} onClick={()=>void act('handoff')}>{hr?'Potvrdi predaju rezultata':'Confirm results handoff'}</button>:null}
   {!handoff?.publication?<p>{hr?'Potvrdite predaju rezultata kako biste dovršili pregled.':'Confirm the results handoff to finish this review.'}</p>:null}
  </>:<p>{hr?'Ova odluka više nije važeća. Učitajte trenutačni pregled.':'This award decision is no longer current. Reload the review.'}</p>:null}
 </section>;
}
