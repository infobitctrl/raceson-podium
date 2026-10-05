import {useEffect,useRef,useState} from 'react';
import {formatUnits} from 'viem';
import {readHostedAwardReview,type HostedAwardDecision} from '../data/hostedAwardReview';
import HostedAwardUpload from './HostedAwardUpload';
import p from '../components/Podium.module.css';
type View=Awaited<ReturnType<typeof readHostedAwardReview>>;
function SlotReview({id,slot,hr}:{id:string;slot:number;hr:boolean}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0);
 const pending=useRef<HostedAwardDecision|null>(null),generation=useRef(0);
 useEffect(()=>{const epoch=++generation.current;setBusy(true);setError(false);setView(null);pending.current=null;
  void readHostedAwardReview(id,slot).then(v=>{if(epoch===generation.current)setView(v);}).catch(()=>{if(epoch===generation.current)setError(true);}).finally(()=>{if(epoch===generation.current)setBusy(false);});
  return()=>{generation.current=epoch+1;};},[id,slot,reload]);
 async function save(decision:'approved'|'held'){
  const epoch=generation.current;
  if(!pending.current){if(!view||!('contextHash' in view))return;pending.current={requestId:crypto.randomUUID(),expectedApprovalId:view.approval?.id??null,
   contextHash:view.contextHash,documentHash:view.documentHash,decision};}
  const command=pending.current;setBusy(true);setError(false);
  try{const next=await readHostedAwardReview(id,slot,command);if(epoch!==generation.current)return;pending.current=null;setView(next);}
  catch{if(epoch===generation.current){setError(true);setView(null);}}
  finally{if(epoch===generation.current)setBusy(false);}
 }
 return <section className={p.panel} aria-label={hr?'Odobrenje nagrada':'Award approval'}>
  <h3>{hr?'Odobrenje točnih nagrada':'Approve exact awards'}</h3>
  <p>{hr?'Odobrenje potvrđuje nagrade. Uplata, pristanak primatelja i isplata zahtijevaju zasebne korake.':'Approval records the awards. Funding, recipient consent and payment require separate steps.'}</p>
  {busy?<p role="status">{hr?'Provjera…':'Checking…'}</p>:null}
  {error?<><p role="alert">{hr?'Odluka nije potvrđena. Ponovite istu odluku ili učitajte trenutačno stanje.':'The decision could not be confirmed. Retry the same decision or reload the current state.'}</p>
   {pending.current?<button className={p.primary} disabled={busy} onClick={()=>void save(pending.current!.decision)}>{hr?'Ponovi istu odluku':'Retry same decision'}</button>:null}
   <button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload review'}</button></>:null}
  {view?<>
   {view.approval?<p>{hr?'Posljednja odluka':'Latest decision'}: <strong>{view.approval.decision==='approved'?(hr?'Odobreno':'Approved'):(hr?'Zadržano':'Held')}</strong> · {view.approval.current?(hr?'važeća':'current'):(hr?'zastarjela':'stale')}</p>:null}
   {!('contextHash' in view)?<p>{hr?'Prethodna odluka je potvrđena. Učitajte trenutačni pregled prije nastavka.':'The earlier decision is confirmed. Reload the current review before continuing.'}<button className={p.secondary} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload review'}</button></p>:<>
    <p>{hr?'Predložene nagrade':'Proposed awards'}: <strong>{formatUnits(BigInt(view.proposedWei),18)} test MON</strong><br/>{hr?'Zadržano u ugovoru':'Retained in contract'}: {formatUnits(BigInt(view.retainedWei),18)} test MON</p>
    <p>{view.recipientCounts.athletes} {hr?'sportaša':'athletes'} · {view.recipientCounts.clubs} {hr?'klubova':'clubs'}</p>
    {view.reasons.length?<p>{hr?'Razlozi zadržavanja':'Hold reasons'}: {view.reasons.join(', ')}</p>:null}
    <details><summary>{hr?'Dokaz verzije':'Version evidence'}</summary><p style={{overflowWrap:'anywhere'}}>{view.documentHash}</p></details>
    <button className={p.primary} disabled={busy||view.reasons.length>0||view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash} onClick={()=>void save('approved')}>{hr?'Odobri točne nagrade':'Approve exact awards'}</button>{' '}
    <button className={p.secondary} disabled={busy||view.approval?.current&&view.approval.decision==='held'&&view.approval.documentHash===view.documentHash} onClick={()=>void save('held')}>{hr?'Zadrži nagrade':'Hold awards'}</button>
   {view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash?<HostedAwardUpload key={view.approval.id} id={id} slot={slot} approvalId={view.approval.id} contextHash={view.contextHash} documentHash={view.documentHash} hr={hr}/>:null}
   </>}
  </>:null}
 </section>;
}
export default function HostedAwardReview({id,hr}:{id:string;hr:boolean}){
 const [slot,setSlot]=useState(0);
 return <><label>{hr?'Nagradni fond':'Prize pool'} <select value={slot} onChange={e=>setSlot(Number(e.target.value))}>
  {Array.from({length:6},(_,i)=><option key={i} value={i}>{i===0?(hr?'Liga':'League'):`${hr?'Kolo':'Round'} ${i}`}</option>)}</select></label><SlotReview key={`${id}:${slot}`} id={id} slot={slot} hr={hr}/></>;
}
