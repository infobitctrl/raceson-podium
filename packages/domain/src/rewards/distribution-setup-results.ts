import { previewPublishedPrizeSlots, type StoredRewardSnapshot } from "./published-preview-v2.js";
import type { RewardMappingWorkspaceV2 } from "./source-mapping-v2.js";
import type { RewardSetupNode } from "./distribution-setup.js";

/** Read-only planning preview from the existing authorized frozen source.
 * A connection or calculated recipient is not sporting approval or a payable award. */
export function previewSetupSource(node: RewardSetupNode, slots: bigint[], workspace: RewardMappingWorkspaceV2, snapshot: StoredRewardSnapshot | null) {
  const held = (reason: string) => ({ reason, awards: [], unusedWei: slots.reduce((a, b) => a + b, 0n) });
  const rule = node.rule, source = rule?.source;
  if (!rule || !source) return held("not_connected");
  if (source.draftId !== workspace.draftId || source.catalogueHash !== workspace.catalogueHash) return held("source_changed");
  if (!snapshot) return held("awaiting_results");
  if (rule.basis !== "race_position" && rule.basis !== "club_points") return held("review_required");
  const round = snapshot.catalogue.rounds.find(r => r.id === source.roundId);
  const category = snapshot.catalogue.categories.find(c => c.id === source.categoryId);
  if (!round || !category || !round.races.some(r => r.competitionId === category.competitionId)) return held("source_changed");
  const race = round.races.find(r => r.competitionId === category.competitionId)!;
  let candidates: Array<{ beneficiaryId: string; name: string | null; order: number; evidenceIds: string[]; evidenceValue: number }>;
  if (rule.basis === "race_position") {
    if (category.target !== "individual") return held("source_changed");
    const rows = snapshot.results.filter(r => round.races.some(race => race.id === r.raceId) && r.participationStatus === "finished" && r.finishTimeMs !== null && r.finishTimeMs > 0);
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.athleteId)) return held("ambiguous_results");
      seen.add(row.athleteId);
      if (row.raceId === race.id && (row.classificationIds.length !== 1 || row.rankOverall === null)) return held("ambiguous_results");
    }
    candidates = rows.filter(r => r.raceId === race.id && r.classificationIds.includes(category.id)).map(r => ({ beneficiaryId: r.athleteId, name: r.athleteName, order: r.rankOverall!, evidenceIds: [r.id], evidenceValue: r.rankOverall! }));
  } else {
    if (category.target !== "club") return held("source_changed");
    candidates = snapshot.clubs.flatMap(c => {
      const row = c.rounds.find(r => r.sourceRoundId === round.id && r.points > 0);
      return row ? [{ beneficiaryId: c.clubId, name: c.name, order: -row.points, evidenceIds: [row.sourceRoundId], evidenceValue: row.points }] : [];
    });
  }
  const result = previewPublishedPrizeSlots(slots.map((amountWei, i) => ({ rank: i + 1, amountWei })), candidates);
  return { reason: null, ...result, awards: result.awards.filter(a => a.amountWei > 0n) };
}

/** Reuses the server-validated league proposal; never reconstructs sporting scoring in the browser. */
export function previewSetupLeagueSource(node:RewardSetupNode,slots:bigint[],workspace:RewardMappingWorkspaceV2,view:import('./league-policy-view-v3.js').LeaguePolicyViewV3|null){
 const held=(reason:string)=>({reason,awards:[] as import('./published-preview-v2.js').PublishedRewardAllocation[],unusedWei:slots.reduce((a,b)=>a+b,0n)});
 const source=node.rule?.source,proposal=view?.proposal;
 if(!source||source.roundId!==null||source.draftId!==workspace.draftId||source.catalogueHash!==workspace.catalogueHash||view&&view.draftId!==source.draftId)return held('source_changed');
 if(!proposal||proposal.state==='held')return held('awaiting_results');
 const names=new Map([...view!.labels.athletes,...view!.labels.clubs].map(n=>[n.id,n.name]));
 let candidates:Array<{beneficiaryId:string;name:string|null;order:number;evidenceIds:string[];evidenceValue:number}>;
 if(node.rule!.basis==='league_position'){
  const table=proposal.athleteTables.find(t=>t.categoryId===source.categoryId);if(!table)return held('source_changed');
  candidates=table.rows.filter(r=>r.eligible&&r.rank!==null).map(r=>({beneficiaryId:r.beneficiaryId,name:names.get(r.beneficiaryId)??null,order:r.rank!,evidenceIds:r.rounds.map(x=>x.sourceRowId),evidenceValue:r.points}));
 }else if(node.rule!.basis==='club_points'){
  const table=proposal.clubTables.find(t=>t.slot===null&&t.categoryId===source.categoryId);if(!table)return held('source_changed');
  candidates=table.rows.map(r=>({beneficiaryId:r.beneficiaryId,name:names.get(r.beneficiaryId)??null,order:r.rank,evidenceIds:r.contributions.map(x=>x.sourceRowId),evidenceValue:r.points}));
 }else return held('review_required');
 return {reason:null,...previewPublishedPrizeSlots(slots.map((amountWei,i)=>({rank:i+1,amountWei})),candidates)};
}
