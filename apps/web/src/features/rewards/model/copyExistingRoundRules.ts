import {decodeRewardSetup,type RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';

/** Keys come from the frozen source mapping, never category labels or positions. */
export type ExistingCategoryKeys=Record<string,string>;
export function existingRoundCompatibility(c:RewardDistributionSetup,sourceId:string,targetId:string,keys:ExistingCategoryKeys){
 const source=c.root.children.find(p=>p.id===sourceId),target=c.root.children.find(p=>p.id===targetId);
 if(sourceId===targetId||!c.guided?.pots.some(p=>p.nodeId===sourceId&&p.slot>0)||!c.guided.pots.some(p=>p.nodeId===targetId&&p.slot>0)||!source||!target||target.shareBps<=0)return false;
 const selected=source.children.filter(n=>n.shareBps>0);
 return selected.length>0&&new Set(selected.map(n=>keys[n.id])).size===selected.length&&selected.reduce((n,c)=>n+c.shareBps,0)===10000&&!target.children.some(n=>n.locked)&&selected.every(n=>{
  const key=keys[n.id],matches=target.children.filter(t=>keys[t.id]===key);
  return !!key&&matches.length===1&&n.rule&&matches[0].rule?.basis===n.rule.basis;
 });
}
export function copyExistingRoundRules(c:RewardDistributionSetup,sourceId:string,targetIds:string[],keys:ExistingCategoryKeys){
 if(!targetIds.length||new Set(targetIds).size!==targetIds.length||targetIds.some(id=>!existingRoundCompatibility(c,sourceId,id,keys)))throw Error('incompatible_round_rules');
 const source=c.root.children.find(p=>p.id===sourceId)!,selected=source.children.filter(n=>n.shareBps>0);
 return decodeRewardSetup({...c,root:{...c.root,children:c.root.children.map(p=>!targetIds.includes(p.id)?p:{...p,children:p.children.map(n=>{
  const from=selected.find(s=>keys[s.id]===keys[n.id]);
  return {...n,shareBps:from?.shareBps??0,...(from&&n.rule?{rule:{...n.rule,sharesBps:[...from.rule!.sharesBps]}}:{})};
 })})}});
}
