import {LockKeyhole,LockKeyholeOpen} from "lucide-react";
import type {RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
import {categoryAllocationLimit} from "../model/sponsorCategoryAllocation";
import {sponsorColors} from "../model/sponsorCatalogue";
import s from "./SponsorCategoryAllocation.module.css";

export default function SponsorCategoryAllocation({nodes,selected,disabled,readOnly=false,inspectionDisabled=false,hr,onSelect,onShare,onLock,onEqual}:{nodes:RewardSetupNode[];selected?:string;disabled:boolean;readOnly?:boolean;inspectionDisabled?:boolean;hr:boolean;onSelect:(id:string)=>void;onShare:(id:string,share:number)=>void;onLock:(id:string)=>void;onEqual:()=>void}){
 const t=(en:string,local:string)=>hr?local:en;
 if(readOnly)return <section className={s.panel} aria-label={t("Category distribution","Raspodjela kategorija")}><p className={s.hint}>{t("Saved shares · select a category to view its prizes.","Spremljeni udjeli · odaberite kategoriju za pregled nagrada.")}</p>{nodes.map((node,i)=><button className={s.savedShare} key={node.id} aria-label={`${t("Inspect","Pregledaj raspodjelu")} ${node.name}`} aria-pressed={selected===node.id} aria-controls="sponsor-group-editor" disabled={inspectionDisabled} onClick={()=>onSelect(node.id)}><i style={{background:sponsorColors[i%sponsorColors.length]}}/><span>{node.name}</span><strong>{node.shareBps/100}%</strong></button>)}</section>;
 if(nodes.length===1&&nodes[0].shareBps===10000)return <section className={`${s.panel} ${s.single}`} aria-label={t("Category distribution","Raspodjela kategorija")}><button className={s.savedShare} aria-label={`${t("Edit","Uredi")} ${nodes[0].name}`} aria-pressed={selected===nodes[0].id} disabled={disabled} onClick={()=>onSelect(nodes[0].id)}><span>{nodes[0].name}</span><strong>100%</strong></button><button className={s.lock} aria-label={`${nodes[0].locked?t("Unlock","Otključaj"):t("Lock","Zaključaj")} ${nodes[0].name}`} aria-pressed={nodes[0].locked} disabled={disabled} onClick={()=>onLock(nodes[0].id)}>{nodes[0].locked?<LockKeyhole size={17}/>:<LockKeyholeOpen size={17}/>}</button><p className={s.hint}>{t("Include another category to adjust the split.","Uključite još jednu kategoriju za prilagodbu raspodjele.")}</p></section>;
 if(!nodes.length)return <p className={s.hint}>{t("Add a category to distribute this pot.","Dodajte kategoriju za raspodjelu fonda.")}</p>;
 return <section className={s.panel} aria-label={t("Category distribution","Raspodjela kategorija")}>
  <p className={s.hint}>{t("Total stays at 100%. Lock shares to keep them fixed.","Ukupno ostaje 100%. Zaključajte udjele koje želite zadržati.")}</p>
  {nodes.map((node,i)=>{
   const max=categoryAllocationLimit(nodes,node.id),fixed=node.locked||nodes.filter(n=>!n.locked).length<2;
   return <div className={s.row} data-active={selected===node.id} data-locked={node.locked} key={node.id}>
    <button className={s.name} aria-label={`${t("Edit","Uredi")} ${node.name}`} aria-pressed={selected===node.id} disabled={disabled} onClick={()=>onSelect(node.id)}><i style={{background:sponsorColors[i%sponsorColors.length]}}/>{node.name}</button>
    <button className={s.lock} aria-label={`${node.locked?t("Unlock","Otključaj"):t("Lock","Zaključaj")} ${node.name}`} aria-pressed={node.locked} title={node.locked?t("Unlock share","Otključaj udio"):t("Lock share","Zaključaj udio")} disabled={disabled} onClick={()=>onLock(node.id)}>{node.locked?<LockKeyhole size={17}/>:<LockKeyholeOpen size={17}/>}</button>
    <input className={s.slider} type="range" min="0" max={max} step="1" value={node.shareBps} aria-label={`${node.name} ${t("distribution slider","klizač raspodjele")}`} aria-valuetext={`${node.shareBps/100}%`} disabled={disabled||fixed} onChange={e=>onShare(node.id,Number(e.target.value))}/>
    <label className={s.percent}><input type="number" min="0" max={max/100} step="0.01" aria-label={`${node.name} ${t("distribution percentage","postotak raspodjele")}`} value={node.shareBps/100} disabled={disabled||fixed} onChange={e=>{if(e.target.value!==""&&Number.isFinite(e.target.valueAsNumber))onShare(node.id,e.target.valueAsNumber*100);}}/><span>%</span></label>
   </div>;
  })}
  {nodes.filter(n=>!n.locked).length<2?<p className={s.hint}>{nodes.length===1?t("Add another category to adjust the split.","Dodajte još jednu kategoriju za prilagodbu raspodjele."):t("Unlock another category to adjust the split.","Otključajte još jednu kategoriju za prilagodbu raspodjele.")}</p>:null}
  {nodes.length>1?<button className={s.equal} disabled={disabled||nodes.filter(n=>!n.locked).length<2} onClick={onEqual}>{nodes.some(n=>n.locked)?t("Split unlocked equally","Jednako podijeli otključane"):t("Split equally","Podijeli jednako")}</button>:null}
 </section>;
}
