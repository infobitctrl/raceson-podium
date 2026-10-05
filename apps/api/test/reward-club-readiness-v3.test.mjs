import assert from 'node:assert/strict';
import test from 'node:test';
import { clubReadinessV3Fixture as fixture } from './fixtures/reward-club-readiness-v3.mjs';
import { clubReviewId as id } from './fixtures/reward-club-review.mjs';
import { decodeClubReadinessContextV3,decodeClubReadinessReviewV3,readClubReadinessV3,recordClubReadinessV3,revokeClubReadinessV3 } from '../../../packages/db/dist/rewards/index.js';
import { getClubReadinessV3,reviewClubReadinessV3,observeClubReadinessV3 } from '../dist/features/rewards/club-readiness-v3-service.js';
import { dispatchClubReadinessV3 } from '../dist/routes/rewards/club-readiness-v3.js';
import { validateLocalProgrammeRead } from '../../../demo/rewards/scripts/programme-local-chain.mjs';

test('V3 club readiness binds actor, upload, club nomination, chain and immutable review scope',async()=>{
  const f=fixture();assert.equal((await readClubReadinessV3(f.identity,f.scope,f.rpc)).state,'unreviewed');
  assert.deepEqual(f.calls[0],{name:'service_read_reward_club_readiness_v3',args:{p_actor_user_id:f.identity.userId,
    p_actor_session_id:f.identity.sessionId,p_chain_id:31337,p_upload_id:id(21),p_request_id:id(4),p_role:'operator',p_review_id:null}});
  for(const change of [c=>c.actorUserId=id(90),c=>c.role='recipient',c=>c.source.uploadId=id(90),c=>c.source.chainId=143,
    c=>c.source.operatorUserId=id(90),c=>c.source.slot=7,c=>c.nomination.requestId=id(90),c=>c.privateKey='secret',
    c=>c.state='reviewed',c=>c.state='revoked',c=>c.state='source_hold',c=>c.state='identity_changed',c=>c.state='request_withdrawn',
    c=>c.retryReview=f.review]){
    const c=structuredClone(f.context);change(c);assert.throws(()=>decodeClubReadinessContextV3(c,f.identity,f.scope));
  }
  for(const slot of [1,2,3,4,5,6]){f.context.source.slot=slot;f.context.state='reviewed';f.context.review=f.review;
    assert.equal(decodeClubReadinessContextV3(f.context,f.identity,f.scope).state,'reviewed');}
  for(const change of [r=>r.uploadId=id(90),r=>r.requestId=id(90),r=>r.reviewedByUserId=id(90),r=>r.evidence.chainId=10143]){
    const c=structuredClone(f.context);change(c.review);assert.throws(()=>decodeClubReadinessContextV3(c,f.identity,f.scope));
  }
  assert.throws(()=>decodeClubReadinessReviewV3({...f.review,previousReviewId:f.review.id}));
});
test('club readiness status is private and no-chain; reviewed does not claim payment or collected consent',async()=>{
  const f=fixture(),who={userId:f.context.nomination.userId,sessionId:id(90)};
  f.context.actorUserId=who.userId;f.context.role='recipient';
  const visible=await getClubReadinessV3(who,{...f.scope,role:'recipient'},{...f.deps,reader:()=>{throw Error('status must not read chain');}});
  assert.equal(visible.schema,'raceson-club-readiness-v3');assert.equal(visible.state,'unreviewed');
  assert.doesNotMatch(JSON.stringify(visible),/owners|session|EvidenceRef|signature|privateKey|evidence|paid|consent/);
  assert.equal(f.calls[0].args.p_actor_session_id,who.sessionId);
});
test('new club review verifies pinned Safe deployment and freezes actor/evidence across async IO',async()=>{
  const f=fixture(),rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name==='service_read_reward_club_readiness_v3'){
    f.input.evidence.authorityEvidenceRef=id(90);f.identity.userId=id(90);f.input.sourceGuardHash='b'.repeat(64);
  }return r;};
  assert.equal((await reviewClubReadinessV3(f.identity,f.input,{...f.deps,rpc})).reviewId,id(23));
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_actor_user_id,id(1));
  assert.equal(f.calls[1].args.p_evidence.authorityEvidenceRef,id(10));assert.equal(f.calls[1].args.p_source_guard_hash,'d'.repeat(64));
});
test('club review rejects stale source, authority, candidate and corrupt chain evidence without a write',async()=>{
  for(const change of [f=>f.context.source.current=false,f=>f.context.identityFingerprint='b'.repeat(64),
    f=>f.input.previousReviewId=id(90),f=>f.context.nomination.candidate.safeAddress=`0x${'b'.repeat(40)}`,
    f=>f.input.evidence.initializerHash=`0x${'ab'.repeat(32)}`,f=>f.deps.reader=undefined,
    f=>f.deps.reader={...f.chain.reader,getChainId:async()=>143},f=>f.deps.reader={...f.chain.reader,getCode:async()=>'0x'}]){
    const f=fixture();change(f);if(!f.context.source.current)f.context.state='source_hold';
    await assert.rejects(reviewClubReadinessV3(f.identity,f.input,f.deps));assert.equal(f.calls.length,1);
  }
});
test('club exact retry preserves revoked history without another chain observation or renewal',async()=>{
  const f=fixture();f.review.revocation={reason:'operator_correction',revokedAt:'2026-09-11T04:01:00Z',revokedByUserId:id(1)};
  f.context.review=f.review;f.context.retryReview=f.review;f.context.state='revoked';
  f.deps.reader=()=>{throw Error('historical retry must not refresh Safe state');};
  assert.equal((await reviewClubReadinessV3(f.identity,f.input,f.deps)).revokedAt,f.review.revocation.revokedAt);
  for(const change of [r=>r.id=id(90),r=>r.uploadId=id(90),r=>r.requestId=id(90),r=>r.previousReviewId=id(90),r=>r.reviewedByUserId=id(90),
    r=>r.sourceGuardHash='b'.repeat(64),r=>r.identityFingerprint='b'.repeat(64),r=>r.evidence.authorityEvidenceRef=id(90)]){
    const r=structuredClone(f.review);change(r);await assert.rejects(recordClubReadinessV3(f.identity,f.input,async()=>({data:r,error:null})));
  }
});
test('club revocation freezes its reason and validates the private scope and revoking actor',async()=>{
  const f=fixture(),input={...f.scope,reviewId:f.review.id,reason:'operator_correction'};
  const revoked=await revokeClubReadinessV3(f.identity,input,async(name,args)=>{input.reason='key_control_changed';return f.rpc(name,args);});
  assert.equal(revoked.revocation.reason,'operator_correction');
  for(const change of [r=>r.id=id(90),r=>r.uploadId=id(90),r=>r.requestId=id(90),r=>r.revocation.revokedByUserId=id(90),
    r=>r.revocation.reason='key_control_changed',r=>r.revocation=null]){
    const r=structuredClone(revoked);change(r);await assert.rejects(revokeClubReadinessV3(f.identity,{...input,reason:'operator_correction'},async()=>({data:r,error:null})));
  }
});
async function request(path,options={}){
  const f=fixture();let authenticated=0,readBodies=0;const headers={},res={setHeader:(k,v)=>headers[k]=v};
  const routed=await dispatchClubReadinessV3({method:options.method??'GET'},res,new URL(path,'http://127.0.0.1:3101'),{
    config:()=>options.disabled?null:{chainId:31337},requireIdentity:async()=>{authenticated++;if(options.authError)throw Error(options.authError);return f.identity;},
    readJsonBody:async()=>{readBodies++;return options.body;},applyPrivateSessionHeaders:r=>r.setHeader('Cache-Control','private, no-store'),
    sendSuccess:(r,data)=>{r.status=200;r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={code};},clubReaderV3:f.chain.reader,
    rpc:options.error?async()=>{f.calls.push({error:true});return{data:null,error:{message:options.error}};}:f.rpc,
  });return{...res,headers,routed,authenticated,readBodies,calls:f.calls};
}
const path=`/api/v1/organizer/rewards/uploads/${id(21)}/club-treasuries/${id(4)}/readiness-v3`;
const observationInput=f=>({uploadId:f.scope.uploadId,requestId:f.scope.requestId,previousReviewId:null,
  sourceGuardHash:f.input.sourceGuardHash,identityFingerprint:f.input.identityFingerprint,
  factoryAddress:f.input.evidence.factoryAddress,deploymentTransactionHash:f.input.evidence.deploymentTransactionHash});
