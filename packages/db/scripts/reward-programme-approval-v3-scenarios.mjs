import assert from "node:assert/strict";
import { rewardProgrammeApprovalV3 } from "../dist/rewards/index.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../domain/dist/rewards/programme-draft-v2.js";
import { rewardId as fixtureId } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { integrationFixtureSql, literal as q } from "./reward-integration-fixture.mjs";
const id=n=>fixtureId(n).replace("78000000-","79000000-");

export async function programmeApprovalV3Scenarios({harness,scenario}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  // This feature owns a separate synthetic identity/league namespace. Run after
  // the independent legacy workflow; never reset or reuse its revoked owners.
  await query(integrationFixtureSql().replaceAll("78000000-","79000000-")
    .replaceAll("reward-integration","approval-v3-integration")
    .replaceAll("Synthetic ","Synthetic approval V3 ")
    .replaceAll("synthetic-round-","synthetic-approval-v3-round-")
    .replaceAll("reward-operator@example.invalid","approval-operator@example.invalid")
    .replaceAll("reward-successor@example.invalid","approval-successor@example.invalid"));
  const draftId=id(978000),identity={userId:id(4),sessionId:id(978001)};
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337,p_draft_id:draftId};
  const terms={funderAddress:`0x${"a".repeat(40)}`,operatorAddress:`0x${"b".repeat(40)}`,reviewPeriods:Array(6).fill(86400)};
  const read=()=>rewardProgrammeApprovalV3(identity,31337,draftId,undefined,rpc);
  const approve=change=>rewardProgrammeApprovalV3(identity,31337,draftId,change,rpc);
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour');
    insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(id(4))});`);
  const initial=await read();
  const mapping={version:2,leagueCategories:[],rounds:initial.workspace.catalogue.rounds.map(r=>({slot:r.slot,roundId:r.id,categories:[]}))};
  assert.equal(mapping.rounds.length,5);
  const setMapping=m=>query(`select public.service_save_reward_mapping_v2(${q(identity.userId)},${q(identity.sessionId)},31337,${q(draftId)},
    (select coalesce(max(revision),0) from app_private.reward_source_mappings_v2 where draft_id=${q(draftId)}),1,
    (public.service_read_reward_mapping_v2(${q(identity.userId)},${q(identity.sessionId)},31337,${q(draftId)})->>'catalogueHash'),${q(JSON.stringify(m))}::jsonb);`);
  let decision;
  await scenario("V3 funding approval requires all five saved round scopes and is not inferred from rules",async()=>{
    assert.equal(initial.approval,null);assert.equal(initial.operationsEnabled,false);
    await assert.rejects(approve({requestId:id(978010),expectedApprovalId:null,contextHash:initial.contextHash,terms}),{code:"reward_programme_scope_incomplete"});
    const partial=structuredClone(mapping);partial.rounds[4].roundId=null;await setMapping(partial);
    const incomplete=await read();
    await assert.rejects(approve({requestId:id(978010),expectedApprovalId:null,contextHash:incomplete.contextHash,terms}),{code:"reward_programme_scope_incomplete"});
    // Direct service invocation must enforce completeness too, not only the TS repository.
    await assert.rejects(query(rpcSql("service_approve_reward_programme_v3",{...args,p_request_id:id(978010),p_expected_approval_id:null,p_context_hash:incomplete.contextHash,p_terms:terms})),/reward_programme_scope_incomplete/);
    await setMapping(mapping);const ready=await read();decision={requestId:id(978010),expectedApprovalId:null,contextHash:ready.contextHash,terms};
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_approvals_v3`),0);
  });
  await scenario("V3 exact approval persists once across simultaneous retries and binds previous approval",async()=>{
    const [first,retry]=await Promise.all([approve(decision),approve(decision)]);
    assert.equal(first.approval.id,decision.requestId);assert.deepEqual(first,retry);assert.equal(first.approval.current,true);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_approvals_v3`),1);
    for(const patch of[{terms:{...terms,operatorAddress:`0x${"c".repeat(40)}`}},{expectedApprovalId:id(978099)}])
      await assert.rejects(approve({...decision,...patch}),{code:"reward_programme_request_conflict"});
    const a={...decision,requestId:id(978011),expectedApprovalId:decision.requestId};
    const b={...a,requestId:id(978012),terms:{...terms,reviewPeriods:Array(6).fill(3600)}};
    const results=await Promise.allSettled([approve(a),approve(b)]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(results.find(r=>r.status==="rejected").reason.code,"reward_programme_request_conflict");
    const current=await read();decision=current.approval.id===a.requestId?a:b;
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_approvals_v3`),2);
  });
  await scenario("V3 funding snapshots exclude results, but scope and rule changes invalidate current approval",async()=>{
    const before=await read();
    const clean=await scalar(`select app_private.reward_programme_context_v3(${q(JSON.stringify(before.record))}::jsonb,${q(JSON.stringify(before.workspace))}::jsonb)`);
    const changed=structuredClone(before.workspace);
    changed.catalogue.rounds[0].status="active";
    changed.catalogue.rounds[0].races[0].publicationId=id(978088);changed.catalogue.rounds[0].races[0].resultCount=999;
    const same=await scalar(`select app_private.reward_programme_context_v3(${q(JSON.stringify(before.record))}::jsonb,${q(JSON.stringify(changed))}::jsonb)`);
    assert.deepEqual(clean,same);assert.doesNotMatch(JSON.stringify(clean),/"(?:publicationId|resultCount|athleteId|athleteProfileId|email|birthYear)":/);
    const round=mapping.rounds[4].roundId;
    await query(`update public.league_round_events set public_name='Synthetic approval scope changed' where id=${q(round)};`);
    const stale=await read();assert.equal(stale.approval.current,false);
    await assert.rejects(approve({...decision,requestId:id(978014),expectedApprovalId:decision.requestId}),{code:"reward_planning_revision_changed"});
    const recovered=await approve(decision);assert.equal(recovered.approval.current,false);
    const fresh={...decision,requestId:id(978014),expectedApprovalId:decision.requestId,contextHash:stale.contextHash};
    assert.equal((await approve(fresh)).approval.current,true);decision=fresh;
    await query(`update public.league_round_events set public_name=null where id=${q(round)};
      update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`);
    assert.equal((await read()).approval.current,false);
    await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draftId)};`);
  });
  await scenario("V3 approval rechecks revoked Auth after a real draft lock without leaving an approval",async()=>{
    const current=await read(),count=await scalar("select count(*) from app_private.reward_programme_approvals_v3");
    // Call SQL directly so it reaches the write lock before the session expires.
    const release=await lock(`select id from app_private.reward_planning_drafts where id=${q(draftId)} for update`);
    const pending=assert.rejects(query(rpcSql("service_approve_reward_programme_v3",{...args,p_request_id:id(978015),p_expected_approval_id:decision.requestId,
      p_context_hash:current.contextHash,p_terms:terms})),/reward_account_session_required/);pending.catch(()=>{});
    try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)};`)}finally{await release()}
    await pending;assert.equal(await scalar("select count(*) from app_private.reward_programme_approvals_v3"),count);
    await assert.rejects(read(),{code:"reward_account_session_required"});
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)};`);
  });
  await scenario("V3 approval rechecks organization authority after overlapping role revocation",async()=>{
    // Own organization: keep the role-revocation fixture independent of both
    // the preceding legacy workflow and this feature's approval owner.
    await query(`insert into public.organizations(id,slug,name,status,kind) values(${q(id(978030))},'synthetic-approval-authority','Synthetic approval authority','active','organizer');
      insert into public.organization_memberships(id,organization_id,user_id,role,status,membership_type)
        values(${q(id(978031))},${q(id(978030))},${q(identity.userId)},'owner','active','permanent');
      insert into public.leagues(id,organization_id,slug,name,status) values(${q(id(978032))},${q(id(978030))},'synthetic-approval-authority','Synthetic authority league','active');
      insert into public.league_seasons(id,league_id,year,name,status) values(${q(id(978033))},${q(id(978032))},2026,'Synthetic authority','active');
      insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
        values(${q(id(978034))},${q(id(978030))},${q(id(978033))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(identity.userId)});`);
    const ownRead=()=>rewardProgrammeApprovalV3(identity,31337,id(978034),undefined,rpc);
    const current=await ownRead(),count=await scalar("select count(*) from app_private.reward_programme_approvals_v3");
    const release=await lock(`update public.organization_memberships set expires_at=clock_timestamp()-interval '1 second' where id=${q(id(978031))}`);
    const pending=assert.rejects(query(rpcSql("service_approve_reward_programme_v3",{...args,p_draft_id:id(978034),p_request_id:id(978018),p_expected_approval_id:null,
      p_context_hash:current.contextHash,p_terms:terms})),/reward_planning_not_found/);pending.catch(()=>{});
    try{await waiting(1)}finally{await release()}await pending;
    assert.equal(await scalar("select count(*) from app_private.reward_programme_approvals_v3"),count);
    await assert.rejects(ownRead(),{code:"reward_planning_not_found"});
  });
  await scenario("V3 scope drift after insertion rolls back the approval and the changed source",async()=>{
    const before=await read(),count=await scalar("select count(*) from app_private.reward_programme_approvals_v3");
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_approval_drift() returns trigger language plpgsql as $$ begin
        update public.league_round_events set public_name='Synthetic trigger-induced scope drift' where id=${q(mapping.rounds[4].roundId)};
        return new; end $$;
      create trigger synthetic_approval_drift after insert on app_private.reward_programme_approvals_v3 for each row execute function pg_temp.synthetic_approval_drift();
      ${rpcSql("service_approve_reward_programme_v3",{...args,p_request_id:id(978019),p_expected_approval_id:decision.requestId,p_context_hash:before.contextHash,p_terms:terms})}
      rollback;`),/reward_planning_revision_changed/);
    assert.equal(await scalar("select count(*) from app_private.reward_programme_approvals_v3"),count);
    assert.deepEqual(await read(),before);
  });
  await scenario("V3 approval storage is immutable, RLS protected and service-only with safe malformed-input rejection",async()=>{
    const table="app_private.reward_programme_approvals_v3";
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`),true);
    await assert.rejects(query(`update ${table} set terms=terms`),/reward_result_review_immutable/);
    await assert.rejects(query(`delete from ${table}`),/reward_result_review_immutable/);
    for(const role of["anon","authenticated"]){
      assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
      for(const fn of["public.service_read_reward_programme_approval_v3(uuid,uuid,integer,uuid)","public.service_approve_reward_programme_v3(uuid,uuid,integer,uuid,uuid,uuid,text,jsonb)"]){
        assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`),false);
        assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`),false);
      }
      await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_programme_approval_v3",args)}rollback;`),/permission denied/);
    }
    const roleBefore=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const positive=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql("service_read_reward_programme_approval_v3",args)}rollback;`));
    assert.equal(positive.record.draftId,draftId);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    const current=await read();
    const writeAsService=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_approve_reward_programme_v3",{...args,p_request_id:id(978017),p_expected_approval_id:decision.requestId,p_context_hash:current.contextHash,p_terms:terms})}rollback;`));
    assert.equal(writeAsService.approval.current,true);assert.equal(writeAsService.approval.id,id(978017));
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    assert.equal((await read()).approval.id,decision.requestId);
    for(const patch of[{funderAddress:terms.operatorAddress},{reviewPeriods:[1,2]},{reviewPeriods:[0,0,0,0,0,-1]},{reviewPeriods:Array(6).fill(0.2)},{reviewPeriods:Array(6).fill("86400")}]){
      await assert.rejects(query(rpcSql("service_approve_reward_programme_v3",{...args,p_request_id:id(978016),p_expected_approval_id:decision.requestId,p_context_hash:current.contextHash,p_terms:{...terms,...patch}})),/invalid_reward_programme_approval/);
    }
  });
  return {identity,draftId};
}
