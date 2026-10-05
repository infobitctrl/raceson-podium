import {useState} from "react";
import type {RewardDistributionSetup,RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
import {isParticipationType,type GuidedRewardGroup} from "@raceson/domain/rewards/guided-setup";
import type {RewardSourceCatalogueV2} from "@raceson/domain/rewards/source-mapping-v2";
import type {SponsorCategorySettings} from "../model/applySponsorCategorySettings";
import {sponsorPrizeShares} from "../model/sponsorPrizeCurves";
import {matchesSponsorDraftCategory,sponsorDraftCategories} from "../model/sponsorDraftCategories";
import SponsorGroupEditor from "./SponsorGroupEditor";
import s from "./SponsorBulkCategories.module.css";

type Props={configuration:RewardDistributionSetup;pot:RewardSetupNode;catalogue:RewardSourceCatalogueV2|null;hr:boolean;disabled:boolean;onApply:(ids:string[],settings:SponsorCategorySettings)=>boolean;onClose:()=>void};
export default function SponsorBulkCategories(props:Props){
 const {configuration,pot,hr}=props,t=(en:string,local:string)=>hr?local:en;
 const [participation,setParticipation]=useState(false);
 const groups=configuration.guided!.groups;
 const hasParticipation=pot.children.some(n=>isParticipationType(groups.find(g=>g.nodeId===n.id)!.type));
 return <section className={s.panel} aria-label={t("Set up multiple categories","Postavi više kategorija")}>
  <div className={s.heading}><h2>{t("Set up together","Postavite zajedno")}</h2><button disabled={props.disabled} onClick={props.onClose}>{t("Individual editing","Pojedinačno uređivanje")}</button></div>
  {hasParticipation?<div className={s.tabs}><button disabled={props.disabled} aria-pressed={!participation} onClick={()=>setParticipation(false)}>{t("Standings","Poredak")}</button><button disabled={props.disabled} aria-pressed={participation} onClick={()=>setParticipation(true)}>{t("Participation","Sudjelovanje")}</button></div>:null}
  <Batch key={`${pot.id}:${participation}`} {...props} participation={participation}/>
 </section>;
}
function Batch({configuration:c,pot,catalogue,hr,disabled,onApply,participation}:Props&{participation:boolean}){
 const t=(en:string,local:string)=>hr?local:en;
 const entries=pot.children.flatMap(node=>{const group=c.guided!.groups.find(g=>g.nodeId===node.id)!;return isParticipationType(group.type)===participation?[{node,group}]:[];});
 const [selected,setSelected]=useState<string[]>(()=>entries.map(e=>e.node.id));
 const [draft,setDraft]=useState(()=>entries[0]?{node:entries[0].node,group:entries[0].group}:null);
 const [notice,setNotice]=useState("");
 const targets=entries.filter(e=>selected.includes(e.node.id)),shares=draft?.node.rule?.sharesBps??[];
 const signature=(group:GuidedRewardGroup,node:RewardSetupNode)=>JSON.stringify([group.method,group.minimumFinishes,node.rule?.sharesBps]);
 const mixed=new Set(targets.map(e=>signature(e.group,e.node))).size>1;
 const valid=draft&&(draft.group.method==="proportional"||shares.length>0&&shares.every(v=>Number.isInteger(v)&&v>=0)&&shares.reduce((a,b)=>a+b,0)===10000);
 const family=(node:RewardSetupNode)=>{
  const category=catalogue?.categories.find(cat=>cat.id===node.rule?.source?.categoryId);
  if(category)return category.competitionName;
  const categoryDraft=sponsorDraftCategories.find(cat=>matchesSponsorDraftCategory(node,cat));
  return categoryDraft?(hr?categoryDraft.localCourse:categoryDraft.course):participation?t("Participation","Sudjelovanje"):t("Club standings","Klupski poredak");
 };
 const courses=[...new Set(entries.map(e=>family(e.node)))];
 function changeNode(update:(n:RewardSetupNode)=>RewardSetupNode){setNotice("");setDraft(d=>d?{...d,node:update(d.node)}:d);}
 function changeGroup(patch:Partial<GuidedRewardGroup>){setNotice("");setDraft(d=>d?{...d,group:{...d.group,...patch}}:d);}
 if(!draft)return <p>{t("Enable categories in individual editing first.","Najprije uključite kategorije u pojedinačnom uređivanju.")}</p>;
 return <>
  <p className={s.hint}>{t("Choose categories, set prizes once, then apply. Each category keeps its own budget.","Odaberite kategorije, jednom postavite nagrade i primijenite. Svaka kategorija zadržava svoj fond.")}</p>
  <div className={s.quick}><button disabled={disabled} onClick={()=>{setSelected(entries.map(e=>e.node.id));setNotice("");}}>{t("Select all","Odaberi sve")}</button><button disabled={disabled||!targets.length} onClick={()=>{setSelected([]);setNotice("");}}>{t("Clear selection","Očisti odabir")}</button>{courses.length>1?courses.map(course=><button key={course} disabled={disabled} onClick={()=>{setSelected(entries.filter(e=>family(e.node)===course).map(e=>e.node.id));setNotice("");}}>{course}</button>):null}</div>
  <div className={s.choices}>{entries.map(({node})=><label key={node.id} data-selected={selected.includes(node.id)}><input type="checkbox" checked={selected.includes(node.id)} disabled={disabled} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,node.id]:ids.filter(id=>id!==node.id));setNotice("");}}/><span>{node.name}</span></label>)}</div>
  <p className={s.hint}>{mixed?t("Selected categories have different settings. Applying replaces their prize rules.","Odabrane kategorije imaju različite postavke. Primjena zamjenjuje njihova pravila nagrada."):t("Applying replaces the selected categories’ prize rules.","Primjena zamjenjuje pravila nagrada odabranih kategorija.")}<br/>{t("Starting settings:","Početne postavke:")} {draft.node.name}</p>
  <SponsorGroupEditor rulesOnly node={{...draft.node,name:t("Shared reward settings","Zajedničke postavke nagrada")}} group={draft.group} configuration={c} catalogue={null} roundId={null} row={undefined} hr={hr} disabled={disabled} onNode={changeNode} onGroup={changeGroup} onMethod={method=>{setNotice("");setDraft(d=>d?{node:{...d.node,rule:{...d.node.rule!,sharesBps:method==="ranked"?sponsorPrizeShares(5,"descending"):[]}},group:{...d.group,method}}:d);}} onConnect={()=>{}} onRemove={()=>{}}/>
  {!valid?<p role="alert">{t("Prize percentages must total 100%.","Postoci nagrada moraju iznositi 100%.")}</p>:null}
  <div className={s.action}><strong>{targets.length} {t("categories selected","odabranih kategorija")}</strong><button disabled={disabled||!valid||!targets.length} onClick={()=>{if(onApply(targets.map(e=>e.node.id),{method:draft.group.method,minimumFinishes:draft.group.minimumFinishes,sharesBps:[...shares]}))setNotice(t(`Applied to ${targets.length} categories. Save your draft to keep these changes.`,`Primijenjeno na ${targets.length} kategorija. Spremite nacrt za pohranu promjena.`));}}>{t(`Apply to ${targets.length} categories`,`Primijeni na ${targets.length} kategorija`)}</button></div>
  {notice?<p role="status" className={s.success}>{notice}</p>:null}
 </>;
}
