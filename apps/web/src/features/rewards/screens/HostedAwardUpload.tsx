import HostedClubClaimReviews from './HostedClubClaimReviews';
import HostedClaimReviews from './HostedClaimReviews';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {rewardsControlLink} from '../model/controllerLinks';
import {readHostedAwardUpload,readHostedAwardHandoff,type HostedUploadScope} from '../data/hostedAwardUpload';
import p from '../components/Podium.module.css';
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
 return <section className={p.panel} aria-label={hr?'Predaja kontroloru':'Controller handoff'}><h3>{hr?'Pripremi odobrene nagrade':'Prepare approved awards'}</h3>
  <p>{hr?'Priprema provjerava potvrđenu uplatu i stanje ugovora. Kontrolor zatim zasebno učitava i aktivira nagrade.':'Preparation checks confirmed funding and contract state. The controller then uploads and activates awards separately.'}</p>
  {busy?<p role="status">{hr?'Provjera…':'Checking…'}</p>:null}
  {error?<><p role="alert">{hr?'Priprema nije potvrđena. Provjerite uplatu i trenutačnu odluku.':'Preparation could not be confirmed. Check funding and the current award decision.'}</p>
   {pending.current?<button className={p.primary} disabled={busy} onClick={()=>void act(pending.current!.kind)}>{hr?'Ponovi istu pripremu':'Retry same preparation'}</button>:null}
   <button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload preparation'}</button></>:null}
  {view?view.current?<>
   {view.prepared?<><p>{hr?'Paket je pripremljen za kontrolora.':'Package prepared for the controller.'}</p><details><summary>{hr?'Dokaz paketa':'Package evidence'}</summary><p style={{overflowWrap:'anywhere'}}>{view.prepared.packageHash}</p></details></>:<button className={p.primary} disabled={busy} onClick={()=>void act('upload')}>{hr?'Provjeri uplatu i pripremi paket':'Verify funding and prepare package'}</button>}
   {handoff?.current?handoff.publication?<><p>{hr?'Predaja rezultata je potvrđena. Nastavite u prostoru kontrolora.':'Results handoff confirmed. Continue in the controller workspace.'}</p><Link className={p.secondary} href={rewardsControlLink(id,slot)}>{hr?'Otvori kontrolora':'Open controller workspace'}</Link><HostedClaimReviews approvalId={approvalId} hr={hr}/><HostedClubClaimReviews approvalId={approvalId} hr={hr}/></>:<button className={p.primary} disabled={busy} onClick={()=>void act('handoff')}>{hr?'Potvrdi predaju rezultata':'Confirm results handoff'}</button>:null}
  </>:<p>{hr?'Ova odluka više nije važeća. Učitajte trenutačni pregled.':'This award decision is no longer current. Reload the review.'}</p>:null}
 </section>;
}
