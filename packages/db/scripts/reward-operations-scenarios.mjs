import assert from 'node:assert/strict';
import {rewardReviewIssues,rewardSupportSettings} from '../dist/rewards/index.js';
import {literal as q} from './reward-integration-fixture.mjs';

export async function rewardOperationsScenarios({harness,scenario,actor,sponsor,scope,next,read,save,command}){
 const {rpc,query,scalar}=harness;
 await scenario('review issues persist, block SQL approval, require author withdrawal and preserve exact retries',async()=>{
  const first=await rewardReviewIssues(actor,scope,undefined,rpc),before=await read();
  assert.equal(first.revision,0);assert.equal(first.canReport,true);
  await assert.rejects(()=>rewardReviewIssues(sponsor,scope,undefined,rpc),/reward_planning_not_found/);
  const report={action:'report',requestId:next(),expectedRevision:0,contextHash:first.contextHash,description:'Synthetic review: verify this allocation before approving.'};
  const flagged=await rewardReviewIssues(actor,scope,report,rpc);
  assert.equal(flagged.issues.length,1);assert.equal(flagged.issues[0].canWithdraw,true);
  assert.deepEqual(await rewardReviewIssues(actor,scope,report,rpc),flagged);
  await assert.rejects(()=>rewardReviewIssues(actor,scope,{...report,description:'Changed retry content'},rpc),/reward_review_issue_conflict/);
  await assert.rejects(()=>save(command(before)),{code:'reward_review_issue_open'});
  assert.equal((await read()).approval,null);
  assert.equal(await scalar(`select count(*) from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=${q(scope.setupId)}`),0);
  await query(`insert into public.platform_administrators(user_id,platform_role) values(${q(sponsor.userId)},'super_admin')`);
  const other=await rewardReviewIssues(sponsor,scope,undefined,rpc);assert.equal(other.issues[0].canWithdraw,false);
  await assert.rejects(()=>rewardReviewIssues(sponsor,scope,{action:'withdraw',issueId:report.requestId,requestId:next(),expectedRevision:flagged.revision},rpc),/reward_review_issue_not_owned/);
  await query(`delete from public.platform_administrators where user_id=${q(sponsor.userId)}`);
  await assert.rejects(()=>rewardReviewIssues(actor,scope,{...report,requestId:next()},rpc),/reward_review_issue_conflict/);
  const withdraw={action:'withdraw',requestId:next(),expectedRevision:flagged.revision,issueId:report.requestId};
  const cleared=await rewardReviewIssues(actor,scope,withdraw,rpc);
  assert.ok(cleared.issues[0].withdrawnAt);assert.equal(cleared.issues[0].canWithdraw,false);
  assert.deepEqual(await rewardReviewIssues(actor,scope,withdraw,rpc),cleared);
  assert.deepEqual(await rewardReviewIssues(actor,scope,report,rpc),cleared,'retry must not reopen a withdrawn issue');
  assert.equal((await read()).documentHash,before.documentHash,'annotations do not change sporting facts or economics');
  const expire={...report,requestId:next(),expectedRevision:cleared.revision};
  await assert.rejects(()=>query(`begin;
   create function pg_temp.expire_issue_session() returns trigger language plpgsql as $$ begin update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)}; return new; end $$;
   create trigger expire_issue_session after insert on app_private.reward_review_issue_events for each row execute function pg_temp.expire_issue_session();
   ${harness.rpcSql('service_reward_review_issues',{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:scope.chainId,p_setup_id:scope.setupId,p_slot:scope.slot,p_change:expire})} rollback;`),/reward_account_session_required/);
  assert.deepEqual(await rewardReviewIssues(actor,scope,undefined,rpc),cleared,'expired session rolls the inserted event back');
  await assert.rejects(()=>query('delete from app_private.reward_review_issue_events'),/reward_result_review_immutable/);
 });
 await scenario('support settings enforce master/session authority, exact retry, CAS, strict amounts and immutable history',async()=>{
  await assert.rejects(()=>rewardSupportSettings(actor,undefined,rpc),/reward_master_admin_required/);
  await query(`insert into public.platform_administrators(user_id,platform_role) values(${q(actor.userId)},'super_admin')`);
  const empty=await rewardSupportSettings(actor,undefined,rpc);assert.equal(empty.revision,0);assert.equal(empty.settings.supportWallet,null);
  const settings={gasAlertWei:'2000000000000000000',supportWallet:'0x'+'ab'.repeat(20),supportLimitWei:'5000000000000000000'};
  const change={expectedRevision:0,requestId:next(),settings,reason:'Synthetic support settings verification'};
  const result=await rewardSupportSettings(actor,change,rpc);assert.equal(result.revision,1);assert.equal(result.history[0].changedBy,actor.userId);
  assert.deepEqual(await rewardSupportSettings(actor,change,rpc),result);
  await assert.rejects(()=>rewardSupportSettings(actor,{...change,requestId:next()},rpc),/reward_support_settings_conflict/);
  await assert.rejects(()=>rewardSupportSettings(actor,{...change,reason:'Changed retry reason'},rpc),/reward_support_settings_conflict/);
  await assert.rejects(()=>query(`begin;
   create function pg_temp.expire_support_session() returns trigger language plpgsql as $$ begin update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)}; return new; end $$;
   create trigger expire_support_session after insert on app_private.reward_support_changes for each row execute function pg_temp.expire_support_session();
   ${harness.rpcSql('service_reward_support_settings',{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_change:{...change,requestId:next(),expectedRevision:1}})} rollback;`),/reward_account_session_required/);
  assert.deepEqual(await rewardSupportSettings(actor,undefined,rpc),result);
  for(const bad of [{...settings,supportLimitWei:'1.5'},{...settings,gasAlertWei:-1},{...settings,supportWallet:null},{...settings,unknown:true}]){
   const raw=await rpc('service_reward_support_settings',{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_change:{...change,expectedRevision:1,requestId:next(),settings:bad}});
   assert.match(raw.error?.message??'',/invalid_reward_support_settings/);
  }
  await query(`update public.platform_administrators set is_active=false where user_id=${q(actor.userId)}`);
  await assert.rejects(()=>rewardSupportSettings(actor,undefined,rpc),/reward_master_admin_required/);
  await query(`update public.platform_administrators set is_active=true where user_id=${q(actor.userId)}; update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)}`);
  await assert.rejects(()=>rewardSupportSettings(actor,undefined,rpc),/reward_account_session_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(actor.sessionId)}; delete from public.platform_administrators where user_id=${q(actor.userId)}`);
  await assert.rejects(()=>query('delete from app_private.reward_support_changes'),/reward_result_review_immutable/);
  for(const table of ['reward_support_changes','reward_review_issue_events']){
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
   assert.equal(await scalar(`select has_table_privilege('service_role','app_private.${table}','UPDATE,DELETE')`),false);
  }
  for(const fn of ['service_reward_support_settings(uuid,uuid,jsonb)','service_reward_review_issues(uuid,uuid,integer,uuid,integer,jsonb)'])for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.${fn}','execute')`),false);
 });
}
