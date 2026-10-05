import assert from "node:assert/strict";
import { readOwnRewardAllocationsV3 } from "../dist/rewards/index.js";
import { literal as q } from "./reward-integration-fixture.mjs";
import { athleteReadinessV3Scenarios } from "./reward-athlete-readiness-v3-scenarios.mjs";
import { clubReadinessV3Scenarios } from "./reward-club-readiness-v3-scenarios.mjs";
const id=n=>`8f000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

/** Disposable validation DB only. Synthetic identity linkage is rolled back;
 * no seed, saved pilot identity, genuine consent, wallet or payout is created. */
export async function athleteAllocationsV3Scenarios({harness,scenario,scope,operatorIdentity}) {
  await scenario("V3 historical club allocation joins private owner nomination, verified review and immutable holds",async()=>{
    await harness.rollbackFixture(async({query,rpc})=>clubReadinessV3Scenarios({query,rpc,scope,operatorIdentity}));
  });
  await scenario("V3 recipient access requires exact claimed profile, fresh session, current allocation and matching chain",async()=>{
    await harness.rollbackFixture(async({query,rpc})=>{
      const identity={userId:id(1),sessionId:id(2)},other={userId:id(3),sessionId:id(4)};
      await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
        (${q(identity.userId)},'v3-recipient@example.invalid','authenticated','authenticated','{}','{}',now(),now()),
        (${q(other.userId)},'v3-other@example.invalid','authenticated','authenticated','{}','{}',now(),now());
        update public.user_profiles set status='active' where user_id in (${q(identity.userId)},${q(other.userId)});
        insert into auth.sessions(id,user_id,not_after) values (${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour'),
        (${q(other.sessionId)},${q(other.userId)},clock_timestamp()+interval '1 hour');`);
      const read=(who=identity,chain=31337,after=null)=>readOwnRewardAllocationsV3(who,chain,after,rpc);
      assert.equal((await read()).items.length,0,"unclaimed synthetic shares are never assigned to a login");
      const rows=JSON.parse(await query(`select jsonb_agg(jsonb_build_object('id',source_beneficiary_id,'amount',amount_wei::text))
        from (select * from app_private.reward_allocation_recipients_v3 where approval_id=${q(scope.approvalId)}
          and beneficiary_kind='athlete' order by entitlement_id limit 2) r;`));
      for(const [index,row] of rows.entries()) await query(`insert into public.athlete_profiles
        (id,slug,first_name,last_name,display_name,status,is_claimed,claimed_by_user_id,birth_year,date_of_birth) values
        (${q(row.id)},${q('v3-allocation-fixture-'+index)},'Synthetic',${q('Recipient '+index)},'Synthetic allocation recipient','active',true,
        ${q(index===0?identity.userId:other.userId)},1990,'1990-01-01');`);
      const page=await read();assert.equal(page.items.length,1);assert.equal(page.items[0].athleteProfileId,rows[0].id);
      assert.equal(page.items[0].amountWei,rows[0].amount);assert.equal(page.items[0].ageStatus,"unverified_adult");
      assert.equal((await read(other)).items[0].athleteProfileId,rows[1].id);
      assert.equal((await read(identity,10143)).items.length,0);
      assert.equal((await read(identity,31337,page.items[0].entitlementId)).items.length,0);
      assert.doesNotMatch(JSON.stringify(page),/snapshotSalt|opaqueBeneficiary|explanationSalt|signature|privateKey|userId|sessionId/);
      await athleteReadinessV3Scenarios({query,rpc,scope,operatorIdentity,athleteIdentity:identity,otherIdentity:other,profileId:rows[0].id});
      for(const update of ["is_claimed=false","status='inactive'","claimed_by_user_id=null"]){
        await query(`savepoint held_profile;update public.athlete_profiles set ${update} where id=${q(rows[0].id)};`);
        assert.equal((await read()).items.length,0);await query("rollback to savepoint held_profile;");
      }
      await query(`update public.athlete_profiles set date_of_birth=current_date-interval '12 years',birth_year=extract(year from current_date-interval '12 years') where id=${q(rows[0].id)};`);
      assert.equal((await read()).items[0].ageStatus,"minor");
      await query(`update public.athlete_profiles set date_of_birth=null where id=${q(rows[0].id)};`);
      assert.equal((await read()).items[0].ageStatus,"unknown");
      await query(`savepoint revoked;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)};`);
      const revoked=await rpc("service_read_own_reward_allocations_v3",{p_user_id:identity.userId,p_session_id:identity.sessionId,p_chain_id:31337,p_after_id:null});
      assert.equal(revoked.error?.message,"reward_account_session_required");await query("rollback to savepoint revoked;");
      // A newer approval omitting this athlete hides the old allocation. The
      // original immutable row and value remain present, never paid or deleted.
      await query(`insert into app_private.reward_allocation_approvals_v3(id,draft_id,slot,previous_approval_id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id)
        select ${q(id(5))},draft_id,slot,id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id
        from app_private.reward_allocation_approvals_v3 where id=${q(scope.approvalId)};`);
      assert.equal((await read()).items.length,0);
      for(const role of ["anon","authenticated"]){
        assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_read_own_reward_allocations_v3(uuid,uuid,integer,text)','EXECUTE'));`)),false);
      }
    });
  });
}
