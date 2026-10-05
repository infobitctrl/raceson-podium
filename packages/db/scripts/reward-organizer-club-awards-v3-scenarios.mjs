import assert from 'node:assert/strict';
import { listOrganizerClubAwardsV3 } from '../dist/rewards/index.js';
import { literal as q } from './reward-integration-fixture.mjs';
export async function organizerClubAwardsV3Scenarios({query,rpc,scope,operatorIdentity,owner,nomination,clubId,expectNoClubAward,sourceHoldSql}) {
  const read=(who=operatorIdentity,chainId=31337)=>listOrganizerClubAwardsV3(who,{chainId,uploadId:scope.uploadId},rpc);
  const denied=async(code,fn)=>{await query('savepoint organizer_club_denied;');try{await assert.rejects(fn,{code});}
    finally{await query('rollback to savepoint organizer_club_denied;');}};
  const page=await read();assert.equal(page.uploadId,scope.uploadId);assert.equal(page.draftId,scope.draftId);
  assert.equal(page.approvalId,scope.approvalId);assert.equal(page.slot,scope.slot);
  assert.equal(page.items.length===0,expectNoClubAward);
  if(!expectNoClubAward){const row=page.items.find(r=>r.clubId===clubId);assert.ok(row);
    assert.equal(row.nomination.requestId,nomination.requestId);assert.equal(row.nomination.status,'pending_review');assert.equal(row.claim,null);
    const expected=JSON.parse(await query(`select to_jsonb(amount_wei::text) from app_private.reward_allocation_recipients_v3
      where approval_id=${q(scope.approvalId)} and beneficiary_kind='club' and source_beneficiary_id=${q(clubId)};`));
    assert.equal(row.amountWei,expected);
  }
  assert.doesNotMatch(JSON.stringify(page),/signature|ownerIdentity|userId|sessionId|explanationSalt|snapshotSalt|EvidenceRef/);
  await denied('reward_club_readiness_scope_required',()=>read(owner));
  await denied('reward_club_readiness_scope_required',()=>read(operatorIdentity,10143));
  const signature='public.service_list_reward_organizer_club_awards_v3(uuid,uuid,integer,uuid,text)';
  for(const role of ['anon','authenticated']) assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}',${q(signature)},'EXECUTE'));`)),false);
  assert.equal(JSON.parse(await query(`select to_jsonb(prosecdef) from pg_proc where oid=${q(signature)}::regprocedure;`)),false);
  await query(`savepoint organizer_club_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operatorIdentity.sessionId)};`);
  await denied('reward_account_session_required',()=>read());await query('rollback to savepoint organizer_club_session;');
  await query(`savepoint organizer_club_source;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`}`);
  assert.deepEqual(await read(),page,'reserved award discovery is not a readiness decision');await query('rollback to savepoint organizer_club_source;');
  await query(`savepoint organizer_club_withdraw;insert into app_private.reward_club_treasury_withdrawals(request_id,session_id)
    values(${q(nomination.requestId)},${q(owner.sessionId)});`);
  if(!expectNoClubAward)assert.equal((await read()).items.find(r=>r.clubId===clubId).nomination.status,'withdrawn');
  await query('rollback to savepoint organizer_club_withdraw;');
}
