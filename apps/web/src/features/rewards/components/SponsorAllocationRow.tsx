import {useId,useState} from 'react';
import {sponsorAmountShare,sponsorBudgetAmount} from '../model/sponsorBudget';
import s from './SponsorExact.module.css';

type Props={name:string;shareBps:number;amountWei:bigint|null;budgetMon:string;maxShareBps?:number;disabled:boolean;hr:boolean;onShare:(bps:number)=>void;onToggle:(checked:boolean)=>void};

/** All three editors change the same saved basis-point share. Amount text is transient. */
export default function SponsorAllocationRow({name,shareBps,amountWei,budgetMon,maxShareBps=10000,disabled,hr,onShare,onToggle}:Props){
 const errorId=useId(),t=(en:string,local:string)=>hr?local:en;
 const [draft,setDraft]=useState<{text:string;budget:string;shareBps:number;invalid:boolean}|null>(null);
 const [percentDraft,setPercentDraft]=useState<{text:string;shareBps:number}|null>(null);
 const activeDraft=draft?.budget===budgetMon&&draft.shareBps===shareBps?draft:null;
 const activePercent=percentDraft?.shareBps===shareBps?percentDraft:null;
 const changeShare=(bps:number)=>{setDraft(null);setPercentDraft(null);onShare(bps);};
 const editAmount=(text:string)=>{
  try{
   const bps=sponsorAmountShare(text,budgetMon);
   if(bps>maxShareBps)throw Error('amount_exceeds_available_share');
   setDraft({text,budget:budgetMon,shareBps:bps,invalid:false});onShare(bps);
  }catch{setDraft({text,budget:budgetMon,shareBps,invalid:text!==''});}
 };
 return <div className={s.allocationRow}>
  <label className={s.allocationName}><input type="checkbox" checked={shareBps>0} disabled={disabled} onChange={e=>{setDraft(null);onToggle(e.target.checked);}}/>{name}</label>
  <label className={s.allocationPercent}><input type="number" aria-label={`${name} %`} min="0" max={maxShareBps/100} step="0.01" value={activePercent?.text??shareBps/100} disabled={disabled} onChange={e=>{setDraft(null);const valid=e.target.value!==''&&e.target.validity.valid,bps=valid?Math.round(Number(e.target.value)*100):shareBps;setPercentDraft({text:e.target.value,shareBps:bps});if(valid)onShare(bps);}} onBlur={()=>setPercentDraft(null)}/>%</label>
  <label className={s.allocationAmount}><input type="text" inputMode="decimal" aria-label={`${name} · test MON`} aria-invalid={activeDraft?.invalid||undefined} aria-describedby={activeDraft?.invalid?errorId:undefined} value={activeDraft?.text??sponsorBudgetAmount(amountWei)} placeholder="0" disabled={disabled||amountWei===null} onChange={e=>editAmount(e.target.value)} onBlur={()=>setDraft(null)}/><span>test MON</span></label>
  <input className={s.allocationSlider} type="range" aria-label={t(`${name} prize share`,`${name} udio nagrade`)} aria-valuetext={`${shareBps/100}%`} min="0" max={maxShareBps} step="1" value={shareBps} disabled={disabled} onChange={e=>changeShare(Number(e.target.value))}/>
  {activeDraft?.invalid?<p id={errorId} className={s.allocationError} role="alert">{t('Enter a valid test MON amount within the available share.','Unesite valjan iznos test MON unutar raspoloživog udjela.')}</p>:null}
 </div>;
}
