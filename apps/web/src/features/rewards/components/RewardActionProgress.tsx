import type {ReactNode} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import s from './RewardActionProgress.module.css';

/** The caller advances stages only from its verified action state, never a timer. */
export default function RewardActionProgress({labels,stage,paused=false,message,children,label,messageRole='status'}:{labels:string[];stage:number;paused?:boolean;message:ReactNode;children?:ReactNode;label:string;messageRole?:'status'|'alert'}){
 return <div className={s.progress} role="group" aria-label={label} aria-busy={!paused&&stage<labels.length}>
  <ol className={s.stages}>{labels.map((title,index)=>{
   const done=index<stage,current=index===stage;
   return <li key={title} data-state={done?'complete':current?(paused?'paused':'current'):'upcoming'} aria-current={current?'step':undefined}>
    <span className={s.marker} aria-hidden="true">{done?<Check size={20}/>:current&&!paused?<LoaderCircle className={s.spinner} size={22}/>:index+1}</span><span>{title}</span>
   </li>;
  })}</ol>
  <div className={s.message} role={messageRole} aria-live={messageRole==='alert'?'assertive':'polite'}>{message}</div>
  {children?<div className={s.details}>{children}</div>:null}
 </div>;
}
