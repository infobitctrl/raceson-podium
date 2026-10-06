import {useEffect,useRef,useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import RewardActionProgress from '../components/RewardActionProgress';
import {formatUnits} from 'viem';
import {readHostedAwardReview,type HostedAwardDecision} from '../data/hostedAwardReview';
import HostedAwardUpload from './HostedAwardUpload';
import p from '../components/Podium.module.css';
import s from './HostedReviewWorkspace.module.css';
type View=Awaited<ReturnType<typeof readHostedAwardReview>>;
function SlotReview({id,slot,hr,expected}:{id:string;slot:number;hr:boolean;expected?:{budgetWei:string;proposedWei:string}}){
 const expectedBudget=expected?.budgetWei,expectedProposed=expected?.proposedWei;
 const [acknowledged,setAcknowledged]=useState(false);
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0);
 const pending=useRef<HostedAwardDecision|null>(null),generation=useRef(0);
 useEffect(()=>{const epoch=++generation.current;setBusy(true);setError(false);setView(null);pending.current=null;setAcknowledged(false);
  void readHostedAwardReview(id,slot).then(v=>{if(expectedBudget!==undefined&&'contextHash' in v&&(v.budgetWei!==expectedBudget||v.proposedWei!==expectedProposed))throw Error('review_changed');if(epoch===generation.current)setView(v);}).catch(()=>{if(epoch===generation.current)setError(true);}).finally(()=>{if(epoch===generation.current)setBusy(false);});
  return()=>{generation.current=epoch+1;};},[id,slot,reload,expectedBudget,expectedProposed]);
 async function save(decision:'approved'|'held'){
  const epoch=generation.current;
  if(!pending.current){if(!view||!('contextHash' in view)||decision==='approved'&&!acknowledged)return;pending.current={requestId:crypto.randomUUID(),expectedApprovalId:view.approval?.id??null,
   contextHash:view.contextHash,documentHash:view.documentHash,decision};}
  const command=pending.current;setBusy(true);setError(false);
  try{const next=await readHostedAwardReview(id,slot,command);if(epoch!==generation.current)return;pending.current=null;setView(next);}
  catch{if(epoch===generation.current){setError(true);setView(null);}}
  finally{if(epoch===generation.current)setBusy(false);}
 }
 return <section className={s.decision} aria-label={hr?'Odobrenje nagrada':'Award approval'}>
  <h3>{hr?'1 · Odluka pregledavatelja':'1 · Reviewer decision'}</h3>
  {busy||error?<RewardActionProgress paused={error&&!busy} messageRole={error&&!busy?'alert':'status'} label={hr?'Napredak odluke':'Decision progress'} labels={hr?['Provjera','Spremanje','Potvrđeno']:['Checking','Saving','Confirmed']} stage={pending.current?1:0} message={error?(hr?'Odluka nije potvrđena. Ponovite istu odluku ili učitajte trenutačno stanje.':'The decision could not be confirmed. Retry the same decision or reload the current state.'):pending.current?(hr?'Spremanje točne odluke. Pričekajte potvrdu prije nastavka.':'Saving the exact decision. Wait for confirmation before continuing.'):(hr?'Provjera službenog izvora i važeće raspodjele.':'Checking the official source and current allocation.')}/>:null}
  {error&&!busy?<>
   {pending.current?<button className={p.primary} disabled={busy} onClick={()=>void save(pending.current!.decision)}>{hr?'Ponovi istu odluku':'Retry same decision'}</button>:null}
   <button className={p.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload review'}</button></>:null}
  {view&&!busy?<>
   {view.approval?.current&&view.approval.decision==='approved'&&'documentHash' in view&&view.approval.documentHash===view.documentHash?<p className={s.approved}><CheckCircle2 size={23} aria-hidden="true"/><span>{hr?'Raspodjela odobrena':'Allocation approved'} · <strong>{formatUnits(BigInt(view.proposedWei),18)} test MON</strong></span></p>:view.approval?<p>{hr?'Posljednja odluka':'Latest decision'}: <strong>{view.approval.decision==='approved'?(hr?'Odobreno':'Approved'):(hr?'Zadržano':'Held')}</strong> · {view.approval.current?(hr?'važeća':'current'):(hr?'zastarjela':'stale')}</p>:null}
   {!('contextHash' in view)?<p>{hr?'Prethodna odluka je potvrđena. Učitajte trenutačni pregled prije nastavka.':'The earlier decision is confirmed. Reload the current review before continuing.'}<button className={p.secondary} onClick={()=>setReload(n=>n+1)}>{hr?'Učitaj ponovno':'Reload review'}</button></p>:<>
    <p>{hr?'Predložene nagrade':'Proposed awards'}: <strong>{formatUnits(BigInt(view.proposedWei),18)} test MON</strong><br/>{hr?'Zadržano u ugovoru':'Retained in contract'}: {formatUnits(BigInt(view.retainedWei),18)} test MON</p>
    <p>{view.recipientCounts.athletes} {hr?'sportaša':'athletes'} · {view.recipientCounts.clubs} {hr?'klubova':'clubs'}</p>
    {view.reasons.length?<p>{hr?'Razlozi zadržavanja':'Hold reasons'}: {view.reasons.join(', ')}</p>:null}
    <details><summary>{hr?'Dokaz verzije':'Version evidence'}</summary><p style={{overflowWrap:'anywhere'}}>{view.documentHash}</p></details>
    {!(view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash)?<><label className={s.acknowledgement}><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={busy}/>{hr?'Iznosi odgovaraju službenim rezultatima.':'Totals match the official results.'}</label>
    <button className={p.primary} disabled={busy||!acknowledged||view.reasons.length>0||view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash} onClick={()=>void save('approved')}>{hr?'Odobri točne nagrade':'Approve exact awards'}</button></>:null}{' '}
    <button className={p.secondary} disabled={busy||view.approval?.current&&view.approval.decision==='held'&&view.approval.documentHash===view.documentHash} onClick={()=>void save('held')}>{hr?'Zadrži nagrade':'Hold awards'}</button>
   {view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash?<HostedAwardUpload key={view.approval.id} id={id} slot={slot} approvalId={view.approval.id} contextHash={view.contextHash} documentHash={view.documentHash} hr={hr}/>:null}
   </>}
  </>:null}
  {!(view&&'contextHash' in view&&view.approval?.current&&view.approval.decision==='approved'&&view.approval.documentHash===view.documentHash)?<div className={s.controllerStep}><h3>{hr?'2 · Kontrolor: otvaranje preuzimanja':'2 · Controller: open claims'}</h3><p>{hr?'Dostupno nakon odobrenja raspodjele i provjere uplate.':'Available after allocation approval and funding verification.'}</p></div>:null}
 </section>;
}
export default function HostedAwardReview({id,slot,hr,expected}:{id:string;slot:number;hr:boolean;expected?:{budgetWei:string;proposedWei:string}}){
 if(!Number.isInteger(slot)||slot<0||slot>5)return <p role="alert">{hr?'Odaberite sponzorirani fond.':'Select a sponsored prize pool.'}</p>;
 return <SlotReview key={`${id}:${slot}`} id={id} slot={slot} hr={hr} expected={expected}/>;
}
