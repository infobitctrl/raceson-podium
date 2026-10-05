import {decodeRewardSetup,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {guidedCategories} from "@raceson/domain/rewards/guided-setup-editor";
import type {RewardSourceCatalogueV2} from "@raceson/domain/rewards/source-mapping-v2";

/** Copy draft choices only. Each target keeps its pot and receives its own IDs and source binding. */
export function applySponsorRaceDistribution(configuration:RewardDistributionSetup,fromId:string,targetIds:string[],catalogue:RewardSourceCatalogueV2|null,newId:()=>string):RewardDistributionSetup{
 const meta=configuration.guided,source=configuration.root.children.find(p=>p.id===fromId);
 if(configuration.version!==5||!meta||!source?.children.length||!meta.pots.some(p=>p.nodeId===fromId&&p.slot>0)||!targetIds.length||new Set(targetIds).size!==targetIds.length||targetIds.some(id=>id===fromId||!meta.pots.some(p=>p.nodeId===id&&p.slot>0)))throw Error("invalid_reward_setup");
 let groups=[...meta.groups];
 const children=configuration.root.children.map(pot=>{
  if(!targetIds.includes(pot.id))return pot;
  const target=meta.pots.find(p=>p.nodeId===pot.id)!;
  const previous=new Set(pot.children.map(n=>n.id));groups=groups.filter(g=>!previous.has(g.nodeId));
  return {...pot,children:source.children.map(node=>{
   const group=meta.groups.find(g=>g.nodeId===node.id);if(!group||!node.rule)throw Error("invalid_reward_setup");
   const nodeId=newId(),binding=node.rule.source;
   const category=catalogue&&target.roundId?guidedCategories(catalogue,target.roundId,group.type).find(c=>c.id===binding?.categoryId):null;
   const context=configuration.context;
   const sourceBinding=category&&context&&binding?.draftId===context.draftId&&binding.catalogueHash===context.catalogueHash?{...binding,roundId:target.roundId}:null;
   groups.push({...group,nodeId,eligibilityApproved:false});
   return {...node,id:nodeId,rule:{...node.rule,sharesBps:[...node.rule.sharesBps],source:sourceBinding}};
  })};
 });
 return decodeRewardSetup({...configuration,stage:"draft",root:{...configuration.root,children},guided:{...meta,groups}});
}
