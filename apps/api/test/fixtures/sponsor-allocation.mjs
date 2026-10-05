import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {createRewardAllocationRehearsalV3} from '@raceson/domain/rewards/allocation-rehearsal-v3';
export const sponsorFixtureId=n=>`75000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
/** Invented sporting data and public addresses; never an imported athlete ledger. */
export function sponsorAllocationFixture(){
 let seq=100;const id=()=>sponsorFixtureId(seq++),{source}=createRewardAllocationRehearsalV3('five_rounds','compact_20');
 let c=createGuidedSetup(id);c.budgetMon='0.000000000000001003';
 const binding={draftId:sponsorFixtureId(3),catalogueHash:'a'.repeat(64),sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId};
 c.context={draftId:binding.draftId,catalogueHash:binding.catalogueHash,roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'Synthetic season'};
 c.guided.pots.forEach(p=>p.roundId=p.slot===0?null:source.rounds[p.slot-1].roundId);
 c.root.children.forEach((p,i)=>p.shareBps=[3100,1300,1700,2000,900,1000][i]);
 for(const pot of c.guided.pots){
  for(const [i,type]of (pot.slot===0?['athlete_standings','athlete_finishes','athlete_metres','club_metres','club_standings']:['athlete_standings']).entries()){
   const category=type==='athlete_standings'?source.categories[0]:type==='club_standings'?source.categories.at(-1):null;
   c=addGuidedGroup(c,pot.nodeId,type,id,category?{...category,competitionName:'Synthetic',name:type}:null);
   const n=c.root.children.find(n=>n.id===pot.nodeId).children.at(-1);n.shareBps=pot.slot===0?2000:10000;
   if(n.rule.sharesBps.length)n.rule.sharesBps=[6000,3000,1000];
  }
 }
 const setup={id:sponsorFixtureId(1),chainId:31337,revision:4,configuration:c,updatedAt:'2026-09-23T08:00:00.000Z'};
 const launch={id:sponsorFixtureId(2),setup,configurationHash:'b'.repeat(64),createdAt:setup.updatedAt,state:'prepared'};
 const p=previewRewardSetup(c);
 const plan={version:4,launchId:launch.id,setupRevision:4,configurationHash:launch.configurationHash,chainId:31337,
  funder:'0x'+'11'.repeat(20),operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'33'.repeat(20),
  claimLifetime:365*86400,reviewPeriods:[0,0,0,0,0,0],caps:c.guided.pots.map(pot=>p.rows.find(r=>r.id===pot.nodeId).amountWei.toString()),budgetWei:p.budgetWei.toString()};
 return {launch,plan,binding,source};
}
