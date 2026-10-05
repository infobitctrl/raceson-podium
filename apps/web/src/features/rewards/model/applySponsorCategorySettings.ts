import {decodeRewardSetup,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {isParticipationType,type GuidedRewardGroup} from "@raceson/domain/rewards/guided-setup";

export type SponsorCategorySettings={method:GuidedRewardGroup["method"];minimumFinishes:number;sharesBps:number[]};

/** Apply prize rules atomically within one pot. Never copy category identity,
 * source bindings, pot shares, locks or eligibility approval. */
export function applySponsorCategorySettings(c:RewardDistributionSetup,potId:string,ids:string[],settings:SponsorCategorySettings):RewardDistributionSetup{
 const meta=c.guided,pot=c.root.children.find(p=>p.id===potId),targets=new Set(ids);
 if(!meta||!pot||!ids.length||targets.size!==ids.length||ids.some(id=>!pot.children.some(n=>n.id===id&&n.rule)))throw Error("invalid_category_selection");
 const groups=ids.map(id=>meta.groups.find(g=>g.nodeId===id));
 if(groups.some(g=>!g)||new Set(groups.map(g=>isParticipationType(g!.type))).size!==1)throw Error("incompatible_category_selection");
 if(!isParticipationType(groups[0]!.type)&&(settings.method!=="ranked"||settings.minimumFinishes!==1))throw Error("invalid_category_settings");
 if(settings.method==="ranked"&&(settings.sharesBps.length<1||settings.sharesBps.length>100||settings.sharesBps.some(v=>!Number.isInteger(v)||v<0)||settings.sharesBps.reduce((a,b)=>a+b,0)!==10000)
  ||settings.method==="proportional"&&settings.sharesBps.length!==0)throw Error("invalid_category_settings");
 return decodeRewardSetup({...c,stage:"draft",root:{...c.root,children:c.root.children.map(p=>p.id!==potId?p:{...p,children:p.children.map(n=>!targets.has(n.id)?n:{...n,rule:{...n.rule!,sharesBps:[...settings.sharesBps]}})})},
  guided:{...meta,groups:meta.groups.map(g=>!targets.has(g.nodeId)?g:{...g,method:settings.method,minimumFinishes:settings.minimumFinishes,eligibilityApproved:false})}});
}
