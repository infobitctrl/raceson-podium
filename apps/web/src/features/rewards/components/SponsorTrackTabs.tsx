import {Check} from 'lucide-react';
import s from './SponsorExact.module.css';

type Track={id:string;name:string;complete:boolean};
export default function SponsorTrackTabs({tracks,activeId,onSelect,panelId,hr}:{tracks:Track[];activeId:string;onSelect:(id:string)=>void;panelId:string;hr:boolean}){
 return <div className={s.trackTabs} role="tablist" aria-label={hr?'Pravila po stazi':'Rules by track'}>{tracks.map((track,i)=><button type="button" role="tab" key={track.id} id={`${panelId}-tab-${track.id}`} aria-controls={panelId} aria-selected={track.id===activeId} tabIndex={track.id===activeId?0:-1} onClick={()=>onSelect(track.id)} onKeyDown={e=>{
  const next=e.key==='ArrowRight'?(i+1)%tracks.length:e.key==='ArrowLeft'?(i+tracks.length-1)%tracks.length:e.key==='Home'?0:e.key==='End'?tracks.length-1:null;
  if(next===null)return;e.preventDefault();onSelect(tracks[next].id);e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
 }}><span>{track.name}</span>{track.complete?<><Check className={s.trackComplete} size={18} aria-hidden="true"/><span className="sr-only">{hr?' · Dovršeno':' · Complete'}</span></>:null}</button>)}</div>;
}
