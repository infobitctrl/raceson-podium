import {createGuidedSetup,addGuidedGroup} from '../../../../packages/domain/dist/rewards/guided-setup-editor.js';
import {hostedCopySetupNodeId as nodeId} from '../../../../packages/db/dist/rewards/hosted-copy-allocation.js';
export const id=n=>`7c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function fixture(){
 const source={version:'raceson-five-round-copy-v1',batchSha256:'a'.repeat(64),sportingSha256:'b'.repeat(64),leagueId:id(1),seasonId:id(2),capturedAt:'2026-10-05T00:00:00.000Z',closedAfterRound:5,clubScoringScope:'combined',
  athletes:[1,2,3].map(n=>({id:id(10+n),ordinal:n,name:`Races Mon${n}`,username:`racesmon${n}`})),
  clubs:[{id:id(21),name:'Races Club1'},{id:id(22),name:'Races Club2'}],classifications:[{id:id(30),competitionId:id(31),name:'Open'}],
  policies:[{id:id(31),points:[100,60,40],participationPoints:5,bestN:5,minimumRounds:1,tieBreak:'best_finish',clubMode:'best_three'}],races:[],results:[]};
 for(let slot=1;slot<=5;slot++){
  source.races.push({id:id(100+slot),roundId:id(200+slot),slot,competitionId:id(31),publicationId:id(300+slot),runId:id(400+slot),publicationState:'official',publishedAt:'2026-10-04T12:00:00.000Z',distanceMetres:'5432',resultCount:3});
  for(let n=1;n<=3;n++)source.results.push({id:id(500+slot*10+n),registrationId:id(600+slot*10+n),raceId:id(100+slot),athleteId:id(10+n),clubId:n<3?id(20+n):null,publicationId:id(300+slot),runId:id(400+slot),status:'finished',finishTimeMs:'9007199254740993',rankOverall:n===3?3:slot===5?n:3-n,classificationIds:n<3?[id(30)]:[]});
 }return source;
}

export const setupId=id(9000);
export function saved(source){
 let seq=10000,c=createGuidedSetup(()=>id(seq++));c.name='Synthetic allocation';c.budgetMon='0.000000000000000101';c.sponsorSelection={sourceLeagueId:source.leagueId,sourceSeasonId:source.seasonId,eventEditionId:null};c.root.id=nodeId(setupId,'root');
 c.root.children=c.root.children.map((n,slot)=>({...n,id:nodeId(setupId,`pot:${slot}`),shareBps:slot===0?10000:0}));
 c.guided.pots=c.root.children.map((n,slot)=>({nodeId:n.id,slot,roundId:slot?source.races.find(r=>r.slot===slot).roundId:null}));
 for(const [slot,pot]of c.guided.pots.entries()){
  for(const cat of source.classifications)c=addGuidedGroup(c,pot.nodeId,'athlete_standings',()=>nodeId(setupId,`group:${slot}:${cat.id}`),{id:cat.id,name:cat.name,competitionName:'Synthetic course',target:'individual'});
  c=addGuidedGroup(c,pot.nodeId,'club_standings',()=>nodeId(setupId,`group:${slot}:club_standings`),null);
  if(!slot)for(const type of ['athlete_finishes','athlete_metres','club_metres'])c=addGuidedGroup(c,pot.nodeId,type,()=>nodeId(setupId,`group:${slot}:${type}`),null);
 }
 for(const pot of c.root.children)for(const n of pot.children)if(n.rule.basis!=='participation')n.rule.sharesBps=[10000];
 c.root.children[0].children[0].shareBps=10000;
 return{id:setupId,chainId:10143,revision:1,updatedAt:'2026-10-05T12:00:00.000Z',configuration:c};
}
