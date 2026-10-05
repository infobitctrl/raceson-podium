import {decodeStoredRewardSnapshot} from '@raceson/domain/rewards/published-preview-v2';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import type {sponsorAllocationDocumentV4} from './sponsor-allocation-v4-service.js';
type Document=ReturnType<typeof sponsorAllocationDocumentV4>;

/** Presentation is deliberately outside the signed allocation document. A source
 * estimate can never be supplied to approval, upload or transaction endpoints. */
export function rewardResultDisplay(document:Document,snapshotInput:unknown,estimate=false) {
 const snapshot=snapshotInput?decodeStoredRewardSnapshot(snapshotInput):null;
 if(snapshot&&(snapshot.sourceLeagueId!==document.binding.sourceLeagueId||snapshot.sourceSeasonId!==document.binding.sourceSeasonId))throw Error('invalid_result_display');
 let calculation=document.calculation;
 if(estimate&&document.slot>=1&&document.slot<=4){
  const source=structuredClone(document.source),round=source.rounds[document.slot-1];
  if(round.evidence)round.evidence.held=false;
  for(const table of source.standings)if(table.slot===document.slot)table.evidence.held=false;
  calculation=previewSponsorAllocation(document.launch,document.plan,document.binding,source).pots.find(p=>p.slot===document.slot)!;
 }
 const config=document.launch.setup.configuration,labels=new Map(config.root.children.flatMap(n=>n.children.map(g=>[g.id,g.name] as const)));
 const pot=config.guided!.pots.find(p=>p.slot===document.slot)!;
 const round=snapshot?.catalogue.rounds.find(r=>r.id===pot.roundId);
 const races=round?.races??[],raceIds=new Set(races.map(r=>r.id));
 const sourceRows=document.slot?document.source.rounds[document.slot-1].results:document.source.rounds.flatMap(r=>r.results);
 const resultById=new Map(snapshot?.results.map(r=>[r.id,r])??[]);
 const named=(id:string,kind:'athlete'|'club')=>kind==='club'?snapshot?.clubs.find(c=>c.clubId===id)?.name??snapshot?.results.find(r=>r.clubId===id)?.clubName??null:snapshot?.results.find(r=>r.athleteId===id)?.athleteName??null;
 const blocked=calculation.groups.some(g=>g.hold!==null);
 // Every source row must match its frozen sporting identity. Labels cannot
 // silently attach to a different athlete or club, even when ranks coincide.
 for(const r of sourceRows){const s=resultById.get(r.id);if(s&&(s.athleteId!==r.athleteId||s.clubId!==r.clubId))throw Error('invalid_result_display');}
 const amounts=new Map<string,bigint>();
 for(const g of calculation.groups)if(g.beneficiaryKind==='athlete')for(const award of g.awards){
  if(award.sourceRowIds.length===1)amounts.set(award.sourceRowIds[0],(amounts.get(award.sourceRowIds[0])??0n)+award.amountWei);
 }
 const rows=document.slot>0&&round?snapshot!.results.filter(r=>raceIds.has(r.raceId)&&sourceRows.some(s=>s.id===r.id)).map(r=>({
  key:r.id,rank:r.rankOverall,name:r.athleteName,club:r.clubName,race:races.find(race=>race.id===r.raceId)!.name,
  categories:r.classificationIds.map(id=>snapshot!.catalogue.categories.find(c=>c.id===id)!.name),
  timeMs:r.finishTimeMs,status:r.participationStatus??'unknown',amountWei:blocked?null:String(amounts.get(r.id)??0n),kind:'athlete' as const,
 })) : calculation.recipients.filter(r=>r.beneficiaryKind==='athlete').map(r=>({key:r.beneficiaryId,rank:null,name:named(r.beneficiaryId,'athlete'),club:null,
  race:document.slot===0?'League standings':'Final round',categories:r.groupIds.map(id=>labels.get(id)??'Reward category'),timeMs:null,status:'finished',amountWei:blocked?null:String(r.amountWei),kind:'athlete' as const}));
 // Club standings are category rows, not repeated aggregate recipient totals.
 // Include non-winning clubs so the reviewer sees the whole official table.
 const nodes=config.root.children.flatMap(p=>p.children);
 const clubs=calculation.groups.filter(g=>g.beneficiaryKind==='club').flatMap(g=>{
  const categoryId=nodes.find(n=>n.id===g.groupId)?.rule?.source?.categoryId;
  const table=g.type==='club_standings'?document.source.standings.find(t=>t.slot===(document.slot||null)&&t.categoryId===categoryId):null;
  const entries=table?.rows??g.awards.map(a=>({beneficiaryId:a.beneficiaryId,rank:a.rank}));
  return entries.map(entry=>{
   const score=g.type==='club_standings'&&round?snapshot?.clubs.find(c=>c.clubId===entry.beneficiaryId)?.rounds.find(r=>r.sourceRoundId===round.id&&r.slot===document.slot):null;
   const award=g.awards.find(a=>a.beneficiaryId===entry.beneficiaryId);
   return {key:`${g.groupId}:${entry.beneficiaryId}`,rank:entry.rank,name:named(entry.beneficiaryId,'club'),club:null,
    race:round?.name??'League standings',categories:[labels.get(g.groupId)??'Club rewards'],
    points:score?.points??null,timeMs:null,status:'finished',amountWei:blocked?null:String(award?.amountWei??0n),kind:'club' as const};
  });
 });
 return {name:round?.name??config.root.children.find(n=>n.id===pot.nodeId)!.name,estimated:estimate,blocked,
  allocatedWei:String(calculation.proposedWei),retainedWei:String(calculation.retainedWei),rows:[...rows,...clubs],
  // Use the allocation's beneficiary identity, never a display-name grouping.
  // Sporting rows can repeat one recipient across races and categories.
  recipientTotals:calculation.recipients.map(recipient=>({key:`${recipient.beneficiaryKind}:${recipient.beneficiaryId}`,
   name:named(recipient.beneficiaryId,recipient.beneficiaryKind),kind:recipient.beneficiaryKind,
   categoryCount:recipient.groupIds.length,amountWei:blocked?null:String(recipient.amountWei)})),
  // Read-only chart evidence. Keep exact category budgets and rank award pools
  // separate from athlete totals, which can include several categories.
  distribution:calculation.groups.map(g=>({id:g.groupId,name:labels.get(g.groupId)??'Reward category',
   budgetWei:String(g.budgetWei),allocatedWei:String(g.proposedWei),retainedWei:String(g.retainedWei),held:g.hold!==null,
   prizes:[...new Set(g.awards.flatMap(a=>a.rank===null?[]:[a.rank]))].sort((a,b)=>a-b).map(rank=>({rank,
    amountWei:String(g.awards.filter(a=>a.rank===rank).reduce((sum,a)=>sum+a.amountWei,0n))})),
  })),
  // These source IDs are source evidence, not local platform navigation IDs.
  sourceAvailable:Boolean(round),scope:document.slot===0?'league':'race'};
}
