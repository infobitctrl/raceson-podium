import {useState} from "react";
import {Check,Copy} from "lucide-react";
import type {RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import s from "./SponsorRaceScope.module.css";

export default function SponsorRaceScope({configuration,sourceId,disabled,hr,onApply}:{configuration:RewardDistributionSetup;sourceId:string;disabled:boolean;hr:boolean;onApply:(ids:string[])=>boolean}){
 const t=(en:string,local:string)=>hr?local:en;
 const races=configuration.root.children.filter(p=>configuration.guided!.pots.some(g=>g.nodeId===p.id&&g.slot>0));
 const [selected,setSelected]=useState(()=>races.map(r=>r.id)),[applied,setApplied]=useState("");
 const source=races.find(p=>p.id===sourceId)!,targets=races.filter(p=>p.id!==sourceId&&selected.includes(p.id));
 const signature=JSON.stringify([source,configuration.guided!.groups.filter(g=>source.children.some(n=>n.id===g.nodeId)),targets.map(p=>p.id)]);
 const distribution=(pot:typeof source)=>JSON.stringify(pot.children.map(n=>{
  const group=configuration.guided!.groups.find(g=>g.nodeId===n.id);
  return [n.name,n.shareBps,n.locked,n.rule?.basis,n.rule?.sharesBps,group?.type,group?.method,group?.minimumFinishes];
 }));
 const total=targets.length+1,done=applied===signature&&targets.every(p=>distribution(p)===distribution(source));
 return <section className={s.panel} aria-label={t("Races using this distribution","Utrke s ovom raspodjelom")}>
  <div className={s.heading}><h3>{t("Apply this distribution to","Primijeni raspodjelu na")}</h3><button disabled={disabled} onClick={()=>setSelected(races.map(r=>r.id))}>{t("Select all","Odaberi sve")}</button></div>
  <div className={s.races}>{races.map((race,i)=><label key={race.id} data-selected={race.id===sourceId||selected.includes(race.id)}><input type="checkbox" checked={race.id===sourceId||selected.includes(race.id)} disabled={disabled||race.id===sourceId} onChange={e=>setSelected(ids=>e.target.checked?[...ids,race.id]:ids.filter(id=>id!==race.id))}/><span className={s.number}>{i+1}</span><span>{race.name}{race.id===sourceId?<small>{t("Editing","Uređivanje")}</small>:null}</span></label>)}</div>
  <div className={s.action}><p>{t("Categories, percentages and prizes. Each race keeps its own pot.","Kategorije, postoci i nagrade. Svaka utrka zadržava svoj fond.")}<br/>{targets.some(p=>p.children.length)?t("Replaces the selected races’ distributions.","Zamjenjuje raspodjele odabranih utrka."):t("Apply again after editing this race.","Nakon uređivanja ponovno primijenite raspodjelu.")}</p><button className={s.apply} disabled={disabled||!source.children.length||!targets.length||done} onClick={()=>{if(onApply(targets.map(p=>p.id)))setApplied(signature);}}>{done?<Check size={17}/>:<Copy size={17}/>} {done?t("Applied","Primijenjeno"):`${t("Apply to","Primijeni na")} ${total} ${t("races","utrka")}`}</button></div>
  {done?<p role="status" className={s.success}>{t(`Distribution applied to ${total} races. Save your draft to keep it.`,`Raspodjela primijenjena na ${total} utrka. Spremite nacrt za pohranu.`)}</p>:null}
 </section>;
}
