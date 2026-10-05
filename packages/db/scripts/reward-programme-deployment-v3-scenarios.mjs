import assert from "node:assert/strict";
import {rewardProgrammeApprovalV3,rewardProgrammeDeploymentV3} from "../dist/rewards/index.js";
import {prepareProgrammeDeploymentV3,programmeDeploymentPlanV3} from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import {literal as q} from "./reward-integration-fixture.mjs";
const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function programmeDeploymentV3Scenarios({harness,scenario,fixture}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness,{identity,draftId}=fixture;
  const current=await rewardProgrammeApprovalV3(identity,31337,draftId,undefined,rpc);
  // Reuse the actual legacy operator's nonce book, not a separate clean signer.
  const operator=await scalar("select operator_address from app_private.reward_operator_nonce_slots order by created_at limit 1");
  const terms={...current.approval.terms,operatorAddress:operator};
  const approved=await rewardProgrammeApprovalV3(identity,31337,draftId,{requestId:id(979000),expectedApprovalId:current.approval.id,contextHash:current.contextHash,terms},rpc);
  const input={chainId:31337,draftId,requestId:id(979001),approvalId:approved.approval.id,contextHash:approved.contextHash,maximumGasCostWei:10n**18n};
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337,p_draft_id:draftId,
    p_request_id:input.requestId,p_approval_id:input.approvalId,p_context_hash:input.contextHash,p_pending_nonce:"0",p_maximum_gas_cost_wei:input.maximumGasCostWei.toString()};
  const read=()=>rewardProgrammeDeploymentV3(identity,31337,draftId,undefined,rpc);
  const reserve=(patch={})=>rewardProgrammeDeploymentV3(identity,31337,draftId,{...input,pendingNonce:0n,...patch},rpc);
  const table="app_private.reward_programme_deployment_intents_v3";
  let saved,next;
  await scenario("V3 programme reservation requires the exact current approval and rejects stale scope without consuming a nonce",async()=>{
    assert.equal((await read()).intent,null);
    for(const patch of[{approvalId:id(979099)},{contextHash:"f".repeat(64)}])await assert.rejects(reserve(patch),{code:"reward_programme_approval_required"});
    assert.equal(await scalar(`select count(*) from ${table}`),0);
    next=BigInt(await scalar(`select (max(nonce)+1)::text from app_private.reward_operator_nonce_slots where chain_id=31337 and operator_address=${q(operator)}`));
  });
  await scenario("V3 scope drift after intent insertion rolls back both the reservation and its nonce slot",async()=>{
    const round=approved.workspace.mapping.rounds[0].roundId;
    const before=await scalar(`select jsonb_build_object('publicName',public_name) from public.league_round_events where id=${q(round)}`);
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_programme_scope_drift() returns trigger language plpgsql as $$ begin
        update public.league_round_events set public_name='Synthetic new source during deployment reservation' where id=${q(round)};
        return new; end $$;
      create trigger synthetic_programme_scope_drift after insert on ${table} for each row execute function pg_temp.synthetic_programme_scope_drift();
      ${rpcSql("service_reserve_reward_programme_deployment_v3",args)}rollback;`),/reward_programme_approval_required/);
    assert.equal(await scalar(`select count(*) from ${table}`),0);
    assert.equal(await scalar(`select count(*) from app_private.reward_operator_nonce_slots where programme_deployment_intent_id=${q(input.requestId)}`),0);
    assert.deepEqual(await scalar(`select jsonb_build_object('publicName',public_name) from public.league_round_events where id=${q(round)}`),before);
  });
  await scenario("V3 session expiry during an actual INSERT table wait rolls back the intent and the shared nonce",async()=>{
    const release=await lock(`lock table ${table} in share mode`);
    const pending=assert.rejects(query(rpcSql("service_reserve_reward_programme_deployment_v3",args)),/reward_account_session_required/);pending.catch(()=>{});
    try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`)}finally{await release()}
    await pending;assert.equal(await scalar(`select count(*) from ${table}`),0);
    assert.equal(await scalar(`select count(*) from app_private.reward_operator_nonce_slots where programme_deployment_intent_id=${q(input.requestId)}`),0);
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("V3 legitimate service-only reservation can insert both typed owners with no persistent role changes",async()=>{
    const before=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const value=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_reserve_reward_programme_deployment_v3",args)}rollback;`));
    assert.equal(value.intent.id,input.requestId);
    assert.equal(await scalar(`select count(*) from ${table}`),0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),before);
  });
  await scenario("V3 concurrent exact retries reserve one six-child programme after existing deployment/funding/lifecycle nonces",async()=>{
    const pair=await Promise.all([reserve(),reserve()]);assert.deepEqual(pair[0],pair[1]);saved=pair[0];
    assert.equal(saved.intent.nonce,next);assert.equal(saved.intent.current,true);assert.equal(await scalar(`select count(*) from ${table}`),1);
    assert.equal(await scalar(`select count(*) from app_private.reward_operator_nonce_slots where programme_deployment_intent_id=${q(input.requestId)}`),1);
    const recovered=await prepareProgrammeDeploymentV3(identity,input,{rpc,reader:{getChainId(){throw Error("must not query a new nonce")}}});
    assert.equal(recovered.status,"reserved");assert.deepEqual(recovered.plan,programmeDeploymentPlanV3(saved));
    assert.equal(recovered.plan.budgetWei,100000n*10n**18n);assert.equal(new Set(recovered.plan.campaignIds).size,6);
    assert.equal("deploymentTransactionHash" in recovered.plan,false);
  });
  await scenario("V3 changed request, gas ceiling or approval cannot reuse a reservation; nonce ownership remains bidirectional",async()=>{
    for(const patch of[{requestId:id(979002)},{maximumGasCostWei:1n}])await assert.rejects(reserve(patch),{code:"reward_programme_deployment_conflict"});
    await assert.rejects(query(`begin; insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_deployment_intent_id)
      values(31337,${q(operator)},${q((next+100n).toString())},${q(id(979099))});commit;`),/foreign key/);
    await assert.rejects(query(`begin;update ${table} set nonce=nonce+1;commit;`),/immutable/);
    await assert.rejects(query(`begin;delete from ${table};commit;`),/immutable/);
    assert.equal(await scalar(`select count(*) from ${table}`),1);
  });
  await scenario("V3 reservation and historical reads recheck an actually expired session after lock waits",async()=>{
    const release=await lock(`select pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:31337:'||${q(operator)},0))`);
    const pending=assert.rejects(query(rpcSql("service_reserve_reward_programme_deployment_v3",args)),/reward_account_session_required/);pending.catch(()=>{});
    try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`)}finally{await release()}
    await pending;await assert.rejects(read(),{code:"reward_account_session_required"});
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
    assert.equal((await read()).intent.id,input.requestId);
  });
  await scenario("V3 approved revision changes hold the original deployment and never reserve a replacement nonce",async()=>{
    await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)}`);
    const held=await prepareProgrammeDeploymentV3(identity,input,{rpc,reader:{getChainId(){throw Error("no RPC during history recovery")}}});
    assert.equal(held.status,"held");assert.equal(held.plan.deploymentNonce,next);assert.deepEqual(held.plan,programmeDeploymentPlanV3(saved));
    assert.equal(await scalar(`select count(*) from ${table}`),1);
    await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draftId)}`);
  });
  await scenario("V3 nonce table keeps browser grants closed and the service-only invoker read works without persistent role changes",async()=>{
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`),true);
    for(const role of["anon","authenticated"]){
      assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
      for(const fn of["public.service_read_reward_programme_deployment_v3(uuid,uuid,integer,uuid)","public.service_reserve_reward_programme_deployment_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,text)"]){
        assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`),false);
        assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`),false);
      }
    }
    const readArgs={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337,p_draft_id:draftId};
    const prior=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const value=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_read_reward_programme_deployment_v3",readArgs)}rollback;`));
    assert.equal(value.intent.id,input.requestId);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),prior);
  });
}
