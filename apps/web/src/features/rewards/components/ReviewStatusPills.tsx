import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Clock3,AlertCircle} from 'lucide-react';
import {readReviewStatus,REVIEW_STATUS_CHANGED,type ReviewStatus} from '../data/reviewStatus';
import s from './ReviewStatusPills.module.css';

export default function ReviewStatusPills({id,revision,hr}:{id:string;revision:number;hr:boolean}){
 const root=useRef<HTMLDivElement>(null),[view,setView]=useState<ReviewStatus|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true,running=false,again=false,visible=typeof IntersectionObserver==='undefined';
  setView(null);setFailed(false);
  async function refresh(){
   if(!active||!visible||document.visibilityState==='hidden')return;
   if(running){again=true;return;}running=true;
   try{const next=await readReviewStatus(id,revision);if(active){setView(next);setFailed(false);}}
   catch{if(active){setView(null);setFailed(true);}}
   finally{running=false;if(active&&again){again=false;void refresh();}}
  }
  const changed=(event:Event)=>{if((event as CustomEvent).detail===id)void refresh();};
  const focus=()=>void refresh();
  const observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)void refresh();}):null;
  if(observer&&root.current)observer.observe(root.current);else void refresh();
  const timer=window.setInterval(focus,30000);
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);window.addEventListener(REVIEW_STATUS_CHANGED,changed);
  return()=>{active=false;observer?.disconnect();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener(REVIEW_STATUS_CHANGED,changed);};
 },[id,revision]);
 const t=(en:string,local:string)=>hr?local:en;
 const funding=view?{awaiting_contract:t('Awaiting contract','Čeka ugovor'),awaiting_funding:t('Awaiting funding','Čeka uplatu'),funded:t('Funding confirmed','Uplata potvrđena'),cancelled:t('Cancelled','Otkazano'),unverified:t('Funding unverified','Uplata nije provjerena')}[view.fundingState]:null;
 const review=view?{approved:t('Awards approved','Nagrade odobrene'),partially_approved:t('Partly approved','Djelomično odobreno'),held:t('Awards on hold','Nagrade zadržane'),pending:t('Review pending','Čeka pregled')}[view.reviewState]:null;
 const claims=view?{open:t('Claims open','Preuzimanje otvoreno'),partially_open:t('Some claims open','Dio preuzimanja otvoren'),paused:t('Claims paused','Preuzimanje pauzirano'),closed:t('Claims closed','Preuzimanje zatvoreno'),not_open:t('Claims not open','Preuzimanje nije otvoreno'),unverified:t('Claims unverified','Preuzimanje nije provjereno')}[view.claimState]:null;
 return <div ref={root} className={s.pills} aria-label={t('Campaign status','Status kampanje')} aria-live="polite">
  {view?[[funding,view.fundingState==='funded'],[review,view.reviewState==='approved'],[claims,view.claimState==='open']].map(([label,done])=><span key={String(label)} data-complete={done}>{done?<CheckCircle2 size={14} aria-hidden="true"/>:<Clock3 size={14} aria-hidden="true"/>}{label}</span>):<span>{failed?<AlertCircle size={14} aria-hidden="true"/>:<Clock3 size={14} aria-hidden="true"/>}{failed?t('Status unavailable','Status nije dostupan'):t('Checking status…','Provjera statusa…')}</span>}
 </div>;
}
