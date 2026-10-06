import test from 'node:test';
import assert from 'node:assert/strict';
import {readHostedCopyCatalogue} from '../dist/features/rewards/hosted-copy-catalogue.js';
import {fiveRoundCopyProjectionHashV1} from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const id=n=>`7e000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const source={version:'raceson-five-round-copy-v1',batchSha256:'a'.repeat(64),sportingSha256:'b'.repeat(64),leagueId:id(1),seasonId:id(2),capturedAt:'2026-10-05T00:00:00.000Z',closedAfterRound:5,clubScoringScope:'combined',athletes:[],clubs:[],classifications:[],policies:[],races:[],results:[]};
 for(let n=0;n<7;n++)source.classifications.push({id:id(10+n),competitionId:id(n<2?3:4),name:`Category ${n}`});
 for(const n of [3,4])source.policies.push({id:id(n),points:[100],participationPoints:5,bestN:5,minimumRounds:1,tieBreak:'best_finish',clubMode:'best_three'});
 const metadata={name:'Synthetic league',status:'completed',categories:source.classifications.map(c=>({...c,target:'individual',competitionName:'Route'})),rounds:[]};
 for(let slot=1;slot<=5;slot++){
  const round={slot,roundId:id(20+slot),sourceRoundId:id(20+slot),eventEditionId:id(30+slot),editionId:id(30+slot),name:`Round ${slot}`,date:'2026-10-04',status:'completed',tracks:[]};
  for(let k=0;k<2;k++){
   const n=slot*2+k,raceId=id(40+n);round.tracks.push({raceId,sourceRaceId:raceId,competitionId:id(k+3),name:'Route',distanceMetres:'5000'});
   source.races.push({id:raceId,roundId:round.roundId,slot,competitionId:id(k+3),publicationId:id(60+n),runId:id(80+n),publicationState:'official',publishedAt:source.capturedAt,distanceMetres:'5000',resultCount:0});
  }metadata.rounds.push(round);
 }
 const pin={batchSha256:source.batchSha256,projectionSha256:fiveRoundCopyProjectionHashV1(source),leagueId:source.leagueId,seasonId:source.seasonId};
 return {pin,data:{source,metadata,hasLaunches:false,checkedAt:source.capturedAt}};
}
test('public catalogue exposes only event metadata and a database-checked empty directory',async()=>{
 const {data,pin}=fixture(),out=await readHostedCopyCatalogue({},async()=>({data,error:null}),pin);
 assert.equal(out.catalogue.rounds.length,5);assert.equal(out.catalogue.categories.length,7);assert.deepEqual(out.directory.items,[]);
 for(const hidden of ['athletes','results','username','registrationId','batchSha256'])assert.equal(JSON.stringify(out).includes(`"${hidden}"`),false);
});
test('changed sporting data, incomplete rounds, foreign classifications and missing directory facts fail closed',async()=>{
 for(const change of [d=>d.source.races[0].distanceMetres='5001',d=>d.metadata.rounds[4].status='scheduled',d=>d.metadata.categories[0].id=id(999),d=>d.metadata.rounds[0].tracks[0].raceId=id(999)]){
  const {data,pin}=fixture();change(data);await assert.rejects(readHostedCopyCatalogue({},async()=>({data,error:null}),pin));
 }
 for(const value of [true,null,undefined]){const {data,pin}=fixture();data.hasLaunches=value;assert.equal((await readHostedCopyCatalogue({},async()=>({data,error:null}),pin)).directory,null);}
});
test('public catalogue cannot open writes, queries, source overrides or transaction paths',()=>{
 for(const path of ['/api/v1/rewards/demo-copy/catalogue','/api/v1/rewards/public-campaigns']){
  assert.equal(hostedCopyRequestAllowed('GET',new URL(path,'https://demo.invalid'),'sponsor-drafts-v1'),true);
  assert.equal(hostedCopyRequestAllowed('POST',new URL(path,'https://demo.invalid'),'sponsor-drafts-v1'),false);
  assert.equal(hostedCopyRequestAllowed('GET',new URL(path+'?project=other','https://demo.invalid'),'sponsor-drafts-v1'),false);
 }
 assert.equal(hostedCopyRequestAllowed('POST',new URL('/api/v1/rewards/sponsor-execution','https://demo.invalid'),'sponsor-drafts-v1'),false);
});

test('active hosted operations bypass the preview directory but retain the verified catalogue route',async()=>{
 const {dispatchHostedCopyCatalogue}=await import('../dist/routes/rewards/hosted-copy-catalogue.js');
 const values={APP_BASE_URL:'https://podium.raceson.com',API_CORS_ORIGIN:'https://podium.raceson.com',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:'https://podium.raceson.com',RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 let response,reads=0;
 const deps={config:()=>({chainId:10143}),applyPrivateSessionHeaders(){},sendSuccess:(_,data)=>response={status:200,data},sendError:(_,status)=>response={status}};
 const read=async()=>{reads++;return {catalogue:{name:'Synthetic catalogue'},directory:null};};
 const directory=new URL('https://podium.raceson.com/api/v1/rewards/public-campaigns');
 try{
  assert.equal(await dispatchHostedCopyCatalogue({method:'GET'},{},directory,deps,read),false);assert.equal(reads,0);assert.equal(response,undefined);
  assert.equal(await dispatchHostedCopyCatalogue({method:'GET'},{},new URL('https://podium.raceson.com/api/v1/rewards/demo-copy/catalogue'),deps,read),true);assert.equal(response.status,200);assert.equal(reads,1);
  delete process.env.RACESON_REWARD_HOSTED_OPERATIONS;
  await dispatchHostedCopyCatalogue({method:'GET'},{},directory,deps,read);assert.equal(response.status,503);
  process.env.RACESON_REWARD_HOSTED_OPERATIONS='invalid';
  await dispatchHostedCopyCatalogue({method:'GET'},{},directory,deps,read);assert.equal(response.status,503);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
