import {decodeRewardSetup, defaultRewardSetupPolicy, presetSetupShares, previewRewardSetup, setupNodes, setupPath, type RewardDistributionSetup, type RewardSetupNode} from "./distribution-setup.js";
import {GUIDED_REWARD_TYPES, isParticipationType, type GuidedRewardType} from "./guided-setup.js";

export type GuidedConversionChoice = {
  nodeId: string;
  type: GuidedRewardType;
  /** Only unfinished legacy groups need an explicit new prize configuration. */
  newPrizeCount?: number;
  newPrizeCurve?: "equal" | "descending";
};
export type GuidedConversionRow = {
  nodeId:string; path:string; name:string; kind:"pot"|"group";
  beforeWei:bigint; afterWei:bigint; previousBasis:string|null;
  type:GuidedRewardType|null; beforeShares:number[]; afterShares:number[];
};
const check=(condition:unknown,code="reward_conversion_incomplete")=>{if(!condition)throw Error(code);};

/** Slots are chosen by the organizer, never inferred from names or tree order.
 * All legacy leaves must be covered exactly once. Intermediary containers can
 * disappear only when exact node and prize amounts survive integer allocation. */
export function inspectGuidedConversion(input:RewardDistributionSetup,potIds:string[]) {
  const source=decodeRewardSetup(input);
  check(source.version!==5&&source.programmeKind!=="event"&&!source.event&&(!source.context||source.context.roundId===null));
  check(potIds.length===6&&new Set(potIds).size===6);
  const all=setupNodes(source.root),pots=potIds.map(id=>all.find(n=>n.id===id));
  check(pots.every(p=>p&&p.id!==source.root.id&&!p.rule));
  const selected=pots as RewardSetupNode[];
  check(selected.every(p=>setupPath(source.root,p.id).slice(1,-1).every(a=>!potIds.includes(a.id))));
  const covered=new Set(selected.flatMap(p=>setupNodes(p).map(n=>n.id)));
  check(all.filter(n=>!n.children.length).every(n=>covered.has(n.id)),"reward_conversion_uncovered_groups");
  const before=previewRewardSetup(source);
  check(before.rows.every(r=>r.amountWei!==null&&r.retainedWei!==null),"reward_conversion_overallocated");
  const groups=selected.flatMap((pot,slot)=>setupNodes(pot).filter(n=>n.id!==pot.id&&!n.children.length).map(node=>({slot,potId:pot.id,node,path:setupPath(source.root,node.id).map(n=>n.name).join(" / ")})));
  return {source,pots:selected,groups,before};
}

function flattenedShare(path:RewardSetupNode[]) {
  const numerator=path.reduce((value,n)=>value*BigInt(n.shareBps),10000n);
  const denominator=10000n**BigInt(path.length);
  check(numerator%denominator===0n,"reward_conversion_precision");
  return Number(numerator/denominator);
}

/** Pure proposed copy. Persistence must create a new setup ID with revision 0;
 * the source document, sources and any approved economic state are never edited. */
export function convertToGuidedSetup(input:RewardDistributionSetup,potIds:string[],choices:GuidedConversionChoice[]) {
  const {source,pots,groups,before}=inspectGuidedConversion(input,potIds);
  check(choices.length===groups.length&&new Set(choices.map(c=>c.nodeId)).size===groups.length);
  const selected=new Map(choices.map(c=>[c.nodeId,c]));
  const metadata=groups.map(({node,slot})=>{
    const choice=selected.get(node.id);
    check(choice&&GUIDED_REWARD_TYPES.includes(choice.type));
    check(!isParticipationType(choice!.type)||slot===0,"reward_conversion_round_participation");
    check(node.rule?choice!.newPrizeCount===undefined&&choice!.newPrizeCurve===undefined:
      Number.isInteger(choice!.newPrizeCount)&&choice!.newPrizeCount!>=1&&choice!.newPrizeCount!<=100&&["equal","descending"].includes(choice!.newPrizeCurve??""));
    return {nodeId:node.id,type:choice!.type,method:"ranked" as const,minimumFinishes:1,eligibilityApproved:false};
  });
  const root={...source.root,children:pots.map((pot,slot)=>({...pot,
    shareBps:flattenedShare(setupPath(source.root,pot.id).slice(1)),
    children:groups.filter(g=>g.potId===pot.id).map(({node})=>{
      const choice=selected.get(node.id)!;
      return {...node,shareBps:flattenedShare(setupPath(pot,node.id).slice(1)),rule:{
        basis:isParticipationType(choice.type)?"participation" as const:choice.type==="club_standings"?"club_points" as const:slot===0?"league_position" as const:"race_position" as const,
        sharesBps:node.rule?[...node.rule.sharesBps]:presetSetupShares(choice.newPrizeCount!,choice.newPrizeCurve!),source:null,
      }};
    }),
  }))};
  const configuration=decodeRewardSetup({version:5,name:source.name,budgetMon:source.budgetMon,root,programmeKind:"league",event:null,
    context:source.context??null,policy:source.policy??defaultRewardSetupPolicy(),stage:"draft",
    guided:{version:1,pots:pots.map((p,slot)=>({nodeId:p.id,slot,roundId:null})),groups:metadata,counting:"one_finish_per_round",clubAttribution:"represented_at_finish"}});
  const after=previewRewardSetup(configuration),afterRows=new Map(after.rows.map(r=>[r.id,r])),beforeRows=new Map(before.rows.map(r=>[r.id,r]));
  const comparison:GuidedConversionRow[]=[...pots,...groups.map(g=>g.node)].map(node=>{
    const old=beforeRows.get(node.id)!,next=afterRows.get(node.id)!,choice=selected.get(node.id),newNode=setupNodes(configuration.root).find(n=>n.id===node.id)!;
    check(next.amountWei===old.amountWei,"reward_conversion_precision");
    if(node.rule)check(node.rule.sharesBps.length===next.slots.length&&old.slots.every((v,i)=>v===next.slots[i]),"reward_conversion_precision");
    return {nodeId:node.id,path:setupPath(source.root,node.id).map(n=>n.name).join(" / "),name:node.name,kind:choice?"group":"pot",
      beforeWei:old.amountWei!,afterWei:next.amountWei!,previousBasis:node.rule?.basis??null,type:choice?.type??null,
      beforeShares:node.rule?.sharesBps??[],afterShares:newNode.rule?.sharesBps??[]};
  });
  // Configuring previously empty groups is the only permitted change in total
  // retained funds. Existing unfinished prize curves remain unfinished.
  const explicitlyAssigned=groups.filter(g=>!g.node.rule).reduce((sum,g)=>sum+afterRows.get(g.node.id)!.slots.reduce((s,v)=>s+v,0n),0n);
  check(after.retainedWei===before.retainedWei!-explicitlyAssigned,"reward_conversion_precision");
  const retained=new Set([source.root.id,...pots.map(p=>p.id),...groups.map(g=>g.node.id)]);
  return {configuration,comparison,retainedBeforeWei:before.retainedWei!,retainedAfterWei:after.retainedWei!,
    removedContainers:setupNodes(source.root).filter(n=>!retained.has(n.id)).map(n=>({id:n.id,name:n.name}))};
}
