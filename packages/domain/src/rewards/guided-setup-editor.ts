import {createRewardSetup, defaultRewardSetupPolicy, decodeRewardSetup, presetSetupShares, updateSetupNode, type RewardDistributionSetup, type RewardSetupContext, type RewardSetupNode} from "./distribution-setup.js";
import {isParticipationType, type GuidedRewardType, type GuidedRewardGroup} from "./guided-setup.js";
import type {RewardSourceCatalogueV2} from "./source-mapping-v2.js";

const requireGuided = (setup:RewardDistributionSetup) => {if(setup.version!==5||!setup.guided)throw Error("invalid_reward_setup");return setup.guided;};
export function createGuidedSetup(newId:()=>string,hr=false):RewardDistributionSetup {
  const base=createRewardSetup(newId(),hr);
  const pots=Array.from({length:6},(_,slot)=>({nodeId:newId(),slot,roundId:null}));
  return decodeRewardSetup({...base,version:5,programmeKind:"league",event:null,context:null,stage:"draft",policy:defaultRewardSetupPolicy(),
    guided:{version:1,pots,groups:[],counting:"one_finish_per_round",clubAttribution:"represented_at_finish"},
    root:{...base.root,children:pots.map(p=>({id:p.nodeId,name:p.slot===0?(hr?"Liga":"League"):`${hr?"Kolo":"Round"} ${p.slot}`,shareBps:p.slot===0?5000:1000,locked:false,rule:null,children:[]}))}});
}

/** Rebinding changes only source evidence. Existing amounts and reward choices
 * survive; their eligibility needs a new explicit review. */
export function bindGuidedSeason(setup:RewardDistributionSetup,context:RewardSetupContext,catalogue:RewardSourceCatalogueV2):RewardDistributionSetup {
  const g=requireGuided(setup);if(context.roundId!==null)throw Error("invalid_reward_setup");
  const pots=g.pots.map(p=>({...p,roundId:p.slot===0?null:catalogue.rounds.find(r=>r.slot===p.slot&&r.status!=="cancelled")?.id??null}));
  const root={...setup.root,children:setup.root.children.map(p=>{
    const pot=pots.find(v=>v.nodeId===p.id)!, round=catalogue.rounds.find(r=>r.id===pot.roundId);
    return {...p,name:(round?.name??p.name).slice(0,100),children:p.children.map(n=>{
      const group=g.groups.find(v=>v.nodeId===n.id)!,oldSource=n.rule!.source;
      const category=guidedCategories(catalogue,pot.roundId,group.type).find(c=>c.id===oldSource?.categoryId);
      return {...n,rule:{...n.rule!,source:category&&(pot.slot===0||pot.roundId)?{draftId:context.draftId,catalogueHash:context.catalogueHash,roundId:pot.roundId,categoryId:category.id}:null}};
    })};
  })};
  return decodeRewardSetup({...setup,context,stage:"draft",root,guided:{...g,pots,groups:g.groups.map(v=>({...v,eligibilityApproved:false}))}});
}
export function guidedCategories(catalogue:RewardSourceCatalogueV2,roundId:string|null,type:GuidedRewardType) {
  if(isParticipationType(type))return [];
  const round=catalogue.rounds.find(r=>r.id===roundId);
  return catalogue.categories.filter(c=>c.target===(type==="club_standings"?"club":"individual")&&
    (roundId===null||type==="club_standings"||round?.races.some(r=>r.competitionId===c.competitionId)));
}
export function addGuidedGroup(setup:RewardDistributionSetup,potId:string,type:GuidedRewardType,newId:()=>string,category:RewardSourceCatalogueV2["categories"][number]|null,hr=false):RewardDistributionSetup {
  const g=requireGuided(setup),pot=g.pots.find(p=>p.nodeId===potId);
  if(!pot||isParticipationType(type)&&pot.slot!==0)throw Error("invalid_reward_setup");
  if(category&&category.target!==(type==="club_standings"?"club":"individual"))throw Error("invalid_reward_setup");
  const nodeId=newId(),participation=isParticipationType(type),context=setup.context;
  const labels={athlete_finishes:hr?"Broj završetaka":"Athlete finishes",athlete_metres:hr?"Kilometri sportaša":"Athlete kilometres",club_metres:hr?"Kilometri klubova":"Club kilometres",athlete_standings:hr?"Poredak sportaša":"Athlete standings",club_standings:hr?"Klupski poredak":"Club standings"};
  const node:RewardSetupNode={id:nodeId,name:(category?`${category.competitionName} · ${category.name}`:labels[type]).slice(0,100),shareBps:0,locked:false,children:[],rule:{
    basis:participation?"participation":type==="club_standings"?"club_points":pot.slot===0?"league_position":"race_position",
    sharesBps:participation?[]:presetSetupShares(pot.slot===0?25:10,"descending"),
    source:!participation&&category&&context&&(pot.slot===0||pot.roundId)?{draftId:context.draftId,roundId:pot.roundId,categoryId:category.id,catalogueHash:context.catalogueHash}:null}};
  return decodeRewardSetup({...setup,stage:"draft",root:updateSetupNode(setup.root,potId,n=>({...n,children:[...n.children,node]})),
    guided:{...g,groups:[...g.groups,{nodeId,type,method:participation?"proportional":"ranked",minimumFinishes:1,eligibilityApproved:false}]}});
}
export function removeGuidedGroup(setup:RewardDistributionSetup,nodeId:string):RewardDistributionSetup {
  const g=requireGuided(setup);
  return decodeRewardSetup({...setup,stage:"draft",root:{...setup.root,children:setup.root.children.map(p=>({...p,children:p.children.filter(n=>n.id!==nodeId)}))},guided:{...g,groups:g.groups.filter(v=>v.nodeId!==nodeId)}});
}
/** Resolve an existing, including converted, group without replacing its name,
 * amount or prize curve. Changed official eligibility requires fresh review. */
