import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,saved,setupId,id} from './fixtures/hosted-approval-fixture.mjs';
import {hostedCopyAwardReview} from '../dist/features/rewards/hosted-copy-approval-service.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {hostedCopyApprovalRpc} from '../../../packages/db/dist/rewards/hosted-copy-approval.js';
import {fiveRoundCopyProjectionHashV1} from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {canonicalRewardProposalV2 as canonical} from '../../../packages/domain/dist/rewards/frozen-proposal-v2.js';
import {sponsorAllocationDocumentHashV4 as digest} from '../../../packages/db/dist/rewards/sponsor-allocation-v4.js';
function context(version=4){
 const source=fixture(),record=saved(source),actor={userId:id(9900),sessionId:id(9901)},pin={batchSha256:source.batchSha256,projectionSha256:fiveRoundCopyProjectionHashV1(source),leagueId:source.leagueId,seasonId:source.seasonId};
 const policy={pin,selections:[],unaffiliatedReview:undefined,versions:{combined:'synthetic-v1',unaffiliated:'synthetic-v1'}};
 const launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:record.updatedAt,setup:record};
 const plan=createSponsorExecutionPlan(launch,'0x'+'1'.repeat(40),{operator:'0x'+'2'.repeat(40),treasury:'0x'+'3'.repeat(40),reviewPeriods:[0,0,0,0,0,0],
  ...(version===5?{walletRegistry:'0x'+'4'.repeat(40),identityIssuer:'0x'+'5'.repeat(40)}:{})});
 const state={launch,execution:{plan,deploymentHash:null,fundingHash:null},sourceFacts:source,contextHash:'e'.repeat(64),approval:null,recorded:null};
 const calls=[];let written,fail=false;
 const rpc=async(name,args)=>{
  assert.equal(name,'service_reward_demo_copy_allocation');assert.equal(args.p_actor_user_id,actor.userId);assert.equal(args.p_actor_session_id,actor.sessionId);assert.equal(args.p_chain_id,undefined);calls.push(args);
  if(fail)return{data:null,error:{message:'reward_account_session_required'}};
  if(args.p_operation==='review'){
   written=JSON.parse(args.p_document_text);assert.equal(canonical(written),args.p_document_text);
   state.approval={id:args.p_request_id,previousApprovalId:args.p_expected_approval_id,contextHash:args.p_context_hash,documentHash:digest(written),decision:args.p_decision,actorUserId:actor.userId,createdAt:record.updatedAt,current:true};state.recorded=state.approval;
  }
  return{data:structuredClone(state),error:null};
 };
 const read=(change,slot=0)=>hostedCopyAwardReview(actor,setupId,slot,rpc,change,policy);
 return{read,state,calls,actor,source,policy,get written(){return written;},deny(){fail=true;}};
}
const command=v=>({requestId:id(9903),expectedApprovalId:null,contextHash:v.contextHash,documentHash:v.documentHash,decision:'approved'});
test('V5 exact review preserves registry and issuer through approval and idempotent retry',async()=>{
 const x=context(5),view=await x.read(),c=command(view);
 assert.equal(view.proposedWei,'101');assert.deepEqual(view.recipientCounts,{athletes:1,clubs:0});
 const final=await x.read(c);assert.equal(final.recorded.decision,'approved');
 assert.deepEqual(x.written.plan,x.state.execution.plan);assert.equal(x.written.plan.version,5);
 assert.equal(x.written.plan.walletRegistry,'0x'+'4'.repeat(40));assert.equal(x.written.plan.identityIssuer,'0x'+'5'.repeat(40));
 const writes=x.calls.filter(a=>a.p_operation==='review').length;
 assert.equal((await x.read(c)).recorded.documentHash,view.documentHash);
 assert.equal(x.calls.filter(a=>a.p_operation==='review').length,writes);
 assert.equal(final.payableWei,'0');assert.equal(final.stageReady,false);
});
test('exact walletless awards bind server plan, source and decisions with no payment authority',async()=>{
 const x=context(),view=await x.read();assert.equal(view.proposedWei,'101');assert.equal(view.payableWei,'0');assert.equal(view.stageReady,false);assert.deepEqual(view.recipientCounts,{athletes:1,clubs:0});assert.equal(x.calls.length,2);
 const final=await x.read(command(view));assert.equal(final.approval.decision,'approved');assert.equal(final.recorded.documentHash,view.documentHash);
 assert.equal(x.written.calculation.recipients[0].amountWei,'101');assert.equal(x.written.source.results.length,15);assert.equal(x.written.schema,'podium-copy-allocation-document-v1');
 for(const forbidden of [x.actor.userId,x.actor.sessionId,'wallet','signedTransaction'])assert.equal(JSON.stringify(x.written).includes(forbidden),false);
});
test('browser digest, context and competing decision cannot substitute new awards',async()=>{
 for(const edit of [c=>c.contextHash='a'.repeat(64),c=>c.documentHash='a'.repeat(64),c=>c.expectedApprovalId=id(9999)]){
  const x=context(),view=await x.read(),c=command(view);edit(c);await assert.rejects(()=>x.read(c));assert.equal(x.written,undefined);
 }
});
test('held and empty pools cannot be approved; explicit hold remains available',async()=>{
 const x=context(),v=await x.read(undefined,1);assert.deepEqual(v.reasons,['empty_pot']);await assert.rejects(()=>x.read(command(v),1),/source_not_ready/);
 const hold=await x.read({...command(v),decision:'held'},1);assert.equal(hold.recorded.decision,'held');assert.equal(hold.payableWei,'0');
});
test('exact retry acknowledges earlier decision without overwriting a newer hold',async()=>{
 const x=context(),v=await x.read(),c=command(v);await x.read(c);
 x.state.approval={...x.state.approval,id:id(9910),previousApprovalId:c.requestId,decision:'held'};
 const before=x.calls.filter(a=>a.p_operation==='review').length,retry=await x.read(c);
 assert.equal(retry.historicalAcknowledgement,true);assert.equal(retry.approval.decision,'held');assert.equal(retry.recorded.id,c.requestId);
 assert.equal(x.calls.filter(a=>a.p_operation==='review').length,before);
 await assert.rejects(()=>x.read({...c,decision:'held'}),/approval_conflict/);
});
test('changed projection, execution cap and revoked session fail closed',async()=>{
 const x=context();x.source.results[0].finishTimeMs='999';await assert.rejects(()=>x.read(),/projection_changed/);
 const y=context();y.state.execution.plan.caps=['100','1','0','0','0','0'];await assert.rejects(()=>y.read(),/invalid_sponsor_allocation/);
 const z=context();z.deny();await assert.rejects(()=>z.read(),/session_required/);
});
test('approval transport cannot widen method, chain, identity or provider authority',async()=>{
 const actor={userId:id(1),sessionId:id(2)};let sent=0;
 const rpc=hostedCopyApprovalRpc(actor,async()=>{sent++;return {data:null,error:null};}),args={p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:10143,p_setup_id:setupId,p_slot:0,p_request_id:null};
 for(const [name,patch] of [['arbitrary',{}],['service_read_reward_sponsor_allocation_v4',{p_chain_id:1}],['service_read_reward_sponsor_allocation_v4',{p_actor_user_id:id(3)}],['service_read_reward_sponsor_allocation_v4',{p_private_key:'forbidden'}]])await assert.rejects(()=>rpc(name,{...args,...patch}),/invalid_sponsor_allocation/);
 assert.equal(sent,0);
});
test('hosted gate opens only exact approval reads/writes under the operations flag',()=>{
 const u=new URL(`https://podium.raceson.com/api/v1/rewards/demo-copy/reviews/${setupId}/allocations/0`);
 for(const m of ['GET','POST'])assert.equal(hostedCopyRequestAllowed(m,u,'sponsor-drafts-v1',true),true);
 assert.equal(hostedCopyRequestAllowed('POST',u,'sponsor-drafts-v1',false),false);
 for(const m of ['DELETE','PATCH'])assert.equal(hostedCopyRequestAllowed(m,u,'sponsor-drafts-v1',true),false);
 u.search='?source=browser';assert.equal(hostedCopyRequestAllowed('POST',u,'sponsor-drafts-v1',true),false);
});

