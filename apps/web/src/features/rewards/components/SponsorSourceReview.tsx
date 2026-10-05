import {useEffect,useRef,useState} from 'react';
import {loadHistoricalReviewContext,requestHistoricalSourceV3,type HistoricalReviewContextV3,type HistoricalReviewRequestV3} from '../data/historicalSourceV3';
import s from './RewardResultsTable.module.css';
type Review=Awaited<ReturnType<typeof requestHistoricalSourceV3>>;
/** This is an explicit source decision only. Award approval remains a separate
 * action against the refreshed V4 calculation. Uncertain writes retry exactly. */
export default function SponsorSourceReview({draftId,slot,onReviewed,expectedContextHash,hr=false}:{draftId:string;slot:number;onReviewed:()=>void;hr?:boolean;expectedContextHash?:string}){
 const [context,setContext]=useState<HistoricalReviewContextV3|null>(null),[review,setReview]=useState<Review|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(true),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const pending=useRef<HistoricalReviewRequestV3|null>(null),live=useRef(false),flight=useRef(false),t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{let active=true;live.current=true;setBusy(true);setFailed(false);setContext(null);setReview(null);setConfirmed(false);pending.current=null;
  void (async()=>{const c=await loadHistoricalReviewContext(draftId,slot);const r=await requestHistoricalSourceV3(c);if(!expectedContextHash||r.contextHash!==expectedContextHash)throw Error('source_changed');if(active){setContext(c);setReview(r);}})().catch(()=>{if(active)setFailed(true);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;live.current=false;};
 },[draftId,slot,attempt,expectedContextHash]);
 async function confirm(){if(flight.current||!context||!review||!confirmed&&!pending.current)return;
  flight.current=true;setBusy(true);setFailed(false);
  const request=pending.current??{slot,requestId:crypto.randomUUID(),expectedReviewId:review.decisions.find(d=>d.slot===slot)?.id??null,contextHash:review.contextHash,decision:'confirmed_final' as const};pending.current=request;
  try{await requestHistoricalSourceV3(context,request);if(live.current){pending.current=null;setConfirmed(false);onReviewed();}}
  catch{if(live.current)setFailed(true);}finally{flight.current=false;if(live.current)setBusy(false);}
 }
 const decision=review?.decisions.find(d=>d.slot===slot),evidence=review?.source.rounds[slot-1]?.evidence;
 return <section className={s.confirm} aria-label={t('Confirm official results','Potvrdi službene rezultate')}>
  {busy&&!review?<p role="status">{t('Loading official source evidence…','Učitavanje službenog izvora…')}</p>:null}
  {failed?<div role="alert"><p>{t(pending.current?'The confirmation response was interrupted. Retry the same confirmation.':'Source review could not be verified against this list. Refresh the results and check your results-team access.',pending.current?'Odgovor je prekinut. Ponovite istu potvrdu.':'Pregled izvora nije dostupan. Provjerite pristup i pokušajte ponovno.')}</p>{!pending.current?<button disabled={busy} onClick={()=>setAttempt(v=>v+1)}>{t('Retry source review','Ponovi pregled izvora')}</button>:null}</div>:null}
  {review&&context?<><p>{t(!decision?'The published results are ready for your source review.':!decision.current?'The source changed since its last review. Check the current results before confirming.':decision.decision==='held'?'This source is on hold. Confirm only after the issue has been resolved.':'The current official source is confirmed.',!decision?'Objavljeni rezultati spremni su za pregled.':!decision.current?'Izvor se promijenio. Pregledajte aktualne rezultate.':decision.decision==='held'?'Izvor je zaustavljen. Potvrdite tek nakon rješavanja problema.':'Službeni izvor je potvrđen.')}</p>
  <label><input type="checkbox" checked={confirmed} disabled={busy||!!pending.current} onChange={e=>setConfirmed(e.target.checked)}/>{t('I have reviewed these official results and the complaint process is complete.','Pregledao/la sam ove službene rezultate i postupak prigovora je završen.')}</label>
  <div className={s.actions}><button disabled={busy||!evidence||!confirmed&&!pending.current} onClick={()=>void confirm()}>{busy?t('Confirming…','Potvrđivanje…'):pending.current?t('Retry same confirmation','Ponovi istu potvrdu'):t('Confirm official results','Potvrdi službene rezultate')}</button><p>{t('This confirms the source. Review and approve the rewards next.','Ovime potvrđujete izvor. Zatim pregledajte i odobrite nagrade.')}</p></div>
  <details className={s.technical}><summary>{t('Technical details & publication evidence','Tehnički podaci i službena objava')}</summary><p>{context.workspace.catalogue.rounds.find(r=>r.slot===slot)?.races.map(r=>`${r.name} · ${r.publicationState??'unpublished'}`).join(' / ')}</p><p>{evidence?.publishedAt?new Date(evidence.publishedAt).toLocaleString(hr?'hr':'en'):''}</p><p>{review.contextHash}</p></details></>:null}
 </section>;
}
