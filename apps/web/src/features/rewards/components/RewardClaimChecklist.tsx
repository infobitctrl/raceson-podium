import {Check, CircleAlert} from 'lucide-react';
import {useI18n} from '@/shared/i18n/I18nContext';
import s from './RewardClaimChecklist.module.css';
export type ClaimStep = {title:string;detail:string;state:'complete'|'current'|'waiting'|'unverified'};
/** Presentation only: callers supply facts from the exact reviewed award. */
export default function RewardClaimChecklist({steps}:{steps:readonly ClaimStep[]}){
 const {locale}=useI18n(),hr=locale==='hr';
 const labels={complete:hr?'Potvrđeno':'Confirmed',current:hr?'Sljedeći korak':'Next step',waiting:hr?'Na čekanju':'Waiting',unverified:hr?'Nije provjereno':'Not verified'};
 return <section role="group" className={s.checklist} aria-label={hr?'Koraci preuzimanja nagrade':'Reward claim steps'}>
  <h4>{hr?'Status preuzimanja':'Claim progress'}</h4>
  <ol>{steps.map((step,index)=><li key={step.title} data-state={step.state} aria-current={step.state==='current'?'step':undefined}>
   <span className={s.marker} aria-hidden="true">{step.state==='complete'?<Check size={16}/>:step.state==='unverified'?<CircleAlert size={16}/>:index+1}</span>
   <div><div className={s.heading}><strong>{step.title}</strong><span>{labels[step.state]}</span></div>{step.state==='current'||step.state==='unverified'?<p>{step.detail}</p>:<details><summary>{hr?'Detalji':'Details'}</summary><p>{step.detail}</p></details>}</div>
  </li>)}</ol>
 </section>;
}
