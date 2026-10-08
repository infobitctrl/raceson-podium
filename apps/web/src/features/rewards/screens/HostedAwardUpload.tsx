import HostedClubClaimReviews from './HostedClubClaimReviews';
import HostedReviewPublication from './HostedReviewPublication';
import HostedClaimReviews from './HostedClaimReviews';
import {useCallback,useEffect,useRef,useState} from 'react';
import {readHostedAwardUpload,readHostedAwardHandoff,type HostedUploadScope} from '../data/hostedAwardUpload';
import p from '../components/Podium.module.css';
import s from './HostedReviewWorkspace.module.css';
import RewardActionProgress from '../components/RewardActionProgress';
import ReviewJourney from './ReviewJourney';
import {Check} from 'lucide-react';
type Upload=Awaited<ReturnType<typeof readHostedAwardUpload>>;
type Handoff=Awaited<ReturnType<typeof readHostedAwardHandoff>>;
export default function HostedAwardUpload({id,slot,approvalId,contextHash,documentHash,hr,autoStart=false}:HostedUploadScope&{contextHash:string;documentHash:string;hr:boolean;autoStart?:boolean}){
 const [view,setView]=useState<Upload|null>(null),[handoff,setHandoff]=useState<Handoff|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0);
 const [continuing,setContinuing]=useState(autoStart),flight=useRef(false);
 const scopeKey=`${id}:${slot}:${approvalId}:${contextHash}:${documentHash}`,intentScope=useRef(scopeKey);
 const epoch=useRef(0),pending=useRef<{kind:'upload'|'handoff';requestId:string;documentHash:string}|null>(null);
 useEffect(()=>{const generation=++epoch.current;setBusy(true);setError(false);setView(null);setHandoff(null);pending.current=null;flight.current=false;if(intentScope.current!==scopeKey)setContinuing(false);
  void (async()=>{const scope={id,slot,approvalId},v=await readHostedAwardUpload(scope);
   if(v.contextHash!==contextHash||v.documentHash!==documentHash)throw Error('reward_planning_revision_changed');
   if(generation!==epoch.current)return;
   const h=v.current&&v.prepared?await readHostedAwardHandoff(scope):null;
   if(generation===epoch.current){setView(v);setHandoff(h);}
  })().catch(()=>{if(generation===epoch.current){setError(true);setContinuing(false);}}).finally(()=>{if(generation===epoch.current)setBusy(false);});
  return()=>{epoch.current=generation+1;};},[id,slot,approvalId,contextHash,documentHash,reload,scopeKey]);
 const act=useCallback(async(kind:'upload'|'handoff')=>{
  if(flight.current)return;
  const generation=epoch.current,scope={id,slot,approvalId};
  if(!pending.current){if(!view?.current||kind==='handoff'&&!handoff?.current)return;pending.current={kind,requestId:crypto.randomUUID(),documentHash:kind==='upload'?documentHash:handoff!.publicationHash};}
  const command=pending.current;flight.current=true;setBusy(true);setError(false);
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
  }catch{if(generation===epoch.current){setError(true);setContinuing(false);setView(null);setHandoff(null);}}
  finally{if(generation===epoch.current){flight.current=false;setBusy(false);}}
 },[id,slot,approvalId,contextHash,documentHash,view,handoff]);
 useEffect(()=>{
  if(!continuing||intentScope.current!==scopeKey||busy||error||!view?.current)return;
  if(!view.prepared)void act('upload');
  else if(handoff?.current&&!handoff.publication)void act('handoff');
 },[continuing,scopeKey,busy,error,view,handoff,act]);
 return <section className={p.panel} aria-label={hr?'Priprema i objava nagrada':'Award preparation and publication'}>{!(handoff?.current&&handoff.publication)?<><ReviewJourney stage={1} hr={hr}/><h3>{hr?'Pripremi nagrade':'Prepare awards'}</h3></>:null}
  {busy||error?<RewardActionProgress paused={error&&!busy} messageRole={error&&!busy?'alert':'status'} label={hr?'Napredak pripreme':'Preparation progress'} labels={hr?['Provjera','Priprema','Potvrđeno']:['Checking','Preparing','Confirmed']} stage={pending.current?1:0} message={error?(hr?'Priprema nije potvrđena. Ponovite istu pripremu ili učitajte trenutačno stanje.':'Preparation could not be confirmed. Retry the same preparation or reload the current state.'):pending.current?.kind==='handoff'?(hr?'Potvrđivanje predaje službenih rezultata. Pričekajte odgovor poslužitelja.':'Confirming the official results handoff. Wait for the server response.'):pending.current?(hr?'Provjera uplate i priprema odobrenog paketa.':'Verifying funding and preparing the approved package.'):(hr?'Provjera trenutačne pripreme i predaje.':'Checking the current package and handoff.')}/>:null}
  {error&&!busy?<>
   {pending.current?<button className={p.primary} disabled={busy} onClick={()=>{setContinuing(true);void act(pending.current!.kind);}}>{hr?'Ponovi istu pripremu':'Retry same preparation'}</button>:null}
   <button className={p.secondary} disabled={busy} onClick={()=>{setContinuing(false);setReload(n=>n+1);}}>{hr?'Učitaj ponovno':'Reload preparation'}</button></>:null}
  {view&&!busy?view.current&&handoff?.current!==false?<>
   {!(handoff?.current&&handoff.publication)?<>
    {view.prepared?<p className={s.confirmed}><Check size={18} aria-hidden="true"/>{hr?'Paket nagrada je pripremljen.':'Award package prepared.'}</p>:null}
    <p>{hr?'Nastavite spremljeno odobrenje kroz objavu. Nije potrebno ponovno odobravati rezultate.':'Continue the saved approval through publication. The results do not need another approval.'}</p>
    {!continuing?<button className={p.primary} onClick={()=>{intentScope.current=scopeKey;setContinuing(true);}}>{hr?'Nastavi odobrenu objavu':'Resume approved publication'}</button>:null}
   </>:<><HostedReviewPublication id={id} slot={slot} approvalId={approvalId} documentHash={documentHash} hr={hr} autoStart={continuing}/>{[5,6].includes(view.protocolVersion??4)?null:<><HostedClaimReviews approvalId={approvalId} hr={hr}/><HostedClubClaimReviews approvalId={approvalId} hr={hr}/></>}</>}

   {view.prepared?<details><summary>{hr?'Detalji pripreme':'Preparation details'}</summary><p className={s.confirmed}><Check size={16} aria-hidden="true"/>{hr?'Uplata provjerena · Nagrade pripremljene':'Funding verified · Awards prepared'}</p><p style={{overflowWrap:'anywhere'}}>{view.prepared.packageHash}</p></details>:null}
  </>:<p>{hr?'Ova odluka više nije važeća. Učitajte trenutačni pregled.':'This award decision is no longer current. Reload the review.'}</p>:null}
 </section>;
}
