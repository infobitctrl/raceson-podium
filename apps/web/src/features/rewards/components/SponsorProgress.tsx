import {Link,useNavigate} from "react-router-dom";
import s from "./SponsorProgress.module.css";

type Props={current:number;hr:boolean;disabled?:boolean;onStep?:(step:number)=>void;setupId?:string;readOnly?:boolean;league?:boolean};
/** Editor navigation only. Saving and transaction completion have their own evidence. */
export default function SponsorProgress({current,hr,disabled=false,onStep,setupId,readOnly=false,league=false}:Props) {
 const labels=league?(hr?["Fond i povrat","Nagrade lige","Nagrade kola","Pregled","Izrada i uplata"]:["Budget & returns","League rewards","Round rewards","Review","Create & fund"]):hr?["Fond i povrat","Kategorije nagrada","Pregled","Izrada i uplata"]:["Budget & returns","Reward categories","Review","Create & fund"];
 const routes=league?[1,4,3,5]:[1,4,5],active=Math.min(current,routes.length),navigate=useNavigate();
 return <nav id="setup-workflow" aria-label={hr?"Odjeljci kampanje":"Campaign sections"} className={s.progress}>
  <label className={s.mobileSummary}>{readOnly?(hr?"Pregled spremljenih pravila":"Viewing saved rules"):`${hr?"Korak":"Step"} ${active+1} ${hr?"od":"of"} ${labels.length}`}<select aria-label={hr?"Otvori odjeljak postavki":"Go to setup section"} value={active} disabled={disabled} onChange={e=>{const i=Number(e.target.value);if(i<routes.length){if(onStep)onStep(routes[i]);else if(setupId)navigate(`/rewards/create?setup=${setupId}&step=${routes[i]}`);}}}>{labels.map((label,i)=><option value={i} key={label} disabled={i===routes.length}>{label}</option>)}</select></label>
  <ol style={{gridTemplateColumns:`repeat(${labels.length}, minmax(0, 1fr))`}}>{labels.map((label,i)=><li key={label} aria-current={i===active?"step":undefined}>
   {i<routes.length&&onStep?<button aria-label={label} disabled={disabled} onClick={()=>onStep(routes[i])} aria-current={i===active?"step":undefined}><span aria-hidden="true">{i+1}</span>{label}</button>:i<routes.length&&setupId?<Link to={`/rewards/create?setup=${setupId}&step=${routes[i]}`}><span aria-hidden="true">{i+1}</span>{label}</Link>:<div><span aria-hidden="true">{i+1}</span>{label}</div>}
  </li>)}</ol>
 </nav>;
}
