import type {composeHostedCopyAwardDocument} from '@raceson/db/rewards';
type Document=ReturnType<typeof composeHostedCopyAwardDocument>;
/** Exact recipient totals from the reconstructed copy, never inferred per-result money. */
export function hostedCopyResultDisplay(document:Document){
 const {source,calculation,launch,slot}=document,groups=new Map(calculation.groups.map(g=>[g.nodeId,g]));
 const pot=launch.setup.configuration.guided!.pots.find(p=>p.slot===slot)!;
 const name=launch.setup.configuration.root.children.find(n=>n.id===pot.nodeId)!.name;
 const named=(id:string,kind:'athlete'|'club')=>(kind==='athlete'?source.athletes:source.clubs).find(row=>row.id===id)!.name;
 const blocked=calculation.groups.some(g=>g.hold!==null);
 const recipientTotals=calculation.recipients.map(r=>({key:`${r.beneficiaryKind}:${r.beneficiaryId}`,name:named(r.beneficiaryId,r.beneficiaryKind),kind:r.beneficiaryKind,categoryCount:r.groupIds.length,amountWei:blocked?null:r.amountWei.toString()}));
 return {name,estimated:false,blocked,allocatedWei:calculation.proposedWei.toString(),retainedWei:calculation.retainedWei.toString(),
  rows:calculation.recipients.map(r=>({key:`${r.beneficiaryKind}:${r.beneficiaryId}`,rank:null,name:named(r.beneficiaryId,r.beneficiaryKind),club:null,
   race:name,categories:r.groupIds.map(id=>groups.get(id)!.name),timeMs:null,status:'finished',amountWei:blocked?null:r.amountWei.toString(),kind:r.beneficiaryKind})),
  recipientTotals,distribution:calculation.groups.map(g=>({id:g.nodeId,name:g.name,budgetWei:g.budgetWei.toString(),allocatedWei:g.proposedWei.toString(),
   retainedWei:(g.budgetWei-g.proposedWei).toString(),held:g.hold!==null,
   prizes:[...new Set(g.awards.flatMap(a=>a.place===null?[]:[a.place]))].sort((a,b)=>a-b).map(rank=>({rank,amountWei:g.awards.filter(a=>a.place===rank).reduce((sum,a)=>sum+a.amountWei,0n).toString()}))})),
  sourceAvailable:true,scope:slot===0?'league':'race'};
}
