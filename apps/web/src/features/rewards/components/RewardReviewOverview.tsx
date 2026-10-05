import {useState} from 'react';
import type {ResultDisplay} from '../data/resultDisplay';
import {resultDistributionChart} from '../model/resultDistributionChart';
import {setupAmount} from '../model/setupAmount';
import RewardSetupChart from './RewardSetupChart';
import s from './RewardReviewWorkspace.module.css';

export default function RewardReviewOverview({data,budgetWei,hr=false}:{data:ResultDisplay;budgetWei:string;hr?:boolean}){
 const graph=resultDistributionChart(data,budgetWei),[selection,setSelection]=useState({id:'review-pot',rank:null as number|null});
 if(!graph)return null;
 const selected=graph.root.children.some(n=>n.id===selection.id)?selection:{id:graph.root.id,rank:null};
 const group=data.distribution?.find(g=>g.id===selected.id),t=(en:string,local:string)=>hr?local:en;
 return <section className={s.overview} aria-label={t('Reward distribution overview','Pregled raspodjele nagrada')}>
  <div className={s.overviewHeading}><span className={s.eyebrow}>{t('Distribution overview','Pregled raspodjele')}</span><span className={s.badge}>{data.blocked?t('Awaiting source review','Čeka pregled izvora'):data.estimated?t('Estimate · review required','Procjena · potreban pregled'):t('Review amounts','Iznosi za pregled')}</span></div>
  <div className={s.chart}><RewardSetupChart root={graph.root} rows={graph.rows} selected={selected.id} selectedRank={selected.rank} onSelect={(id,rank=null)=>setSelection({id,rank})} hr={hr} readOnly initialShowPrizes={false} inspectorId="reward-review-inspector"/></div>
  <div id="reward-review-inspector" className={s.inspector} aria-live="polite"><strong>{group?.name??t('Whole prize pot','Cijeli fond nagrada')}</strong><dl>
   <div><dt>{t('Budget','Fond')}</dt><dd>{setupAmount(BigInt(group?.budgetWei??budgetWei),hr)} test MON</dd></div>
   <div><dt>{data.estimated?t('Estimated awards','Procijenjene nagrade'):t('Allocated awards','Raspoređene nagrade')}</dt><dd>{data.blocked||group?.held?t('Pending review','Čeka pregled'):`${setupAmount(BigInt(group?.allocatedWei??data.allocatedWei),hr)} test MON`}</dd></div>
   <div><dt>{t('Reserved remainder','Rezervirani ostatak')}</dt><dd>{setupAmount(BigInt(group?.retainedWei??data.retainedWei),hr)} test MON</dd></div>
   {group&&selected.rank!==null?<div><dt>{t(`Rank ${selected.rank} · award pool`,`Mjesto ${selected.rank} · zbroj nagrada`)}</dt><dd>{setupAmount(BigInt(group.prizes.find(p=>p.rank===selected.rank)?.amountWei??'0'),hr)} test MON</dd></div>:null}
  </dl></div>
  <details className={s.note}><summary>{t('How to read this chart','Kako čitati grafikon')}</summary><p>{t('Centre: prize pot. Inner dots: reward category budgets. Outer dots: awarded amounts pooled by rank, including ties. Proportional awards have no rank dots. Percentages are rounded; amounts come from the reviewed calculation. This view does not change rules or pay rewards.','Središte: fond nagrada. Unutarnje točke: fondovi kategorija. Vanjske točke: iznosi nagrada zbrojeni po mjestu, uključujući izjednačenja. Razmjerne nagrade nemaju točke mjesta. Postotci su zaokruženi; iznosi dolaze iz pregledanog izračuna. Prikaz ne mijenja pravila niti isplaćuje nagrade.')}</p></details>
 </section>;
}
