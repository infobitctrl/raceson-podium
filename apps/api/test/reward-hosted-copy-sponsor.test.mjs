import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCopySponsor} from '../../../packages/db/dist/rewards/hosted-copy-sponsor.js';
import {fiveRoundCopyProjectionHashV1} from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
import {createGuidedSetup} from '../../../packages/domain/dist/rewards/guided-setup-editor.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const id=n=>`7e000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(){
 const source={version:'raceson-five-round-copy-v1',batchSha256:'a'.repeat(64),sportingSha256:'b'.repeat(64),leagueId:id(1),seasonId:id(2),capturedAt:'2026-10-05T00:00:00.000Z',closedAfterRound:5,clubScoringScope:'combined',
  athletes:[{id:id(3),ordinal:1,name:'Races Mon1',username:'racesmon1'}],clubs:[],classifications:[{id:id(4),competitionId:id(5),name:'Open'}],
  policies:[{id:id(5),points:[100],participationPoints:5,bestN:5,minimumRounds:1,tieBreak:'best_finish',clubMode:'best_three'}],races:[],results:[]};
 for(let n=1;n<=5;n++){
  source.races.push({id:id(10+n),roundId:id(20+n),slot:n,competitionId:id(5),publicationId:id(30+n),runId:id(40+n),publicationState:'official',publishedAt:source.capturedAt,distanceMetres:'5000',resultCount:1});
  source.results.push({id:id(50+n),registrationId:id(60+n),raceId:id(10+n),athleteId:id(3),clubId:null,publicationId:id(30+n),runId:id(40+n),status:'finished',finishTimeMs:'9007199254740993',rankOverall:1,classificationIds:[id(4)]});
 }
 const identity={userId:id(80),sessionId:id(81)},account={userId:identity.userId,kind:'athlete',athleteId:id(3),batchSha256:source.batchSha256};
 const pin={batchSha256:source.batchSha256,projectionSha256:fiveRoundCopyProjectionHashV1(source),leagueId:source.leagueId,seasonId:source.seasonId};
 return{source,identity,account,pin};
}

test('sponsor mode adds only copy planning paths',()=>{
 const allow=(method,path,mode='sponsor-drafts-v1')=>hostedCopyRequestAllowed(method,new URL(path,'https://podium.invalid'),mode);
 assert.ok(allow('GET','/api/v1/rewards/demo-copy/sponsor-source'));
 assert.ok(allow('PATCH','/api/v1/rewards/demo-copy/sponsor-setups/'+id(1)));
 for(const path of ['/api/v1/rewards/distribution-setups/'+id(1),'/api/v1/rewards/sponsor-execution','/api/v1/rewards/control'])assert.equal(allow('PATCH',path),false);
 assert.equal(allow('GET','/api/v1/rewards/demo-copy/sponsor-source','preview-v1'),false);
 assert.equal(allow('GET','/api/v1/rewards/demo-copy/sponsor-source?batch=x'),false);
 assert.equal(allow('DELETE','/api/v1/rewards/demo-copy/sponsor-setups/'+id(1)),false);
 const allocation='/api/v1/rewards/demo-copy/sponsor-setups/'+id(1)+'/allocation/1';
 assert.equal(allow('GET',allocation),true);
 for(const method of ['POST','PATCH','DELETE'])assert.equal(allow(method,allocation),false);
 assert.equal(allow('GET',allocation+'?keepResultId=other'),false);
 assert.equal(allow('GET',allocation,'preview-v1'),false);
});
test('independent pin is verified before persistence and save carries exact preflight fingerprint',async()=>{
 const x=setup(),calls=[];let n=1000;const c=createGuidedSetup(()=>id(n++));const change={requestId:id(999),expectedRevision:0,configuration:c};
 const rpc=async(name,args)=>{calls.push({name,args});return{error:null,data:{source:x.source,sourceFingerprint:'f'.repeat(64),result:args.p_action==='template'?c:{id:id(998),chainId:10143,revision:1,configuration:c,updatedAt:'2026-10-05T12:00:00.000Z'}}};};
 const result=await hostedCopySponsor(x.identity,'save',id(998),change,x.pin,rpc);assert.equal(result.result.revision,1);
 assert.deepEqual(calls.map(c=>c.args.p_action),['template','save']);assert.ok(calls.every(c=>c.name==='service_reward_demo_copy_sponsor'));assert.equal(calls[1].args.p_source_fingerprint,'f'.repeat(64));
 calls.length=0;x.source.results[0].rankOverall=2;
 await assert.rejects(hostedCopySponsor(x.identity,'save',id(998),change,x.pin,rpc),/copy_projection_changed/);assert.deepEqual(calls.map(c=>c.args.p_action),['template']);
});
test('sponsor denial stops before write and private backend details are suppressed',async()=>{
 const x=setup();for(const message of ['reward_demo_sponsor_required','sensitive backend text']){
 let calls=0;await assert.rejects(hostedCopySponsor(x.identity,'list',null,undefined,x.pin,async()=>{calls++;return{data:null,error:{message}};}),new RegExp(message==='reward_demo_sponsor_required'?message:'hosted_copy_unavailable'));assert.equal(calls,1);
 }
});