export function connectGuidedGroup(setup:RewardDistributionSetup,nodeId:string,categoryId:string|null,catalogue:RewardSourceCatalogueV2):RewardDistributionSetup {
  const g=requireGuided(setup),group=g.groups.find(v=>v.nodeId===nodeId),context=setup.context;
  const potNode=setup.root.children.find(p=>p.children.some(n=>n.id===nodeId)),pot=g.pots.find(p=>p.nodeId===potNode?.id);
  if(!group||isParticipationType(group.type)||!pot||!context||pot.slot>0&&!pot.roundId)throw Error("invalid_reward_setup");
  const category=guidedCategories(catalogue,pot.roundId,group.type).find(c=>c.id===categoryId);
  if(categoryId!==null&&!category)throw Error("invalid_reward_setup");
  return decodeRewardSetup({...setup,stage:"draft",root:updateSetupNode(setup.root,nodeId,n=>({...n,rule:{...n.rule!,
    source:category?{draftId:context.draftId,catalogueHash:context.catalogueHash,roundId:pot.roundId,categoryId:category.id}:null}})),
    guided:{...g,groups:g.groups.map(v=>v.nodeId===nodeId?{...v,eligibilityApproved:false}:v)}});
}
export function changeGuidedMethod(setup:RewardDistributionSetup,nodeId:string,method:GuidedRewardGroup["method"]):RewardDistributionSetup {
  const g=requireGuided(setup),group=g.groups.find(v=>v.nodeId===nodeId);if(!group||!isParticipationType(group.type))throw Error("invalid_reward_setup");
  return decodeRewardSetup({...setup,stage:"draft",root:updateSetupNode(setup.root,nodeId,n=>({...n,rule:{...n.rule!,sharesBps:method==="proportional"?[]:presetSetupShares(5,"descending")}})),
    guided:{...g,groups:g.groups.map(v=>v.nodeId===nodeId?{...v,method,eligibilityApproved:false}:v)}});
}

/** Copy only into explicitly selected pots. Caller presents a comparison first;
 * changed groups receive new IDs and require eligibility review in that round. */
export function copyGuidedRound(setup:RewardDistributionSetup,fromId:string,toIds:string[],catalogue:RewardSourceCatalogueV2,newId:()=>string):RewardDistributionSetup {
  const g=requireGuided(setup),from=g.pots.find(p=>p.nodeId===fromId),source=setup.root.children.find(p=>p.id===fromId);
  if(!from||from.slot===0||!source||!toIds.length||new Set(toIds).size!==toIds.length||toIds.includes(fromId))throw Error("invalid_reward_setup");
  let groups=[...g.groups];
  const children=setup.root.children.map(p=>{
    if(!toIds.includes(p.id))return p;
    const pot=g.pots.find(v=>v.nodeId===p.id);if(!pot||pot.slot===0)throw Error("invalid_reward_setup");
    const oldIds=new Set(p.children.map(n=>n.id));groups=groups.filter(v=>!oldIds.has(v.nodeId));
    return {...p,children:source.children.map(n=>{
      const group=g.groups.find(v=>v.nodeId===n.id)!,nodeId=newId();
      const category=guidedCategories(catalogue,pot.roundId,group.type).find(c=>c.id===n.rule?.source?.categoryId);
      if(!category||!pot.roundId||!setup.context)throw Error("reward_setup_round_categories_differ");
      groups.push({...group,nodeId,eligibilityApproved:false});
      return {...n,id:nodeId,rule:{...n.rule!,source:{...n.rule!.source!,roundId:pot.roundId}}};
    })};
  });
  if(toIds.some(id=>!g.pots.some(p=>p.nodeId===id)))throw Error("invalid_reward_setup");
  return decodeRewardSetup({...setup,stage:"draft",root:{...setup.root,children},guided:{...g,groups}});
}
