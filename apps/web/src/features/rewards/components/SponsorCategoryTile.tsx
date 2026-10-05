import {Check,Plus,type LucideIcon} from "lucide-react";
import s from "./SponsorStudio.module.css";

export default function SponsorCategoryTile({label,name=label,icon:Icon,enabled,active,disabled,hr,onInspect,onToggle}:{label:string;name?:string;icon:LucideIcon;enabled:boolean;active:boolean;disabled:boolean;hr:boolean;onInspect:()=>void;onToggle:()=>void}){
 return <div className={`${s.category} ${s.splitCategory}`} data-selected={enabled} data-active={active}>
  <button className={s.categoryInspect} disabled={disabled} aria-label={name} aria-current={active?"true":undefined} aria-controls="sponsor-group-editor" onClick={onInspect}><Icon size={36} strokeWidth={1.35}/><span>{label}</span></button>
  <button className={s.categoryToggle} disabled={disabled} aria-label={`${hr?enabled?"Isključi":"Uključi":enabled?"Disable":"Enable"} ${name}`} aria-pressed={enabled} title={hr?enabled?"Isključi nagradu":"Uključi nagradu":enabled?"Disable reward":"Enable reward"} onClick={onToggle}><span className={s.selectionMark}>{enabled?<Check size={14}/>:<Plus size={14}/>}</span><span>{hr?enabled?"Uključeno":"Uključi":enabled?"Included":"Include"}</span></button>
 </div>;
}
