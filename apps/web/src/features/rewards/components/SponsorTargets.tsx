import {useState} from "react";
import type {RewardSourceCatalogueV2} from "@raceson/domain/rewards/source-mapping-v2";
import type {RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {addGuidedGroup,guidedCategories} from "@raceson/domain/rewards/guided-setup-editor";
import type {GuidedRewardType} from "@raceson/domain/rewards/guided-setup";
import s from "./RewardSetup.module.css";
import g from "./GuidedRewardSetup.module.css";

export default function SponsorTargets({configuration:c,potId,catalogue,hr,disabled,onChange}:{configuration:RewardDistributionSetup;potId:string;catalogue:RewardSourceCatalogueV2|null;hr:boolean;disabled:boolean;onChange:(c:RewardDistributionSetup)=>void}){
  const [error,setError]=useState(false),t=(en:string,local:string)=>hr?local:en,pot=c.guided!.pots.find(p=>p.nodeId===potId)!;
  const nodes=c.root.children.find(p=>p.id===potId)!.children;
  const categories=catalogue?([...guidedCategories(catalogue,pot.roundId,"athlete_standings"),...guidedCategories(catalogue,pot.roundId,"club_standings")]):[];
  const competitions=[...new Set(categories.map(cat=>cat.target==="club"?"clubs":cat.competitionId))];
  function add(type:GuidedRewardType,category:RewardSourceCatalogueV2["categories"][number]|null){
    try{onChange(addGuidedGroup(c,potId,type,()=>crypto.randomUUID(),category,hr));setError(false);}catch{setError(true);}
  }
  return <section className={g.targetPicker} aria-label={t("Choose achievements to sponsor","Odaberite postignuća za sponzorstvo")}>{!catalogue?<p className={s.notice}>{t("Choose a league first.","Najprije odaberite ligu.")}</p>:<div className={g.targetGrid}>{competitions.map(id=>{const rows=categories.filter(cat=>(cat.target==="club"?"clubs":cat.competitionId)===id);return <div className={g.targetCard} key={id}><h4>{id==="clubs"?t("Club standings","Klupski poredak"):rows[0].competitionName}</h4>{rows.map(cat=>{const selected=nodes.some(n=>n.rule?.source?.categoryId===cat.id);return <button key={cat.id} className={s.button} disabled={disabled||selected||pot.slot>0&&!pot.roundId} onClick={()=>add(cat.target==="club"?"club_standings":"athlete_standings",cat)}>{selected?"✓":"+"} {cat.name}{selected?` · ${t("Selected","Odabrano")}`:""}</button>;})}</div>;})}</div>}
    {pot.slot===0&&catalogue?<div className={g.targetGrid}>{([['athlete_finishes',t("Completed rounds","Završena kola"),t("One verified finish per athlete per round. DNS and DNF do not count.","Jedan potvrđen završetak po sportašu u kolu. DNS i DNF se ne broje.")],['club_metres',t("Club completed kilometres","Završeni klupski kilometri"),t("Distance belongs to the club represented at each finish, not all club memberships.","Udaljenost pripada klubu zastupanom pri završetku, ne svim članstvima.")],['athlete_metres',t("Athlete completed kilometres","Završeni kilometri sportaša"),t("Share rewards by completed distance across the selected rounds.","Podijelite nagrade prema završenoj udaljenosti odabranih kola.")]] as const).map(([type,title])=>{const selected=c.guided!.groups.some(g=>g.type===type);return <div className={g.targetCard} key={type}><h4>{title}</h4><button className={s.button} disabled={disabled||!catalogue||selected} onClick={()=>add(type,null)}>{selected?`✓ ${t("Selected","Odabrano")}`:t("Add","Dodaj")}</button></div>;})}</div>:null}
    {error?<p role="alert">{t("This group could not be added. Check the current settings.","Grupu nije moguće dodati. Provjerite postavke.")}</p>:null}
  </section>;
}
