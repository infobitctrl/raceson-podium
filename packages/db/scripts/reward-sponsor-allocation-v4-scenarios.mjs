import {hostedIssuesScenarios} from './reward-hosted-issues-scenarios.mjs';
import {rewardOperationsScenarios} from './reward-operations-scenarios.mjs';
import {fixtureSigner} from "../../rewards-chain/integration/owned-chain.mjs";
import {sponsorUploadV4Scenarios} from "./reward-sponsor-upload-v4-scenarios.mjs";
import assert from 'node:assert/strict';
import {createDefaultRewardProgrammeDraftV2} from '../../domain/dist/rewards/programme-draft-v2.js';
import {createGuidedSetup,addGuidedGroup,bindGuidedSeason} from '../../domain/dist/rewards/guided-setup-editor.js';
import {createSponsorExecutionPlan} from '../../domain/dist/rewards/sponsor-execution.js';
import {rewardHistoricalSourceV3,rewardDistributionSetups,rewardSponsorLaunch,rewardSponsorExecution,sponsorAllocationFactsV4} from '../dist/rewards/index.js';
import {sponsorAllocationReviewV4,sponsorAllocationDocumentV4} from '../../../apps/api/dist/features/rewards/sponsor-allocation-v4-service.js';
import {publishedSnapshot,publishedMapping} from '../../../apps/api/test/fixtures/published-reward-v2.mjs';
import {integrationFixtureSql,literal as q} from './reward-integration-fixture.mjs';
const id=n=>`af000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function sponsorAllocationV4Scenarios({harness,scenario}){
 const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
 await query(integrationFixtureSql().replaceAll('78000000-','af000000-').replaceAll('reward-integration','sponsor-v4-integration')
  .replaceAll('Synthetic ','Synthetic sponsor V4 ').replaceAll('synthetic-round-','synthetic-sponsor-v4-round-')
  .replaceAll('reward-operator@example.invalid','sponsor-v4-organizer@example.invalid').replaceAll('reward-successor@example.invalid','sponsor-v4-sponsor@example.invalid'));
 const actor={userId:id(4),sessionId:id(980001)},sponsor={userId:id(5),sessionId:id(980002)},draftId=id(980000);
 const snapshot=publishedSnapshot();snapshot.results.forEach((r,i)=>r.clubId=snapshot.clubs[i%2].clubId);
 await query(`delete from public.organization_memberships where user_id=${q(sponsor.userId)};
 insert into auth.sessions(id,user_id,not_after) values(${q(actor.sessionId)},${q(actor.userId)},clock_timestamp()+interval '1 hour'),(${q(sponsor.sessionId)},${q(sponsor.userId)},clock_timestamp()+interval '1 hour');
 insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
 values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(actor.userId)});
 insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash) values(${q(id(3))},${q(id(1))},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));
 select public.service_save_reward_mapping_v2(${q(actor.userId)},${q(actor.sessionId)},31337,${q(draftId)},0,1,
 (public.service_read_reward_mapping_v2(${q(actor.userId)},${q(actor.sessionId)},31337,${q(draftId)})->>'catalogueHash'),${q(JSON.stringify(publishedMapping()))}::jsonb);`);
 let seq=981000;const next=()=>id(seq++);const hist=await rewardHistoricalSourceV3(actor,31337,draftId,undefined,rpc);
 const sourceDecision={slot:1,requestId:next(),expectedReviewId:null,contextHash:hist.contextHash,decision:'confirmed_final'};
 await rewardHistoricalSourceV3(actor,31337,draftId,sourceDecision,rpc);
 let c=createGuidedSetup(next);c.budgetMon='10';
 c=bindGuidedSeason(c,{draftId,catalogueHash:hist.workspace.catalogueHash,roundId:null,editionId:null,programmeName:'Synthetic sponsor league',eventName:'Synthetic season'},hist.workspace.catalogue);
 c=addGuidedGroup(c,c.guided.pots[1].nodeId,'athlete_standings',next,hist.workspace.catalogue.categories.find(c=>c.target==='individual'));
 c=addGuidedGroup(c,c.guided.pots[1].nodeId,'club_standings',next,hist.workspace.catalogue.categories.find(c=>c.target==='club'));
 c.root.children.forEach((p,i)=>p.shareBps=i===1?10000:0);c.root.children[1].children.forEach(g=>g.shareBps=5000);
 c.root.children[1].children[0].rule.sharesBps=[6000,3000,1000];c.root.children[1].children[1].rule.sharesBps=[6000,4000];
 const setupId=next();await rewardDistributionSetups(sponsor,31337,setupId,{requestId:next(),expectedRevision:0,configuration:c},rpc);
 const launch=(await rewardSponsorLaunch(sponsor,31337,setupId,{requestId:next(),expectedRevision:1},rpc)).launch;
 const plan=createSponsorExecutionPlan(launch,'0x'+'11'.repeat(20),{operator:fixtureSigner(0xA11CE).address.toLowerCase(),treasury:'0x'+'33'.repeat(20),reviewPeriods:[0,0,0,0,0,0]});
 await rewardSponsorExecution(sponsor,31337,setupId,{plan},rpc);
 const scope={chainId:31337,setupId,slot:1},read=()=>sponsorAllocationReviewV4(actor,scope,undefined,rpc),save=change=>sponsorAllocationReviewV4(actor,scope,change,rpc);
 const command=(view,decision='approved')=>({requestId:next(),expectedApprovalId:view.approval?.id??null,contextHash:view.contextHash,documentHash:view.documentHash,decision});
 const recipients=()=>query(`select beneficiary_kind,beneficiary_id,amount_wei,encode(entitlement_id,'hex') entitlement,encode(opaque_beneficiary_id,'hex') opaque from app_private.reward_sponsor_recipients_v4 where approval_id in(select id from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=${q(setupId)}) order by approval_id,beneficiary_id`);
 await hostedIssuesScenarios({harness,scenario,actor,sponsor,scope,next,read,save,command});
 await rewardOperationsScenarios({harness,scenario,actor,sponsor,scope,next,read,save,command});
 let initial,first;
 await scenario('V4 sponsor may fund permissionlessly but only source organizer reviews exact frozen awards',async()=>{
  await assert.rejects(()=>sponsorAllocationReviewV4(sponsor,scope,undefined,rpc),{code:'reward_planning_not_found'});
  await assert.rejects(()=>sponsorAllocationReviewV4(actor,{...scope,chainId:10143},undefined,rpc),{code:'reward_setup_not_found'});
  initial=await read();assert.deepEqual(initial.reasons,[]);assert.equal(initial.proposedWei,plan.caps[1]);assert.ok(initial.recipientCounts.athletes>0);
  const repeated=await read();assert.equal(repeated.documentHash,initial.documentHash);assert.equal(repeated.contextHash,initial.contextHash);
  assert.doesNotMatch(JSON.stringify(initial),/beneficiaryId|sourceRowIds|snapshotSalt|explanationSalt|opaqueBeneficiaryId|actorUserId/);
  first=command(initial);const [a,b]=await Promise.all([save(first),save(first)]);assert.equal(a.recorded.id,b.recorded.id);
  assert.equal(a.payableWei,'0');assert.equal(a.stageReady,false);
  const before=await recipients();await save(first);assert.equal(await recipients(),before);
  assert.equal(await scalar(`select count(*) from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=${q(setupId)}`),1);
  assert.equal(await scalar(`select sum(amount_wei)::text from app_private.reward_sponsor_recipients_v4 where approval_id=${q(first.requestId)}`),plan.caps[1]);
 });
 const uploadChecks=await sponsorUploadV4Scenarios({harness,scenario,actor,sponsor,scope,plan,first,next,draftId});
 await scenario('V4 concurrent decisions use CAS; historical retry cannot undo a later hold',async()=>{
  const current=await read(),a=command(current,'held'),b=command(current);
  const outcomes=await Promise.allSettled([save(a),save(b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'reward_sponsor_approval_conflict');
  const held=await save(command(await read(),'held')),retry=await save(first);
  assert.equal(retry.recorded.id,first.requestId);assert.equal(retry.approval.id,held.approval.id);assert.equal(retry.approval.decision,'held');
  await assert.rejects(()=>save({...first,decision:'held'}),{code:'reward_sponsor_approval_conflict'});
 });
 await scenario('V4 source drift after insertion rolls back approval and random recipient rows atomically',async()=>{
  const view=await read(),before=await recipients(),facts=await sponsorAllocationFactsV4(actor,scope,undefined,rpc);
  const document=sponsorAllocationDocumentV4(actor,scope,facts),change=command(view);
  const documentText=JSON.stringify(document,(_,v)=>typeof v==='bigint'?v.toString():v);
  const sql=rpcSql('service_review_reward_sponsor_allocation_v4',{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:31337,p_setup_id:setupId,p_slot:1,
   p_request_id:change.requestId,p_expected_approval_id:change.expectedApprovalId,p_context_hash:change.contextHash,p_document_text:documentText,p_decision:'approved'});
  await assert.rejects(()=>query(`begin;
   create function pg_temp.synthetic_sponsor_drift() returns trigger language plpgsql as $$ begin
    update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
   create trigger synthetic_sponsor_drift after insert on app_private.reward_sponsor_allocation_approvals_v4 for each row execute function pg_temp.synthetic_sponsor_drift();
   ${sql} rollback;`),/reward_planning_revision_changed/);
  assert.equal(await recipients(),before);assert.equal((await read()).documentHash,view.documentHash);
  assert.equal(await scalar(`select count(*) from app_private.reward_sponsor_allocation_approvals_v4 where id=${q(change.requestId)}`),0);
 });
 await scenario('V4 source hold invalidates awards and rejects stale writes; old immutable receipts remain history',async()=>{
  const before=await read(),stale=command(before);
  await rewardHistoricalSourceV3(actor,31337,draftId,{...sourceDecision,requestId:next(),expectedReviewId:sourceDecision.requestId,decision:'held'},rpc);
  const changed=await read();assert.equal(changed.approval.current,false);assert.ok(changed.reasons.includes('source_held'));
  await assert.rejects(()=>save(stale),{code:'reward_planning_revision_changed'});
  await assert.rejects(()=>save(command(changed)),{code:'reward_sponsor_source_not_ready'});
  assert.equal((await save(first)).recorded.current,false);
 });
 await uploadChecks.assertHeld();
 await scenario('V4 drafts edited after execution do not silently alter the approved launch',async()=>{
  const before=await read();await rewardDistributionSetups(sponsor,31337,setupId,{requestId:next(),expectedRevision:1,configuration:{...c,budgetMon:'20'}},rpc);
  assert.equal((await read()).documentHash,before.documentHash);assert.equal((await read()).budgetWei,plan.caps[1]);
 });
 await scenario('V4 session revoked during source lock wait cannot approve or add recipients',async()=>{
  const before=await read(),count=await scalar(`select count(*) from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=${q(setupId)}`);
  const release=await lock(`select id from app_private.reward_planning_drafts where id=${q(draftId)} for update`);
  const pending=assert.rejects(()=>save(command(before,'held')),{code:'reward_account_session_required'});pending.catch(()=>{});
  try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)}`);}finally{await release();}
  await pending;assert.equal(await scalar(`select count(*) from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=${q(setupId)}`),count);
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(actor.sessionId)}`);
 });
 await scenario('V4 recipient identities and immutable approvals have no browser grants',async()=>{
  for(const table of ['reward_sponsor_allocation_approvals_v4','reward_sponsor_recipients_v4']){
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
   assert.equal(await scalar(`select has_table_privilege('service_role','app_private.${table}','UPDATE,DELETE')`),false);
   await assert.rejects(()=>query(`delete from app_private.${table}`),/reward_result_review_immutable/);
  }
  for(const fn of ['service_read_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid)','service_review_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text)']){
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`),false);
   assert.equal(await scalar(`select prosecdef from pg_proc where oid='public.${fn}'::regprocedure`),false);
  }
  await query(`update public.organizations set status='suspended' where id=${q(id(1))}`);
  await assert.rejects(()=>sponsorAllocationFactsV4(actor,scope,undefined,rpc),{code:'reward_planning_not_found'});
 });
}
