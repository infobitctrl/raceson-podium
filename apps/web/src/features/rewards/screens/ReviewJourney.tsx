import {Check,ClipboardCheck,PackageCheck,Send,Gift} from 'lucide-react';
import s from './ReviewJourney.module.css';

/** Stages are supplied by confirmed review/preparation/publication state. */
export default function ReviewJourney({stage,hr}:{stage:0|1|2|3|4;hr:boolean}){
 const labels=hr?['Pregled','Priprema','Objava',stage===4?'Preuzimanje otvoreno':'Otvori preuzimanje']:['Review','Prepare','Publish',stage===4?'Claims open':'Open claims'];
 const icons=[ClipboardCheck,PackageCheck,Send,Gift];
 return <ol className={s.journey} aria-label={hr?'Od pregleda do preuzimanja':'Review to claims progress'}>
  {labels.map((label,index)=>{const Icon=icons[index],done=index<stage;return <li key={label} data-state={done?'complete':index===stage?'current':'upcoming'} aria-current={index===stage?'step':undefined} aria-label={`${label}: ${done?(hr?'dovršeno':'complete'):index===stage?(hr?'trenutačni korak':'current step'):(hr?'slijedi':'upcoming')}`}>
   <span className={s.icon} aria-hidden="true">{done?<Check size={20}/>:<Icon size={20}/>}</span><span>{label}</span>
  </li>;})}
 </ol>;
}