test('V3 chain inspection is read-only, upload-bound and strips human evidence and private identities',async()=>{
  const f=fixture(),p=observationInput(f),result=await observeClubReadinessV3(f.identity,p,f.deps);
  assert.equal(result.schema,'raceson-club-observation-v3');assert.equal(result.uploadId,p.uploadId);
  assert.equal(result.scope,'initialization_only');assert.equal(result.executionHistoryReviewRequired,true);
  assert.deepEqual(result.candidate,f.context.nomination.candidate);
  assert.equal(result.initializerHash,f.input.evidence.initializerHash);
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.name==='service_read_reward_club_readiness_v3'));
  assert.doesNotMatch(JSON.stringify(result),/EvidenceRef|actorUserId|sessionId|signature|approved|paid/);
});
test('V3 inspection rejects changed session/source/identity/review after chain IO',async()=>{
  for(const mutate of [f=>f.context.identityFingerprint='c'.repeat(64),f=>{f.context.source.current=false;f.context.state='source_hold';},
    f=>{f.context.review=f.review;f.context.state='reviewed';},f=>f.context.actorUserId=id(90)]){
    const f=fixture(),original=f.chain.reader.getChainId;
    f.deps.reader={...f.chain.reader,getChainId:async()=>{mutate(f);return original();}};
    await assert.rejects(observeClubReadinessV3(f.identity,observationInput(f),f.deps));
    assert.ok(f.calls.every(c=>c.name==='service_read_reward_club_readiness_v3'));
  }
});
test('V3 observe HTTP rejects foreign roles, queries and private browser authority fields',async()=>{
  const f=fixture(),{uploadId,requestId,...body}=observationInput(f);
  assert.equal((await request(path+'/observe',{method:'POST',body})).status,200);
  assert.equal((await request(path+'/observe')).routed,false);
  assert.equal((await request(path.replace('organizer','club')+'/observe',{method:'POST',body})).routed,false);
  for(const extra of [{role:'operator'},{chainId:143},{authorityEvidenceRef:id(90)},{rpcUrl:'https://example.com'}]){
    const r=await request(path+'/observe',{method:'POST',body:{...body,...extra}});assert.equal(r.status,400);assert.equal(r.calls.length,0);
  }
});
test('V3 club HTTP is gated, session private, strict and cannot accept browser identities or signing authority',async()=>{
  const r=await request(path);assert.equal(r.status,200);assert.match(r.headers['Cache-Control'],/no-store/);
  assert.equal((await request(path,{disabled:true})).authenticated,0);
  for(const [error,status] of [['Unauthorized',401],['Untrusted browser origin',403]]){
    const r=await request(path,{method:'POST',authError:error});assert.equal(r.status,status);assert.equal(r.readBodies,0);
  }
  for(const query of ['?chainId=143','?actor='+id(90),'?role=operator']){const bad=await request(path+query);assert.equal(bad.status,400);assert.equal(bad.calls.length,0);}
  assert.equal((await request(path,{method:'DELETE'})).routed,false);
  assert.equal((await request(path.replace('organizer','club'),{method:'POST'})).routed,false);
  assert.equal((await request(path+'/revoke')).routed,false);
  const {reviewId,previousReviewId,sourceGuardHash,identityFingerprint,evidence}=fixture().input;
  const body={reviewId,previousReviewId,sourceGuardHash,identityFingerprint,evidence};
  assert.equal((await request(path,{method:'POST',body})).status,200);
  assert.equal((await request(path+'/revoke',{method:'POST',body:{reviewId,reason:'operator_correction'}})).status,200);
  for(const extra of [{userId:id(90)},{chainId:143},{signature:'0x'},{evidence:{...evidence,verified:true}}]){
    const bad=await request(path,{method:'POST',body:{...body,...extra}});assert.equal(bad.status,400);assert.equal(bad.calls.length,0);
  }
  for(const [error,status] of [['reward_account_session_required',401],['reward_club_readiness_scope_required',404],['reward_club_readiness_hold',409],
    ['reward_club_readiness_identity_changed',409],['reward_ledger_idempotency_conflict',409],['secret SQL evidence',503]]){
    const fail=await request(path,{error});assert.equal(fail.status,status);assert.doesNotMatch(JSON.stringify(fail),/secret SQL evidence/);
  }
});
test('local treasury storage read does not enable browser RPC, signing, sends or simulator mutation',()=>{
  const body={jsonrpc:'2.0',id:1,method:'eth_getStorageAt',params:[`0x${'a'.repeat(40)}`,'0x0','latest']};
  validateLocalProgrammeRead(body,undefined,'127.0.0.1:18546');
  assert.throws(()=>validateLocalProgrammeRead(body,'http://127.0.0.1:3101','127.0.0.1:18546'));
  for(const method of ['eth_sendRawTransaction','eth_sendTransaction','eth_sign','personal_sign','anvil_setStorageAt','evm_revert','evm_mine'])
    assert.throws(()=>validateLocalProgrammeRead({...body,method},undefined,'127.0.0.1:18546'));
});
