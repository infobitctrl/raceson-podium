import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedCopyPreviewEnabled, hostedCopyRequestAllowed, readHostedCopyPreview } from '../dist/features/rewards/hosted-copy-preview.js';
import { fiveRoundCopyProjectionHashV1 } from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
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
test('preview mode is opt-in and only accepts the selected hosted project and testnet',()=>{
 const values={RACESON_REWARD_HOSTED_COPY_MODE:'preview-v1',RACESON_REWARD_PORTAL_MODE:'testnet'};
 assert.equal(hostedCopyPreviewEnabled({},{}),false);
 assert.equal(hostedCopyPreviewEnabled(values,{supabaseUrl:'https://niklhlmljiikwbkrmapw.supabase.co'}),true);
 for(const url of ['https://icdtinbmtvzhswrrzjxq.supabase.co','http://127.0.0.1:55321','https://different.supabase.co'])assert.throws(()=>hostedCopyPreviewEnabled(values,{supabaseUrl:url}));
 assert.throws(()=>hostedCopyPreviewEnabled({...values,RACESON_REWARD_PORTAL_MODE:'local-testnet'},{supabaseUrl:'https://niklhlmljiikwbkrmapw.supabase.co'}));
});
test('hosted preview permits ordinary session/read paths only; signing, funding, signup and source overrides stay closed',()=>{
 const allowed=(method,path)=>hostedCopyRequestAllowed(method,new URL(path,'https://preview.invalid'));
 assert.ok(allowed('POST','/api/v1/public/auth/sign-in'));assert.ok(allowed('GET','/api/v1/rewards/demo-copy/preview'));
 for(const p of ['/api/v1/public/auth/sign-up','/api/v1/account/bootstrap','/api/v1/rewards/control','/api/v1/rewards/sponsor-execution','/api/v1/public/auth/password-reset'])assert.equal(allowed('POST',p),false);
 assert.equal(allowed('POST','/api/v1/rewards/demo-copy/preview'),false);assert.equal(allowed('GET','/api/v1/rewards/demo-copy/preview?batch=other'),false);
});
test('authenticated read binds actual user/session, checks the independent pin and returns only pseudonymized preview fields',async()=>{
 const {source,identity,account,pin}=setup();let args;
 const view=await readHostedCopyPreview(identity,{},async input=>{args=input;return{data:{account,source},error:null};},pin);
 assert.deepEqual(args,{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId});assert.equal(view.state,'unapproved');assert.equal(view.payableWei,'0');
 assert.equal(view.results[0].finishTimeMs,'9007199254740993');
 for(const hidden of ['username','sessionId','evidenceIds','registrationId','batchSha256','sportingSha256'])assert.equal(JSON.stringify(view).includes(`"${hidden}"`),false);
});
test('wrong account, foreign alias and changed source cannot become a preview',async()=>{
 for(const mutate of [x=>x.account.userId=id(99),x=>x.account.athleteId=id(99),x=>x.account.kind='controller',x=>x.source.results[0].rankOverall=2]){
  const x=setup();mutate(x);await assert.rejects(readHostedCopyPreview(x.identity,{},async()=>({data:{account:x.account,source:x.source},error:null}),x.pin));
 }
 const x=setup();await assert.rejects(readHostedCopyPreview(x.identity,{},async()=>({data:null,error:{message:'private provider detail'}}),x.pin),/hosted_copy_unavailable/);
});
