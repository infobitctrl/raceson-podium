import assert from "node:assert/strict";
import { readRewardAthleteReviewContext,recordRewardAthleteReview,revokeRewardAthleteReview } from "../dist/rewards/index.js";
import { reviewAthleteRewardReadiness } from "../../../apps/api/dist/features/rewards/athlete-readiness-service.js";
import { prepareAthleteWalletProof,verifyAthleteWalletProof } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
import { submitAthleteRewardDestination } from "../../../apps/api/dist/features/rewards/athlete-destination-service.js";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { organizerDiscoveryScenarios } from "./reward-organizer-discovery-scenarios.mjs";

export async function readinessScenarios({harness,scenario,identity,other,signer,programmeId,roleBefore}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;const config={chainId:31337,origin:"http://127.0.0.1:5173",rpc};
  const profile=id(1000);const total=await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const original=await scalar(`select jsonb_build_object('claimed',is_claimed,'owner',claimed_by_user_id,'dob',date_of_birth,'year',birth_year) from public.athlete_profiles where id=${literal(profile)}`);
  const attestation={schemaVersion:1,policy:"operator-observed-external-wallet-v1",verifiedDateOfBirth:"1990-01-01",
    identityEvidenceRef:id(99101),adultEvidenceRef:id(99102),walletMfaEvidenceRef:id(99103),walletRecoveryEvidenceRef:id(99104)};
  // Synthetic operator audit refs are not real identity/security approvals.
  let destination,input,review;let ownershipTransferred=false;
  const restoreOwnership=async()=>{
    if(!ownershipTransferred)return;
    // Exercise the existing transfer command in both directions. Never disable
    // the active-owner guard, even in this parent-owned synthetic database.
    await query(`begin;
      update public.organization_memberships set role='admin',status='active',account_template_key='organization-admin',
        permission_keys=(select permission_keys from public.organization_memberships where id=${literal(id(9))}) where id=${literal(id(8))};
      select public.service_transfer_organization_ownership(${literal(id(1))},${literal(id(9))},${literal(id(8))},${literal(other.userId)});
      update public.organization_memberships set role='admin',status='active',account_template_key='organization-admin' where id=${literal(id(9))};
      update public.organization_memberships set permission_keys='{}'::text[] where id=${literal(id(8))};
      commit;`);
    ownershipTransferred=false;
  };
  const read=()=>readRewardAthleteReviewContext(identity,programmeId,destination.requestId,rpc);
  const nextInput=async key=>{const c=await read();return{programmeId,requestId:destination.requestId,
    expectedProfileFingerprintSha256:c.profileFingerprintSha256,expectedRevision:c.latestReview?.revision??0,attestation,idempotencyKey:key};};
  const http=async({method="GET",body,reviewId=null,actor=identity,chainId=31337,url=null}={})=>{
    const res={status:200,body:null,private:false};
    const path=`/api/v1/organizer/rewards/programmes/${programmeId}/destinations/${destination.requestId}/readiness${reviewId?`/${reviewId}/revoke`:""}`;
    assert.equal(await dispatchOrganizerRewardRoutes({method},res,new URL(url??path,config.origin),{
      config:()=>({...config,chainId}),requireIdentity:async()=>actor,rpc,readJsonBody:async()=>body,
      applyPrivateSessionHeaders:r=>{r.private=true;},sendSuccess:(r,data)=>{r.body=data;},
      sendError:(r,status,code,message)=>{r.status=status;r.body={error:{code,message}};},
    }),true);assert.equal(res.private,true);
    assert.doesNotMatch(JSON.stringify(res.body),/signature|proofId|sessionId|SessionId|userId|UserId|EvidenceRef|idempotencyKey|nonce|privateKey/);
    return res;
  };
  const reviewBody=async key=>{const {programmeId:ignoredProgramme,requestId:ignoredRequest,...body}=await nextInput(key);return body;};
  try {
    await query(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${literal(identity.userId)},date_of_birth=null where id=${literal(profile)}`);
    const c=await prepareAthleteWalletProof(identity,{address:signer.address,idempotencyKey:"wallet-rate-key-3"},config);
    await verifyAthleteWalletProof(identity,{challengeId:c.challengeId,signature:await signer.signMessage({message:c.message})},config);
    destination=await submitAthleteRewardDestination(identity,{challengeId:c.challengeId,athleteProfileId:profile,idempotencyKey:"readiness-destination"},config);
    // The browser projection intentionally excludes the stored proof ID; the
    // test-only DB setup reads it privately for rolled-back pagination fixtures.
    const distribution = await organizerDiscoveryScenarios({harness,scenario,identity,other,programmeId,destination:{...destination,
      proofId:await scalar(`select proof_id from app_private.reward_athlete_destination_requests where id=${literal(destination.requestId)}`)}});
    await scenario("readiness approval requires designated operator, complete reviewed evidence and adult profile; concurrent exact retry is immutable",async()=>{
      await assert.rejects(readRewardAthleteReviewContext(other,programmeId,destination.requestId,rpc),{code:"reward_operator_permission_required"});
      await assert.rejects(readRewardAthleteReviewContext(identity,programmeId,id(99199),rpc),{code:"reward_readiness_scope_required"});
      assert.equal((await read()).reviewState,"age_hold");
      await assert.rejects(recordRewardAthleteReview(identity,await nextInput("readiness-unknown"),rpc),{code:"reward_readiness_hold"});
      await query(`update public.athlete_profiles set date_of_birth=current_date-interval '12 years',birth_year=extract(year from current_date-interval '12 years') where id=${literal(profile)}`);
      assert.equal((await read()).reviewState,"age_hold");
      await assert.rejects(recordRewardAthleteReview(identity,await nextInput("readiness-minor"),rpc),{code:"reward_readiness_hold"});
      await query(`update public.athlete_profiles set date_of_birth='1990-01-01',birth_year=1990 where id=${literal(profile)}`);
      input=await nextInput("readiness-approved-first");assert.equal((await read()).reviewState,"unreviewed");
      await assert.rejects(recordRewardAthleteReview(identity,{...input,attestation:{...attestation,verifiedDateOfBirth:"1990-01-02"}},rpc),{code:"reward_readiness_profile_changed"});
      const [a,b]=await Promise.all([reviewAthleteRewardReadiness(identity,input,config),reviewAthleteRewardReadiness(identity,input,config)]);
      assert.deepEqual(a,b);review=a;assert.equal(a.revision,1);assert.equal((await read()).reviewState,"reviewed");
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_reviews"),1);
      await assert.rejects(query(`update app_private.reward_athlete_readiness_reviews set revision=2 where id=${literal(a.reviewId)}`),{code:"reward_ledger_is_immutable"});
      const granted=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql("service_read_reward_athlete_review_context",{p_programme_id:programmeId,p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_request_id:destination.requestId})}rollback;`));
      assert.equal(granted.reviewState,"reviewed");assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    });
    await scenario("readiness revocation is permanent for a revision; competing replacement reviews cannot overwrite each other",async()=>{
      const revoke={programmeId,reviewId:review.reviewId,reason:"wallet_security_changed"};
      const [a,b]=await Promise.all([revokeRewardAthleteReview(identity,revoke,rpc),revokeRewardAthleteReview(identity,revoke,rpc)]);
      assert.deepEqual(a,b);assert.equal((await read()).reviewState,"revoked");
      assert.equal((await reviewAthleteRewardReadiness(identity,input,config)).revokedAt,a.revokedAt);
      await assert.rejects(revokeRewardAthleteReview(identity,{...revoke,reason:"operator_correction"},rpc),{code:"reward_ledger_idempotency_conflict"});
      await assert.rejects(query(`delete from app_private.reward_athlete_readiness_revocations where review_id=${literal(review.reviewId)}`),{code:"reward_ledger_is_immutable"});
      const next=await nextInput("readiness-replacement-a");const results=await Promise.allSettled([
        recordRewardAthleteReview(identity,next,rpc),recordRewardAthleteReview(identity,{...next,idempotencyKey:"readiness-replacement-b"},rpc)]);
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(results.find(r=>r.status==="rejected").reason.code,"reward_readiness_revision_changed");
      assert.equal((await read()).latestReview.revision,2);assert.equal((await read()).reviewState,"reviewed");
    });
    await scenario("profile change-and-change-back and blocked ownership/session/operator changes cannot preserve or create readiness",async()=>{
      const before=await nextInput("readiness-stale-profile");
      await query(`update public.athlete_profiles set date_of_birth='1990-01-02' where id=${literal(profile)}`);
      await query(`update public.athlete_profiles set date_of_birth='1990-01-01' where id=${literal(profile)}`);
      assert.equal((await read()).reviewState,"profile_changed");
      assert.notEqual((await read()).profileFingerprintSha256,before.expectedProfileFingerprintSha256);
      await assert.rejects(recordRewardAthleteReview(identity,before,rpc),{code:"reward_readiness_profile_changed"});
      const fresh=await nextInput("readiness-ownership-wait");
      const release=await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profile)}`);
      const pending=assert.rejects(recordRewardAthleteReview(identity,fresh,rpc),{code:"reward_readiness_profile_changed"});pending.catch(()=>{});
      try{await waiting(1);}finally{await release();}await pending;assert.equal((await read()).reviewState,"identity_hold");
      await query(`update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(profile)}`);
      const latest=await nextInput("readiness-operator-wait");
      const unblock=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
        select public.service_transfer_organization_ownership(${literal(id(1))},${literal(id(8))},${literal(id(9))},${literal(identity.userId)})`);
      ownershipTransferred=true;
      const forbidden=assert.rejects(recordRewardAthleteReview(identity,latest,rpc),{code:"reward_operator_permission_required"});forbidden.catch(()=>{});
      try{await waiting(1);}finally{await unblock();}await forbidden;
      await restoreOwnership();
      const unlocked=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
      const expired=assert.rejects(recordRewardAthleteReview(identity,latest,rpc),{code:"reward_account_session_required"});expired.catch(()=>{});
      try{await waiting(1);}finally{await unlocked();}await expired;
      await assert.rejects(revokeRewardAthleteReview(identity,{programmeId,reviewId:review.reviewId,reason:"wallet_security_changed"},rpc),{code:"reward_account_session_required"});
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_reviews"),2);
    });
    let browserReview;
    await scenario("organizer HTTP reads exact private review scope, records explicit current evidence and retains idempotent history",async()=>{
      const preview=await http();assert.equal(preview.status,200);assert.equal(preview.body.reviewState,"profile_changed");
      assert.equal(preview.body.latestReview.revision,2);assert.equal(preview.body.dateOfBirth,"1990-01-01");
      assert.equal((await http({actor:other})).status,403);assert.equal((await http({chainId:10143})).status,404);
      const body=await reviewBody("readiness-http-approved");
      const first=await http({method:"POST",body});assert.equal(first.status,200);browserReview=first.body.review;
      assert.equal(browserReview.revision,3);assert.equal(browserReview.profileFingerprintSha256,body.expectedProfileFingerprintSha256);
      assert.deepEqual((await http({method:"POST",body})).body,first.body);
      assert.equal((await http()).body.reviewState,"reviewed");
      const stale=await http({method:"POST",body:{...body,idempotencyKey:"readiness-http-stale"}});
      assert.equal(stale.status,409);assert.equal(stale.body.error.code,"reward_readiness_revision_changed");
      assert.equal((await http({method:"POST",reviewId:review.reviewId,body:{reason:"operator_correction"}})).status,409);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_reviews"),3);
    });
    await scenario("organizer HTTP reads cannot return private profiles or distribution data after session or programme authority is revoked during a table-lock wait",async()=>{
      for(const url of [null,"/api/v1/organizer/rewards/programmes",`/api/v1/organizer/rewards/programmes/${programmeId}/destinations`]){
      for(const kind of ["session","operator"]){
        const change=kind==="session"?`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`:
          `select public.service_transfer_organization_ownership(${literal(id(1))},${literal(id(8))},${literal(id(9))},${literal(identity.userId)})`;
        const table=url==="/api/v1/organizer/rewards/programmes"?"public.league_seasons":"app_private.reward_athlete_destination_requests";
        const checkDistribution=kind==="operator"&&url===null;
        const release=await lock(`lock table ${table} in access exclusive mode;
          ${checkDistribution?"lock table app_private.reward_entitlements in access exclusive mode;":""}${change}`);
        if(kind==="operator")ownershipTransferred=true;
        const pending=http({url});pending.catch(()=>{});
        const distributionReads=checkDistribution?distribution.startRevocationChecks():[];
        try{await waiting(1+distributionReads.length);}finally{await release();}
        await Promise.all(distributionReads);
        const reply=await pending;
        if(kind==="operator"&&url==="/api/v1/organizer/rewards/programmes"&&reply.status===200){
          // The list's permission filter may see the committed transfer before
          // selecting any rows. An empty private page is then the correct result.
          assert.deepEqual(reply.body,{chainId:31337,items:[],nextCursor:null});
        }else{
          assert.equal(reply.status,kind==="session"?401:403,`${kind}: ${url??"readiness"}`);
          assert.deepEqual(Object.keys(reply.body),["error"]);
        }
        await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
        await restoreOwnership();
        if(checkDistribution)await distribution.checkRestoredAccess();
      }
      }
    });
    await scenario("organizer review and revocation writes roll back when the actual session expires while INSERT is blocked",async()=>{
      const countRevocations=await scalar("select count(*) from app_private.reward_athlete_readiness_revocations");
      const revokeBody={reason:"wallet_security_changed"};
      const release=await lock(`lock table app_private.reward_athlete_readiness_revocations in share mode;
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
      const pending=http({method:"POST",reviewId:browserReview.reviewId,body:revokeBody});pending.catch(()=>{});
      try{await waiting(1);}finally{await release();}
      assert.equal((await pending).status,401);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_revocations"),countRevocations);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
      const revoked=await http({method:"POST",reviewId:browserReview.reviewId,body:revokeBody});assert.equal(revoked.status,200);
      assert.ok(revoked.body.review.revokedAt);assert.equal((await http()).body.reviewState,"revoked");
      assert.deepEqual((await http({method:"POST",reviewId:browserReview.reviewId,body:revokeBody})).body,revoked.body);
      const body=await reviewBody("readiness-http-session-rollback");
      const releaseReview=await lock(`lock table app_private.reward_athlete_readiness_reviews in share mode;
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
      const pendingReview=http({method:"POST",body});pendingReview.catch(()=>{});
      try{await waiting(1);}finally{await releaseReview();}
      assert.equal((await pendingReview).status,401);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_reviews"),3);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
      assert.equal((await http()).body.reviewState,"revoked");
      assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
    });
    await scenario("withdrawal while approval waits leaves the address unusable and every reward reserved",async()=>{
      const next=await nextInput("readiness-withdrawal-wait");
      const release=await lock(`select public.service_withdraw_reward_athlete_destination(${literal(identity.userId)},${literal(identity.sessionId)},${literal(destination.requestId)})`);
      const pending=assert.rejects(recordRewardAthleteReview(identity,next,rpc),{code:"reward_readiness_hold"});pending.catch(()=>{});
      try{await waiting(1);}finally{await release();}await pending;
      assert.equal((await read()).reviewState,"request_withdrawn");
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_readiness_reviews"),3);
      assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
    });
  } finally {
    await restoreOwnership();
    await query(`update public.athlete_profiles set is_claimed=${original.claimed},claimed_by_user_id=${literal(original.owner)},
      date_of_birth=${literal(original.dob)},birth_year=${literal(original.year)} where id=${literal(profile)};
      update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
  }
}
