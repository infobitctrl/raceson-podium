import assert from 'node:assert/strict';
import {createPrivyTestnetPilotV3} from '../../../packages/domain/dist/rewards/privy-testnet-pilot-v3.js';
import {decodeStoredRewardSnapshot} from '../../../packages/domain/dist/rewards/published-preview-v2.js';
export const workflowId=n=>`9b000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const workflowProfiles=['9a000000-0000-4000-8000-000000001060','9a000000-0000-4000-8000-000000001061'];
export const workflowOrigin='urn:raceson:synthetic:workflow-20260930:v1';
export function workflowFixture(capturedAt){
 const old=createPrivyTestnetPilotV3(capturedAt);
 const f=JSON.parse(JSON.stringify(old).replaceAll('9a000000-0000-4000-8000-','9b000000-0000-4000-8000-'));
 const selected=workflowProfiles.map(id=>id.replace('9a000000','9b000000'));
 f.snapshot.sourceOrigin=workflowOrigin;
 f.snapshot.results=f.snapshot.results.filter(r=>selected.includes(r.athleteId)).map(r=>({...r,
  athleteId:workflowProfiles[selected.indexOf(r.athleteId)],athleteName:`Demo recipient ${selected.indexOf(r.athleteId)+1} · Synthetic workflow`,
  clubId:null,clubName:null,participationStatus:'finished'}));
 f.snapshot.clubs=[];
 for(const round of f.snapshot.catalogue.rounds){
  round.name=`Round ${round.slot} · Synthetic workflow 30 September`;
  round.races=round.races.filter(r=>f.snapshot.results.some(row=>row.raceId===r.id));
  assert.equal(round.races.length,1);
  for(const race of round.races){
   race.name='Demo course · Synthetic';race.resultCount=2;
   const rows=f.snapshot.results.filter(r=>r.raceId===race.id).sort((a,b)=>a.athleteId.localeCompare(b.athleteId));
   rows.forEach((r,i)=>{r.rankOverall=i+1;r.finishTimeMs=1800000+i*13000;});
  }
 }
 f.rules.budgetMon='0.06';f.rules.leagueShareBps=5000;f.rules.roundSharesBps=Array(5).fill(1000);
 f.rules.raceFamilySharesBps={athleteStandings:10000,clubStandings:0};
 f.rules.leagueFamilySharesBps={athleteStandings:10000,clubStandings:0,participationMetres:0};
 const shares=f.snapshot.catalogue.categories.map(c=>({categoryId:c.id,shareBps:c.id===workflowId(3)?10000:0}));
 f.mapping.rounds.forEach(r=>r.categories=structuredClone(shares));f.mapping.leagueCategories=structuredClone(shares);
 f.snapshot=decodeStoredRewardSnapshot(f.snapshot);
 return {draftId:f.draftId,snapshot:f.snapshot,rules:f.rules,mapping:f.mapping,finale:f.finale};
}

// Append-only corrected source revision: preserve the first immutable snapshot.
export const correctedWorkflowId=n=>workflowId([51,52,53,54,55,56].includes(n)?n+100:n>=800000?n+100000:n);
export function correctedWorkflowFixture(capturedAt){
 const f=workflowFixture(capturedAt);
 const old=JSON.parse(JSON.stringify(createPrivyTestnetPilotV3(capturedAt)).replaceAll('9a000000-0000-4000-8000-','9b000000-0000-4000-8000-'));
 f.snapshot.sourceOrigin='urn:raceson:synthetic:workflow-20260930:v2';
 f.snapshot.sourceSeasonId=correctedWorkflowId(51);f.draftId=correctedWorkflowId(52);
 for(const round of f.snapshot.catalogue.rounds){
  const prior=old.snapshot.catalogue.rounds.find(r=>r.slot===round.slot);
  const empty=prior.races.filter(r=>!round.races.some(s=>s.id===r.id)).map(r=>({...r,name:'Empty long course · Synthetic',resultCount:0}));
  round.races.push(...empty);assert.equal(round.races.length,2);
 }
 for(const [key,value] of Object.entries(f.finale))if(typeof value==='string')for(const n of [53,54,55,56])if(value===workflowId(n))f.finale[key]=correctedWorkflowId(n);
 f.snapshot=decodeStoredRewardSnapshot(f.snapshot);return f;
}
