import { decodeSavedRewardSetup, previewRewardSetup, type SavedRewardSetup } from './distribution-setup.js';
import { decodeFiveRoundCopyV1, previewFiveRoundCopyV1, selectFiveRoundCombinedFinishesV1, type FiveRoundCopyV1, type FiveRoundCombinedSelection } from './five-round-copy-v1.js';
import { previewPublishedPrizeSlots } from './published-preview-v2.js';
import { previewParticipationReward } from './participation-awards.js';
import type { ParticipationIssue, ParticipationMetric } from './league-participation-metrics.js';

export type FiveRoundCategoryBinding = { nodeId: string; classificationId: string };
export type FiveRoundUnaffiliatedReview = {sourceHash:string;resultIds:readonly string[]};
const check = (value: unknown) => { if (!value) throw Error('invalid_copy_setup_binding'); };
/** The repository binds node UUIDs to frozen classification UUIDs. Labels and
 * sponsor-entered source references never determine sporting eligibility. */
export function quoteFiveRoundCopySetupV1(savedInput: SavedRewardSetup, sourceInput: FiveRoundCopyV1,
 bindings: readonly FiveRoundCategoryBinding[], sourceHash: string, selections: readonly FiveRoundCombinedSelection[] = [], unaffiliatedReview?:FiveRoundUnaffiliatedReview) {
 const saved = decodeSavedRewardSetup(savedInput,10143), source = decodeFiveRoundCopyV1(sourceInput), c = saved.configuration;
 check(c.version === 5 && c.stage === 'draft' && c.context === null && c.programmeKind === 'league' && c.event === null && c.guided
  && c.sponsorSelection?.sourceLeagueId === source.leagueId && c.sponsorSelection.sourceSeasonId === source.seasonId
  && /^[0-9a-f]{64}$/.test(sourceHash));
 const guided = c.guided!, economics = previewRewardSetup(c);
 if (economics.retainedWei === null || economics.rows.some(r => r.amountWei === null || r.issue === 'overallocated')) throw Error('reward_setup_overallocated');
 check(bindings.length === guided.groups.filter(g => g.type === 'athlete_standings').length && new Set(bindings.map(b => b.nodeId)).size === bindings.length);
 // The copy-specific SQL save binds edition IDs to official round slots. Check
 // the saved economic scope again here; event metadata never approves results.
 const selection = c.sponsorSelection!;
 if (selection.eventEditionId !== null) {
  const funded = guided.pots.filter(p => c.root.children.find(n => n.id === p.nodeId)!.shareBps > 0);
  check(funded.length <= 1 && funded.every(p => p.slot > 0));
  if (selection.raceId) {
   const race = source.races.find(r => r.id === selection.raceId); check(race);
   check(funded.every(p => p.slot === race!.slot));
   for (const p of funded) for (const n of c.root.children.find(n => n.id === p.nodeId)!.children) {
    if (n.shareBps === 0) continue;
    const category = source.classifications.find(cat => cat.id === bindings.find(b => b.nodeId === n.id)?.classificationId);
    check(category?.competitionId === race!.competitionId);
   }
  }
 } else check(!selection.raceId);
 const sporting = previewFiveRoundCopyV1(source,selections), combined = selectFiveRoundCombinedFinishesV1(source,selections);
 // A null club is only reviewed for this exact source/result set. Never infer
 // a club from another race or treat future blank entries as unaffiliated.
 const unaffiliated=unaffiliatedReview?.resultIds??[];
 check(!unaffiliatedReview || unaffiliatedReview.sourceHash===sourceHash);
 check(new Set(unaffiliated).size===unaffiliated.length && unaffiliated.every(id=>combined.finishes.some(r=>r.id===id&&r.clubId===null)));
 const races = new Map(source.races.map(r => [r.id,r])), athleteNames = new Map(source.athletes.map(a => [a.id,a.name])), clubNames = new Map(source.clubs.map(a => [a.id,a.name]));
 const contributions = combined.finishes.map(r => ({ resultId:r.id, publicationId:r.publicationId, raceId:r.raceId, raceName:'Copied course',
  round:races.get(r.raceId)!.slot, athleteId:r.athleteId, athleteName:athleteNames.get(r.athleteId)!, clubId:r.clubId, clubName:r.clubId ? clubNames.get(r.clubId)! : null, metres:races.get(r.raceId)!.distanceMetres }));
 const issues: ParticipationIssue[] = [];
 for (const r of contributions) {
  if (r.metres === null) issues.push({code:'missing_distance',round:r.round,athleteId:r.athleteId,resultIds:[r.resultId],affects:['athlete_metres','club_metres']});
  if (r.clubId === null) issues.push({code:'unattributed_club',round:r.round,athleteId:r.athleteId,resultIds:[r.resultId],affects:['club_metres']});
 }
 const duplicateGroups = new Map<string,typeof contributions>();
 for (const r of contributions) { const key=`${r.round}:${r.athleteId}`, rows=duplicateGroups.get(key)??[]; rows.push(r); duplicateGroups.set(key,rows); }
 for (const rows of duplicateGroups.values()) if (rows.length>1) issues.push({code:'duplicate_athlete_round',round:rows[0]!.round,athleteId:rows[0]!.athleteId,resultIds:rows.map(r=>r.resultId),affects:['athlete_finishes','athlete_metres','club_metres']});
 const metrics = {version:1 as const,state:'historical_progress' as const,sourceHash,availableRounds:5,plannedRounds:5 as const,contributions,issues,
  summary:{resultRows:source.results.length}};
 const groups = guided.pots.flatMap(pot => {
  const node=c.root.children.find(n=>n.id===pot.nodeId)!;
  check(pot.slot===0 ? pot.roundId===null : source.races.some(r=>r.slot===pot.slot&&r.roundId===pot.roundId));
  return node.children.map(n => {
   const group=guided.groups.find(g=>g.nodeId===n.id)!, row=economics.rows.find(r=>r.id===n.id)!, amount=row.amountWei!;
   check(!group.eligibilityApproved && n.rule!.source===null);
   const beneficiaryKind=group.type==='club_standings'||group.type==='club_metres'?'club' as const:'athlete' as const;
   let hold:string|null=null, unusedWei=0n, heldWei=0n;
   let awards:Array<{beneficiaryId:string;name:string;place:number|null;value:string;amountWei:bigint}>=[];
   if (group.type==='athlete_standings'||group.type==='club_standings') {
    const classificationId=group.type==='athlete_standings'?bindings.find(b=>b.nodeId===n.id)?.classificationId:null;
    check(classificationId===null||source.classifications.some(c=>c.id===classificationId));
    const table=sporting.tables.find(t=>t.slot===(pot.slot||null)&&t.classificationId===classificationId);check(table);
    hold=table!.heldReason;
    const slots=row.slots.map((amountWei,i)=>({rank:i+1,amountWei}));
    if (hold) heldWei=slots.reduce((sum,s)=>sum+s.amountWei,0n);
    else { const quote=previewPublishedPrizeSlots(slots,table!.candidates);unusedWei=quote.unusedWei;
     awards=quote.awards.filter(a=>a.amountWei>0n).map(a=>({beneficiaryId:a.beneficiaryId,name:a.name!,place:a.place,value:String(a.evidenceValue),amountWei:a.amountWei})); }
   } else {
    check(pot.slot===0 && group.method==='proportional');
    const quote=previewParticipationReward(metrics,{version:1,sourceHash,duplicates:[],confirmedUnaffiliatedResultIds:[...unaffiliated]},
     {metric:group.type as ParticipationMetric,method:group.method,minimumFinishes:group.minimumFinishes,prizeSharesBps:[]},amount);
    hold=quote.unresolved.length ? [...new Set(quote.unresolved.map(i=>i.code))].sort().join(',') : null;
    if (hold) heldWei=amount; else unusedWei=quote.retainedWei;
    awards=quote.awards.filter(a=>a.amountWei>0n).map(a=>({beneficiaryId:a.beneficiaryId,name:a.name!,place:a.place,value:a.value.toString(),amountWei:a.amountWei}));
   }
   if (amount===0n) {hold=null;heldWei=0n;unusedWei=0n;awards=[];}
   const proposedWei=awards.reduce((sum,a)=>sum+a.amountWei,0n), unallocatedWei=row.retainedWei!;
   check(proposedWei+heldWei+unusedWei+unallocatedWei===amount);
   return {nodeId:n.id,name:n.name,slot:pot.slot,type:group.type,beneficiaryKind,budgetWei:amount,proposedWei,heldWei,unusedWei,unallocatedWei,hold,awards};
  });
 });
 const proposedWei=groups.reduce((sum,g)=>sum+g.proposedWei,0n), heldWei=groups.reduce((sum,g)=>sum+g.heldWei,0n), unusedWei=groups.reduce((sum,g)=>sum+g.unusedWei,0n);
 check(proposedWei+heldWei+unusedWei+economics.retainedWei===economics.budgetWei);
 return {version:'podium-copy-allocation-v1' as const,state:'unapproved' as const,payableWei:0n,setupId:saved.id,revision:saved.revision,sourceHash,
  budgetWei:economics.budgetWei,proposedWei,heldWei,unallocatedWei:economics.retainedWei,unusedWei,groups,
  sourceCounts:{results:source.results.length,finished:sporting.counts.finishes,countedCombinedFinishes:combined.finishes.length,unclassifiedFinishes:sporting.counts.unclassifiedFinishes},
  confirmedUnaffiliatedFinishes:unaffiliated.length,
  combinedSelections:selections.map(s=>({slot:s.slot,name:athleteNames.get(s.athleteId)!,keptResultId:s.keepResultId,excludedResultIds:s.resultIds.filter(id=>id!==s.keepResultId)}))};
}
