import assert from "node:assert/strict";
import { requestRewardAthleteDestination,readRewardAthleteDestination,withdrawRewardAthleteDestination,listRewardAthleteDestinations } from "../dist/rewards/index.js";
import { submitAthleteRewardDestination } from "../../../apps/api/dist/features/rewards/athlete-destination-service.js";
import { prepareAthleteWalletProof,verifyAthleteWalletProof } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

export async function destinationScenarios({harness,scenario,identity,other,signer,prepared,proof,roleBefore}){
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  const config={chainId:31337,origin:"http://127.0.0.1:5173",rpc};
  const profile=id(1000);const input={athleteProfileId:profile,proofId:proof.proofId,idempotencyKey:"destination-sql-first"};
  const original=await scalar(`select jsonb_build_object('is_claimed',is_claimed,'claimed_by_user_id',claimed_by_user_id) from public.athlete_profiles where id=${literal(profile)}`);
  const total=await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  let selected;
  const own=()=>query(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${literal(identity.userId)} where id=${literal(profile)};`);
  const nextProof=async n=>{
    // Reuse an existing challenge-rate fixture slot, not a rate-limit bypass.
    const c=await prepareAthleteWalletProof(identity,{address:signer.address,idempotencyKey:`wallet-rate-key-${n}`},config);
    const signed=await signer.signMessage({message:c.message});
    const p=await verifyAthleteWalletProof(identity,{challengeId:c.challengeId,signature:signed},config);
    return{challenge:c,proof:p};
  };
  try{
    await scenario("destination selection requires claimed profile plus fresh session-bound proof and is immutable/idempotent under concurrent requests",async()=>{
      await assert.rejects(requestRewardAthleteDestination(identity,input,rpc),{code:"reward_destination_profile_required"});
      await own();
      await assert.rejects(requestRewardAthleteDestination(identity,{...input,proofId:id(99999)},rpc),{code:"reward_destination_proof_required"});
      const [a,b]=await Promise.all([requestRewardAthleteDestination(identity,input,rpc),requestRewardAthleteDestination(identity,input,rpc)]);
      assert.deepEqual(a,b);selected=a;assert.equal(a.status,"pending_review");assert.equal(a.address,signer.address.toLowerCase());
      const viaService=await submitAthleteRewardDestination(identity,{athleteProfileId:profile,challengeId:prepared.challengeId,idempotencyKey:input.idempotencyKey},config);
      assert.equal(viaService.requestId,a.requestId);assert.equal(viaService.status,"pending_review");
      await assert.rejects(readRewardAthleteDestination(other,a.requestId,rpc),{code:"reward_destination_not_found"});
      await assert.rejects(withdrawRewardAthleteDestination(other,a.requestId,rpc),{code:"reward_destination_not_found"});
      await assert.rejects(query(`update app_private.reward_athlete_destination_requests set athlete_profile_id=${literal(id(1001))} where id=${literal(a.requestId)};`),{code:"reward_ledger_is_immutable"});
      await assert.rejects(requestRewardAthleteDestination(identity,{...input,idempotencyKey:"reused-proof-new-key"},rpc),{code:"reward_ledger_idempotency_conflict"});
      const second=await nextProof(1);
      await assert.rejects(requestRewardAthleteDestination(identity,{...input,proofId:second.proof.proofId,idempotencyKey:"second-destination"},rpc),{code:"reward_destination_withdraw_first"});
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_destination_requests"),1);
      const granted=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql("service_read_reward_athlete_destination",{p_user_id:identity.userId,p_session_id:identity.sessionId,p_request_id:a.requestId})}rollback;`));
      assert.equal(granted.requestId,a.requestId);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    });
    await scenario("same-account new-session withdrawal is permanent and does not consume or redistribute rewards",async()=>{
      const refreshed={userId:identity.userId,sessionId:id(99004)};
      await query(`insert into auth.sessions(id,user_id,not_after) values(${literal(refreshed.sessionId)},${literal(refreshed.userId)},clock_timestamp()+interval '1 hour');
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)};`);
      await assert.rejects(withdrawRewardAthleteDestination(identity,selected.requestId,rpc),{code:"reward_account_session_required"});
      assert.equal((await readRewardAthleteDestination(refreshed,selected.requestId,rpc)).status,"pending_review");
      const [a,b]=await Promise.all([withdrawRewardAthleteDestination(refreshed,selected.requestId,rpc),withdrawRewardAthleteDestination(refreshed,selected.requestId,rpc)]);
      assert.deepEqual(a,b);assert.equal(a.status,"withdrawn");
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)};`);
      assert.equal((await requestRewardAthleteDestination(identity,input,rpc)).status,"withdrawn","Retry does not reactivate the old request");
      await assert.rejects(query(`delete from app_private.reward_athlete_destination_withdrawals where request_id=${literal(selected.requestId)};`),{code:"reward_ledger_is_immutable"});
      assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
    });
    await scenario("ownership and session changes while destination requests wait are rechecked, with old choices held rather than transferred",async()=>{
      const second=await nextProof(1);const secondInput={...input,proofId:second.proof.proofId,idempotencyKey:"destination-after-transfer"};
      const unlock=await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profile)}`);
      const pending=assert.rejects(requestRewardAthleteDestination(identity,secondInput,rpc),{code:"reward_destination_profile_required"});pending.catch(()=>{});
      try{await waiting(1);}finally{await unlock();}await pending;
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_destination_requests"),1);
      await own();const secondRequest=await requestRewardAthleteDestination(identity,secondInput,rpc);
      await query(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profile)};`);
      assert.equal((await readRewardAthleteDestination(identity,secondRequest.requestId,rpc)).status,"identity_hold");
      await assert.rejects(readRewardAthleteDestination(other,secondRequest.requestId,rpc),{code:"reward_destination_not_found"});
      assert.equal((await withdrawRewardAthleteDestination(identity,secondRequest.requestId,rpc)).status,"withdrawn");
      await own();const third=await nextProof(2);
      const release=await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-wallet-account:${identity.userId}`)},0));
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
      const expired=assert.rejects(requestRewardAthleteDestination(identity,{...input,proofId:third.proof.proofId,idempotencyKey:"destination-session-expired"},rpc),{code:"reward_account_session_required"});expired.catch(()=>{});
      try{await waiting(1);}finally{await release();}await expired;
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_destination_requests"),2);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)};`);
      // The expired, immutable SQL fixture is not a claimed cryptographic proof;
      // it exercises the SQL deadline independently of the service verifier.
      await query(`insert into app_private.reward_wallet_proofs(id,challenge_id,message_hash,signature,verified_at)
        select ${literal(id(99005))},id,decode(repeat('ab',32),'hex'),${literal(`0x${"11".repeat(65)}`)},issued_at+interval '1 second'
        from app_private.reward_wallet_challenges where id=${literal(id(99003))};`);
      await assert.rejects(requestRewardAthleteDestination(identity,{...input,proofId:id(99005),idempotencyKey:"destination-proof-expired"},rpc),{code:"reward_wallet_challenge_expired"});
      assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
    });
    await scenario("destination history survives a new login, isolates other accounts and follows its opaque cursor",async()=>{
      const refreshed={userId:identity.userId,sessionId:id(99004)};
      const page=await listRewardAthleteDestinations(refreshed,null,rpc);
      assert.equal(page.items.length,2);assert.equal(page.nextCursor,null);assert(page.items.every(d=>d.status==="withdrawn"));
      assert.deepEqual(await listRewardAthleteDestinations(other,null,rpc),{items:[],nextCursor:null});
      assert.deepEqual((await listRewardAthleteDestinations(refreshed,page.items[0].requestId,rpc)).items,page.items.slice(1));
      assert.deepEqual((await listRewardAthleteDestinations(refreshed,page.items[1].requestId,rpc)).items,[]);
      const granted=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql("service_list_reward_athlete_destinations",{p_user_id:refreshed.userId,p_session_id:refreshed.sessionId,p_after_id:null})}rollback;`));
      assert.equal(granted.items.length,2);
      await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(refreshed.sessionId)};`);
      await assert.rejects(listRewardAthleteDestinations(refreshed,null,rpc),{code:"reward_account_session_required"});
      assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    });
  }finally{
    await query(`update public.athlete_profiles set is_claimed=${original.is_claimed},claimed_by_user_id=${literal(original.claimed_by_user_id)} where id=${literal(profile)};
      update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)};`);
  }
}
