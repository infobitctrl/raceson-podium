import assert from 'node:assert/strict';
import {rewardReviewIssues} from '../dist/rewards/operations.js';
import {literal as q} from './reward-integration-fixture.mjs';

// Reuse synthetic local source fixtures through a temporary identity/source bridge.
// Only the upstream copied-catalogue reader is replaced; issue SQL, private ACLs,
// session checks, CAS, immutable history and the actual approval trigger are real.
// This runs exclusively in the PID-owned disposable migration-validation database.
export async function hostedIssuesScenarios({harness,scenario,actor,sponsor,scope,next,read,save,command}){
 const {query,scalar,rpc}=harness;
 const signatures=['app_private.read_reward_demo_copy_allocation(uuid,uuid,integer,uuid,integer,uuid)','app_private.require_reward_demo_copy_reviewer(uuid,uuid)'];
 const definitions=await Promise.all(signatures.map(s=>scalar(`select pg_get_functiondef(${q(s)}::regprocedure)`)));
 const hostedScope={...scope,chainId:10143},issues=(who=actor,change)=>rewardReviewIssues(who,hostedScope,change,rpc,true);
 try{
 await query(`create or replace function app_private.read_reward_demo_copy_allocation(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_setup_id uuid,p_slot integer,p_request_id uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$ begin
 if p_chain_id is distinct from 10143 then raise exception 'invalid_sponsor_allocation'; end if;
 return public.service_read_reward_sponsor_allocation_v4(p_actor_user_id,p_actor_session_id,31337,p_setup_id,p_slot,p_request_id); end $$;
 create or replace function app_private.require_reward_demo_copy_reviewer(p_user_id uuid,p_session_id uuid) returns void language plpgsql volatile security definer set search_path='' as $$ begin perform app_private.require_reward_account(p_user_id,p_session_id);end $$;`);
 await scenario('hosted flags enforce scope, exact retries and author-only withdrawal; block actual approval insert',async()=>{
 const initial=await issues(),before=await read();assert.equal(initial.revision,0);assert(initial.canReport);
 await assert.rejects(()=>issues(sponsor),/reward_planning_not_found/);
 await assert.rejects(()=>issues({...actor,sessionId:next()}),/session_required/);
 const change={action:'report',requestId:next(),expectedRevision:0,contextHash:initial.contextHash,description:'Synthetic hosted issue: confirm the official category.'};
 const flagged=await issues(actor,change);assert.equal(flagged.issues.length,1);assert(flagged.issues[0].canWithdraw);
 assert.deepEqual(await issues(actor,change),flagged);
 await assert.rejects(()=>issues(actor,{...change,description:'Changed report'}),/reward_review_issue_conflict/);
 await assert.rejects(()=>save(command(before)),/reward_review_issue_open/);assert.equal((await read()).approval,null);
 await query(`insert into public.platform_administrators(user_id,platform_role) values(${q(sponsor.userId)},'super_admin')`);
 try{
 assert.equal((await issues(sponsor)).issues[0].canWithdraw,false);
 await assert.rejects(()=>issues(sponsor,{action:'withdraw',issueId:change.requestId,requestId:next(),expectedRevision:flagged.revision}),/reward_review_issue_not_owned/);
 }finally{await query(`delete from public.platform_administrators where user_id=${q(sponsor.userId)}`);}
 const withdrawal={action:'withdraw',issueId:change.requestId,requestId:next(),expectedRevision:flagged.revision};
 const cleared=await issues(actor,withdrawal);assert(cleared.issues[0].withdrawnAt);
 assert.deepEqual(await issues(actor,withdrawal),cleared);assert.deepEqual(await issues(actor,change),cleared);
 assert.equal((await read()).documentHash,before.documentHash);
 });
 await scenario('concurrent hosted reports serialize under the approval lock and reject stale revision',async()=>{
 const initial=await issues();const report=()=>({action:'report',requestId:next(),expectedRevision:initial.revision,contextHash:initial.contextHash,description:'Concurrent synthetic hosted reviewer report'});
 const results=await Promise.allSettled([issues(actor,report()),issues(actor,report())]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/reward_review_issue_conflict/);
 const flagged=await issues(),open=flagged.issues.find(i=>!i.withdrawnAt);await issues(actor,{action:'withdraw',issueId:open.id,requestId:next(),expectedRevision:flagged.revision});
 });
 await scenario('hosted issue insertion rolls back on session expiry and no browser or service table grant exists',async()=>{
 const initial=await issues(),change={action:'report',requestId:next(),expectedRevision:initial.revision,contextHash:initial.contextHash,description:'Synthetic expiry rollback validation'};
 await assert.rejects(()=>query(`begin; create function pg_temp.expire_hosted_issue_session() returns trigger language plpgsql as $$ begin update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(actor.sessionId)};return new;end $$;
 create trigger expire_hosted_issue_session after insert on app_private.reward_demo_copy_review_issue_events for each row execute function pg_temp.expire_hosted_issue_session();
 ${harness.rpcSql('service_reward_demo_copy_review_issues',{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:10143,p_setup_id:scope.setupId,p_slot:scope.slot,p_change:change})}rollback;`),/session_required/);
 assert.deepEqual(await issues(),initial);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_demo_copy_review_issue_events','SELECT,INSERT,UPDATE,DELETE')`),false);
 for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_demo_copy_review_issues(uuid,uuid,integer,uuid,integer,jsonb)','execute')`),false);
 assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.reward_demo_copy_review_issue_events'::regclass`),true);
 await assert.rejects(()=>query('delete from app_private.reward_demo_copy_review_issue_events'),/reward_result_review_immutable/);
 });
 }finally{for(const definition of definitions)await query(definition);}
}
