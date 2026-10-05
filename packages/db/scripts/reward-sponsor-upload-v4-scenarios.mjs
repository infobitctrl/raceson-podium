import {sponsorLifecycleV4Scenarios} from "./reward-sponsor-lifecycle-v4-scenarios.mjs";
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startOwnedRewardChain} from '../../rewards-chain/integration/owned-chain.mjs';
import {sponsorDeploymentData,sponsorFundingData} from '../../rewards-chain/dist/sponsor-v4.js';
import {rewardSponsorExecution,sponsorUploadFactsV4} from '../dist/rewards/index.js';
import {sponsorAllocationReviewV4} from '../../../apps/api/dist/features/rewards/sponsor-allocation-v4-service.js';
import {sponsorUploadV4} from '../../../apps/api/dist/features/rewards/sponsor-upload-v4-service.js';
import {literal as q} from './reward-integration-fixture.mjs';
export async function sponsorUploadV4Scenarios({harness,scenario,actor,sponsor,scope,plan,first,next,draftId}){
 const {rpc,query,scalar,rpcSql}=harness,selected={...scope,approvalId:first.requestId};
 const request={requestId:next(),contextHash:first.contextHash,documentHash:first.documentHash};
 const read=()=>sponsorUploadV4(actor,selected,undefined,{rpc});
 const count=()=>scalar(`select count(*) from app_private.reward_sponsor_uploads_v4 where approval_id=${q(first.requestId)}`);
 const chain=await startOwnedRewardChain();
 try{
  await scenario('V4 saved upload refuses missing funding and sponsor-only authority without generating more recipient IDs',async()=>{
   assert.equal((await read()).prepared,null);
   await assert.rejects(()=>sponsorUploadV4(actor,selected,request,{rpc,reader:chain.publicClient}),{code:'reward_sponsor_funding_not_ready'});
   await assert.rejects(()=>sponsorUploadV4(sponsor,selected,request,{rpc,reader:chain.publicClient}),{code:'reward_planning_not_found'});
   assert.equal(await count(),0);
  });
  // These public addresses belong only to the entirely synthetic fixture. No private key is created/exported.
  await chain.testClient.impersonateAccount({address:plan.funder});await chain.testClient.setBalance({address:plan.funder,value:100n*10n**18n});
  const deploymentHash=await chain.operatorClient.sendTransaction({account:plan.funder,data:sponsorDeploymentData(plan),gas:25_000_000n});
  const deployed=await chain.publicClient.waitForTransactionReceipt({hash:deploymentHash});assert.equal(deployed.status,'success');
  const fundingHash=await chain.operatorClient.sendTransaction({account:plan.funder,to:deployed.contractAddress,data:sponsorFundingData(),value:BigInt(plan.budgetWei),gas:2000000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:fundingHash})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});
  await rewardSponsorExecution(sponsor,31337,scope.setupId,{deploymentHash,fundingHash},rpc);
  const save=(change=request,reader=chain.publicClient,customRpc=rpc)=>sponsorUploadV4(actor,selected,change,{rpc:customRpc,reader});
  await scenario('V4 upload rechecks current Auth after finalized funding IO before persisting anything',async()=>{
   let firstCall=true;
   const reader={...chain.publicClient,getChainId:async()=>{if(firstCall){firstCall=false;await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)}`);}return 31337;}};
   try{await assert.rejects(()=>save(request,reader),{code:'reward_account_session_required'});assert.equal(await count(),0);}
   finally{await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(actor.sessionId)}`);}
  });
  await scenario('V4 upload transaction rolls back on a source change during insertion',async()=>{
   let args;
   await assert.rejects(()=>save(request,chain.publicClient,async(name,params)=>{
    if(name==='service_prepare_reward_sponsor_upload_v4'){args=params;return{data:null,error:{message:'reward_planning_revision_changed'}};}return rpc(name,params);
   }),{code:'reward_planning_revision_changed'});
   assert.ok(args);
   await assert.rejects(()=>query(`begin;create function pg_temp.sponsor_upload_drift() returns trigger language plpgsql as $$ begin
    update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
    create trigger sponsor_upload_drift after insert on app_private.reward_sponsor_uploads_v4 for each row execute function pg_temp.sponsor_upload_drift();
    ${rpcSql('service_prepare_reward_sponsor_upload_v4',args)} rollback;`),/reward_planning_revision_changed/);
   assert.equal(await count(),0);
  });
  let view,stored;
  await scenario('V4 actual DB recipients and finalized local funding produce one stable private upload with exact concurrent retry',async()=>{
   const before=await sponsorUploadFactsV4(actor,selected,undefined,rpc);
   const [a,b]=await Promise.all([save(),save()]);assert.deepEqual(a,b);view=a;
   assert.equal(await count(),1);assert.equal(a.executionStatus,'not_observed');assert.equal(a.stageReady,false);assert.equal(a.payableWei,'0');
   const retry=await save(request,{getChainId:()=>{throw Error('Exact retry must not query a chain');}});assert.deepEqual(retry,a);
   stored=await sponsorUploadFactsV4(actor,selected,undefined,rpc);assert.deepEqual(stored.recipients,before.recipients);assert.equal(stored.snapshotSalt,before.snapshotSalt);
   assert.doesNotMatch(JSON.stringify(a),/beneficiaryId|snapshotSalt|explanationSalt|awards|actorUserId/);
   const p=stored.prepared.package;assert.equal(p.allocatedWei,plan.caps[scope.slot]);assert.equal(p.entitlementCount,String(stored.recipients.length));
   for(const r of stored.recipients){assert.ok(!JSON.stringify(p).includes(r.beneficiaryId));assert.ok(!JSON.stringify(p).includes(r.explanationSalt));}
   assert.ok(!('allocationDigest' in p));assert.ok(!('reviewStartedAt' in p));assert.ok(!('officialPublishedAt' in p));
   await assert.rejects(()=>save({...request,requestId:next()}),{code:'reward_sponsor_upload_conflict'});
   await assert.rejects(()=>save({...request,documentHash:'a'.repeat(64)}),{code:'reward_planning_revision_changed'});
  });
  await scenario('V4 persisted opaque package uploads to the exact local child and matches Solidity rolling digest without activating or paying',async()=>{
   const p=stored.prepared.package,abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
   await chain.testClient.impersonateAccount({address:plan.operator});await chain.testClient.setBalance({address:plan.operator,value:10n**18n});
   const hash=await chain.operatorClient.writeContract({account:plan.operator,address:p.campaignAddress,abi,functionName:'uploadAwards',
    args:[p.awards.map(r=>({...r,amount:BigInt(r.amount)}))],gas:2000000n});
   assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');
   const readContract=functionName=>chain.publicClient.readContract({address:p.campaignAddress,abi,functionName});
   assert.equal(await readContract('uploadDigest'),p.uploadDigest);assert.equal(await readContract('entitlementCount'),BigInt(p.entitlementCount));
   assert.equal(await readContract('state'),1);assert.equal(await readContract('claimDeadline'),0n);
  });
  await chain.testClient.mine({blocks:96,interval:1});
  await sponsorLifecycleV4Scenarios({harness,scenario,actor,sponsor,selected,chain,stored,next});
  await scenario('V4 new approval cannot prepare another package once the funded child has uploaded liabilities',async()=>{
   const current=await sponsorAllocationReviewV4(actor,scope,undefined,rpc);
   const decision={requestId:next(),expectedApprovalId:current.approval.id,contextHash:current.contextHash,documentHash:current.documentHash,decision:'approved'};
   await sponsorAllocationReviewV4(actor,scope,decision,rpc);
   const nextScope={...scope,approvalId:decision.requestId};
   await chain.testClient.mine({blocks:96,interval:1});
   await assert.rejects(()=>sponsorUploadV4(actor,nextScope,{requestId:next(),contextHash:current.contextHash,documentHash:current.documentHash},
    {rpc,reader:chain.publicClient}),{code:'reward_sponsor_funding_not_ready'});
   assert.equal(await count(),1);
  });
  await scenario('V4 upload persistence is private, immutable and refuses foreign approval scopes',async()=>{
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_sponsor_uploads_v4','SELECT,INSERT,UPDATE,DELETE')`),false);
   assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_sponsor_uploads_v4','UPDATE,DELETE')"),false);
   await assert.rejects(()=>query('delete from app_private.reward_sponsor_uploads_v4'),/reward_result_review_immutable/);
   await assert.rejects(()=>sponsorUploadFactsV4(actor,{...selected,slot:2},undefined,rpc),{code:'reward_sponsor_approval_not_found'});
   for(const fn of ['service_read_reward_sponsor_upload_v4(uuid,uuid,integer,uuid,integer,uuid)','service_prepare_reward_sponsor_upload_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb)']){
    for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.${fn}','execute')`),false);
    assert.equal(await scalar(`select prosecdef from pg_proc where oid='public.${fn}'::regprocedure`),false);
   }
  });
  return {assertHeld:async()=>{
   await scenario('V4 held-source retries recover saved upload history without new chain IO or making the package current',async()=>{
    const v=await save(request,{getChainId:()=>{throw Error('Historical retry must not query chain');}});
    assert.equal(v.current,false);assert.deepEqual(v.prepared,view.prepared);assert.equal(await count(),1);assert.equal(v.stageReady,false);
   });
  }};
 }finally{await chain.stop();}
}
