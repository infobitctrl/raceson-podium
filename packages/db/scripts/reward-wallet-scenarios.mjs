import assert from "node:assert/strict";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRewardWalletChallenge,readRewardWalletChallenge,confirmRewardWalletProof,readOwnRewardAwards } from "../dist/rewards/index.js";
import { prepareAthleteWalletProof,verifyAthleteWalletProof as verifyService } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
const verifyAthleteWalletProof=(identity,input,rpc)=>verifyService(identity,input,{chainId:31337,origin:"http://127.0.0.1:5173",rpc});
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { destinationScenarios } from "./reward-destination-scenarios.mjs";
import { readinessScenarios } from "./reward-readiness-scenarios.mjs";
import { walletOriginCases } from "../../../apps/api/test/fixtures/reward-wallet-origins.mjs";

export async function walletScenarios({harness,scenario,roleBefore,programmeId}){
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  const identity={userId:id(4),sessionId:id(99001)};const other={userId:id(5),sessionId:id(99002)};
  // Non-usable local session rows, not JWTs or credentials. Existing synthetic
  // users own no real profile or asset. Do not run outside the guarded scratch DB.
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour');`);
  const signer=privateKeyToAccount(toHex(991n,{size:32}));const address=signer.address.toLowerCase();const origin="http://127.0.0.1:5173";
  const input={chainId:31337,address,origin,idempotencyKey:"wallet-sql-first"};let prepared,signature,proof;

  await scenario("wallet challenge and real EOA proof bind the existing account/session and consume once under concurrent retries",async()=>{
    const [a,b]=await Promise.all([createRewardWalletChallenge(identity,input,rpc),createRewardWalletChallenge(identity,input,rpc)]);
    assert.equal(a.challengeId,b.challengeId);assert.equal(a.nonce,b.nonce);assert.equal(a.nonce.length,64);
    assert.equal(await scalar("select count(*) from app_private.reward_wallet_challenges"),1);
    await assert.rejects(createRewardWalletChallenge(identity,{...input,address:privateKeyToAccount(toHex(992n,{size:32})).address.toLowerCase()},rpc),{code:"reward_ledger_idempotency_conflict"});
    await assert.rejects(readRewardWalletChallenge(other,a.challengeId,rpc),{code:"reward_wallet_challenge_not_found"});
    await assert.rejects(readRewardWalletChallenge({...identity,sessionId:other.sessionId},a.challengeId,rpc),{code:"reward_account_session_required"});
    prepared=await prepareAthleteWalletProof(identity,{address,idempotencyKey:input.idempotencyKey},{chainId:31337,origin,rpc});
    signature=await signer.signMessage({message:prepared.message});
    const results=await Promise.all([verifyAthleteWalletProof(identity,{challengeId:a.challengeId,signature},rpc),verifyAthleteWalletProof(identity,{challengeId:a.challengeId,signature},rpc)]);
    assert.deepEqual(results[0],results[1]);proof=results[0];assert.equal(proof.address,address);
    assert.equal(await scalar("select count(*) from app_private.reward_wallet_proofs"),1);
    await assert.rejects(query(`update app_private.reward_wallet_challenges set address='0x${"11".repeat(20)}' where id=${literal(a.challengeId)};`),{code:"reward_ledger_is_immutable"});
    await assert.rejects(query(`delete from app_private.reward_wallet_proofs where id=${literal(proof.proofId)};`),{code:"reward_ledger_is_immutable"});
    await assert.rejects(confirmRewardWalletProof(identity,{challengeId:a.challengeId,messageHash:`0x${"ab".repeat(32)}`,signature},rpc),{code:"reward_ledger_idempotency_conflict"});
  });

  await scenario("wallet writes recheck expired/revoked sessions after blocked locks and enforce account-level challenge limits",async()=>{
    const unlock=await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-wallet-account:${identity.userId}`)},0));
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=[createRewardWalletChallenge(identity,{...input,idempotencyKey:"wallet-expired-wait"},rpc),
      verifyAthleteWalletProof(identity,{challengeId:prepared.challengeId,signature},rpc)].map(p=>assert.rejects(p,{code:"reward_account_session_required"}));
    pending.forEach(p=>p.catch(()=>{}));try{await waiting(2);}finally{await unlock();}await Promise.all(pending);
    assert.equal(await scalar("select count(*) from app_private.reward_wallet_proofs"),1);
    await assert.rejects(readOwnRewardAwards(identity,null,rpc),{code:"reward_account_session_required"});
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)};`);
    // Natural expiry while blocked must use wall-clock time, not SQL now()
    // captured when the waiting statement began. The query is already waiting
    // before the short fixture session expires; no production clock changes.
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '4 seconds' where id=${literal(identity.sessionId)};`);
    const releaseExpiry=await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-wallet-account:${identity.userId}`)},0))`);
    const naturalExpiry=assert.rejects(createRewardWalletChallenge(identity,{...input,idempotencyKey:"wallet-natural-expiry"},rpc),{code:"reward_account_session_required"});
    naturalExpiry.catch(()=>{});
    try{await waiting(1);await new Promise(resolve=>setTimeout(resolve,4500));}finally{await releaseExpiry();}
    await naturalExpiry;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)};`);
    await query(`begin;update auth.users set is_anonymous=true where id=${literal(identity.userId)};
      do $$ begin begin perform public.service_read_own_reward_awards(${literal(identity.userId)},${literal(identity.sessionId)},null);
        raise exception 'Anonymous account was accepted';exception when insufficient_privilege then null;end;end $$;rollback;`);
    await query(`begin;update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=${literal(identity.userId)};
      do $$ begin begin perform public.service_read_own_reward_awards(${literal(identity.userId)},${literal(identity.sessionId)},null);
        raise exception 'Banned account was accepted';exception when insufficient_privilege then null;end;end $$;rollback;`);
    for(let n=1;n<10;n++)await createRewardWalletChallenge(identity,{...input,idempotencyKey:`wallet-rate-key-${n}`},rpc);
    await assert.rejects(createRewardWalletChallenge(identity,{...input,idempotencyKey:"wallet-rate-overflow"},rpc),{code:"reward_wallet_rate_limited"});
    assert.equal((await createRewardWalletChallenge(identity,input,rpc)).challengeId,prepared.challengeId,"Exact retry is not a fresh rate-limit slot");
    // An immutable expired fixture tests the exact SQL boundary without changing
    // an existing challenge's timestamps or waiting ten real minutes.
    await query(`insert into app_private.reward_wallet_challenges(id,user_id,session_id,chain_id,address,origin,issued_at,expires_at,idempotency_key)
      values(${literal(id(99003))},${literal(identity.userId)},${literal(identity.sessionId)},31337,${literal(address)},${literal(origin)},
      date_trunc('second',clock_timestamp())-interval '11 minutes',date_trunc('second',clock_timestamp())-interval '1 minute','wallet-expired-fixture');`);
    await assert.rejects(confirmRewardWalletProof(identity,{challengeId:id(99003),messageHash:`0x${"ab".repeat(32)}`,signature},rpc),{code:"reward_wallet_challenge_expired"});
  });

  await scenario("late profile ownership reveals only its reserved athlete allocations and never converts editable age into verified adulthood",async()=>{
    const before=await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
    assert.deepEqual(await readOwnRewardAwards(identity,null,rpc),{items:[],nextCursor:null});
    const forProfile=async(setup)=>readOwnRewardAwards(identity,null,async(name,args)=>({data:JSON.parse(await query(`begin;${setup};${rpcSql(name,args)}rollback;`)),error:null}));
    const own=`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${literal(identity.userId)},date_of_birth='1990-01-01' where id=${literal(id(1000))}`;
    const mine=await forProfile(own);assert.equal(mine.items.length,6);assert(mine.items.every(a=>a.athleteProfileId===id(1000) && !a.identityChanged && a.ageStatus==="unverified_adult"));
    const minor=await forProfile(`${own};update public.athlete_profiles set date_of_birth=current_date-interval '12 years',birth_year=extract(year from current_date-interval '12 years') where id=${literal(id(1000))}`);
    assert(minor.items.every(a=>a.ageStatus==="minor"));assert.deepEqual(minor.items.map(a=>a.amountWei),mine.items.map(a=>a.amountWei));
    const unknown=await forProfile(`${own};update public.athlete_profiles set date_of_birth=null where id=${literal(id(1000))}`);assert(unknown.items.every(a=>a.ageStatus==="unknown"));
    const transferred=await forProfile(`${own};update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(id(1000))}`);assert.deepEqual(transferred.items,[]);
    const merged=await forProfile(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${literal(identity.userId)},date_of_birth='1990-01-01' where id=${literal(id(1006))};
      update public.athlete_profiles set status='merged',merged_into_athlete_profile_id=${literal(id(1006))} where id=${literal(id(1000))}`);
    assert.equal(merged.items.length,6);assert(merged.items.every(a=>a.athleteProfileId===id(1006) && a.identityChanged));
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),before);
    // Positive service-role proof uses the existing local BYPASSRLS simulation
    // only inside rollback, then independently checks original role state.
    const roleResult=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_read_reward_wallet_challenge",{p_user_id:identity.userId,p_session_id:identity.sessionId,p_challenge_id:prepared.challengeId})}rollback;`));
    assert.equal(roleResult.proof.proofId,proof.proofId);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });
  await destinationScenarios({harness,scenario,identity,other,signer,prepared,proof,roleBefore});
  await readinessScenarios({harness,scenario,identity,other,signer,programmeId,roleBefore});

  await scenario("demo wallet origin SQL matches browser policy and rejects new production proofs even on direct insert",async()=>{
    const values=walletOriginCases.map(([site,chain,allowed])=>`(${literal(site)},${chain},${allowed})`).join(",");
    assert.equal(await scalar(`select count(*) from (values ${values}) as cases(origin,chain_id,allowed)
      where app_private.reward_demo_wallet_origin_allowed(origin,chain_id) is distinct from allowed`),0);
    for(const site of ["http://127.0.0.1:3102","https://reward-demo.invalid"]){
      const args={p_user_id:other.userId,p_session_id:other.sessionId,p_chain_id:10143,p_address:address,p_origin:site,p_idempotency_key:"testnet-origin-rollback"};
      const created=JSON.parse(await query(`begin;${rpcSql("service_create_reward_wallet_challenge",args)}rollback;`));
      assert.equal(created.chainId,10143);assert.equal(created.origin,site);assert.equal(created.proof,null);
    }
    await assert.rejects(query(`begin;select public.service_create_reward_wallet_challenge(${literal(other.userId)},${literal(other.sessionId)},
      10143,${literal(address)},'https://www.raceson.com','production-origin-denied');rollback;`),{code:"invalid_reward_wallet_request"});
    await assert.rejects(query(`begin;insert into app_private.reward_wallet_challenges(user_id,session_id,chain_id,address,origin,issued_at,expires_at,idempotency_key)
      values(${literal(other.userId)},${literal(other.sessionId)},10143,${literal(address)},'https://www.raceson.com',
      date_trunc('second',clock_timestamp()),date_trunc('second',clock_timestamp())+interval '10 minutes','production-direct-denied');rollback;`),{code:"invalid_reward_wallet_request"});
    assert.equal(await scalar("select has_function_privilege('authenticated','app_private.reward_demo_wallet_origin_allowed(text,integer)','EXECUTE')"),false);
  });
}