test('HTTP rejects monetary/source overrides, untrusted origin and wrong methods before private decisions',async()=>{
 const {dispatchHostedCopyReviews}=await import('../dist/routes/rewards/hosted-copy-reviews.js');
 const values={APP_BASE_URL:'https://podium.raceson.com',API_CORS_ORIGIN:'https://podium.raceson.com',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:'https://podium.raceson.com',RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{
  const url=new URL(`https://podium.raceson.com/api/v1/rewards/demo-copy/reviews/${setupId}/allocations/0`);let response,calls=0,originDenied=false;
  const deps={config:()=>({chainId:10143}),applyPrivateSessionHeaders(){},requireIdentity:async()=>{if(originDenied)throw Error('Untrusted browser origin');return{userId:id(1),sessionId:id(2)};},readJsonBody:async()=>({...command({contextHash:'c'.repeat(64),documentHash:'d'.repeat(64)}),amountWei:'999',source:{}}),rpc:async()=>{calls++;throw Error('Forbidden private write');},sendSuccess(){throw Error('Unexpected success');},sendError(_res,status,code){response={status,code};}};
  const res={setHeader(){}};
  await dispatchHostedCopyReviews({method:'POST'},res,url,deps);assert.deepEqual(response,{status:400,code:'invalid_sponsor_allocation'});assert.equal(calls,0);
  originDenied=true;await dispatchHostedCopyReviews({method:'POST'},res,url,deps);assert.equal(response.status,403);assert.equal(calls,0);
  await dispatchHostedCopyReviews({method:'DELETE'},res,url,deps);assert.equal(response.status,405);
 }finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
