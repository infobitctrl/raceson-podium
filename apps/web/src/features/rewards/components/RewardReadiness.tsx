import {Check, Circle, Clock3} from 'lucide-react';
import type {ReactNode} from 'react';
import s from './RewardRoleWorkspace.module.css';

export type ReadinessStep={id:string;title:string;detail:ReactNode;state:'complete'|'current'|'waiting'};
export default function RewardReadiness({steps,label}:{steps:ReadinessStep[];label:string}){
 return <ol className={s.readiness} aria-label={label}>{steps.map(step=><li key={step.id} data-state={step.state} aria-current={step.state==='current'?'step':undefined}>
  <span className={s.marker} aria-hidden="true">{step.state==='complete'?<Check size={17}/>:step.state==='current'?<Clock3 size={17}/>:<Circle size={17}/>}</span>
  <div><strong>{step.title}</strong><p>{step.detail}</p></div>
 </li>)}</ol>;
}
