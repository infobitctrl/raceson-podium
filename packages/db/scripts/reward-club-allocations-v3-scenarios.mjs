import assert from "node:assert/strict";
import { listRewardClubAllocationsV3 } from "../dist/rewards/index.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id=n=>`8fc00000-0000-4000-8000-${String(n).padStart(12,"0")}`;

/** Rollback-only synthetic fixtures; no real membership, wallet or payout. */
export async function clubAllocationsV3Scenarios({query,rpc,scope,owner,other,profileId,clubId,expectNoClubAward,sourceHoldSql}){
  const read=(who=owner,chainId=31337,after=null)=>listRewardClubAllocationsV3(who,{chainId,clubId,after},rpc);
  const denied=async(code,fn)=>{await query("savepoint club_discovery_denied;");try{await assert.rejects(fn,{code});}
    finally{await query("rollback to savepoint club_discovery_denied;");}};
  const page=await read();assert.equal(page.clubId,clubId);
  assert.equal(page.items.length===0,expectNoClubAward);
  assert.equal((await read(owner,10143)).items.length,0);
  await denied("reward_club_owner_required",()=>read(other));
  const signature="public.service_list_reward_club_allocations_v3(uuid,uuid,integer,uuid,text)";
  for(const role of ["anon","authenticated"])
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}',${q(signature)},'EXECUTE'));`)),false);
  assert.equal(JSON.parse(await query(`select to_jsonb(prosecdef) from pg_proc where oid=${q(signature)}::regprocedure;`)),false);
  await query(`savepoint club_discovery_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(owner.sessionId)};`);
  await denied("reward_account_session_required",()=>read());await query("rollback to savepoint club_discovery_session;");
  await query(`savepoint club_discovery_owner;update public.athlete_profiles set claimed_by_user_id=${q(other.userId)} where id=${q(profileId)};`);
  await denied("reward_club_owner_required",()=>read());assert.deepEqual(await read(other),page);
  await query("rollback to savepoint club_discovery_owner;");
  if(expectNoClubAward)return;
  const award=page.items.find(a=>a.approvalId===scope.approvalId);assert.ok(award);
  assert.equal(award.slot,scope.slot);assert.equal(award.claimAccess,"not_prepared");assert.equal(award.claim,null);assert.equal(award.payment,null);
  assert.equal(award.uploadId,scope.uploadId);assert.equal(award.allocationRevision,"latest");
  const expected=JSON.parse(await query(`select jsonb_build_object('amount',amount_wei::text,'entitlement','0x'||encode(entitlement_id,'hex'))
    from app_private.reward_allocation_recipients_v3 where approval_id=${q(scope.approvalId)} and beneficiary_kind='club' and source_beneficiary_id=${q(clubId)};`));
  assert.equal(award.amountWei,expected.amount);assert.equal(award.entitlementId,expected.entitlement);
  assert.doesNotMatch(JSON.stringify(page),/snapshotSalt|opaqueBeneficiary|explanationSalt|signature|privateKey|userId|sessionId|ownerIdentity/);
  await query(`savepoint club_discovery_hold;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`}`);
  assert.deepEqual(await read(),page,"a sporting hold must not hide a club's reserved share");await query("rollback to savepoint club_discovery_hold;");
  // Deliberately synthetic history exercises 50/51 pagination and corrected
  // approvals. These fixture rows are never uploaded and always roll back.
  await query("savepoint club_discovery_pages;");
  for(let n=1;n<=51;n++)await query(`insert into app_private.reward_allocation_approvals_v3
    (id,draft_id,slot,previous_approval_id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id)
    select ${q(id(n))},draft_id,slot,${q(n===1?scope.approvalId:id(n-1))},context_hash,document_text,document_hash,funding_observation,approved_by_user_id
      from app_private.reward_allocation_approvals_v3 where id=${q(scope.approvalId)};
    insert into app_private.reward_allocation_recipients_v3(approval_id,beneficiary_kind,source_beneficiary_id,amount_wei)
      values(${q(id(n))},'club',${q(clubId)},${q(expected.amount)});`);
  const first=await read(),second=await read(owner,31337,first.nextCursor),combined=[...first.items,...second.items];
  assert.equal(first.items.length,50);assert.equal(first.nextCursor,first.items.at(-1).entitlementId);assert.equal(second.nextCursor,null);
  assert.equal(combined.length,page.items.length+51);assert.equal(new Set(combined.map(a=>a.entitlementId)).size,combined.length);
  assert.equal(combined.find(a=>a.approvalId===scope.approvalId).allocationRevision,"superseded");
  assert.equal(combined.find(a=>a.approvalId===id(51)).allocationRevision,"latest");
  assert.equal(combined.filter(a=>a.draftId===scope.draftId&&a.slot===scope.slot&&a.allocationRevision==="latest").length,1);
  await query("rollback to savepoint club_discovery_pages;");assert.deepEqual(await read(),page);
}
