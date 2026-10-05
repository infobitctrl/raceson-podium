import assert from "node:assert/strict";
import test from "node:test";
import { readRewardAthleteReviewContext, recordRewardAthleteReview, revokeRewardAthleteReview, decodeRewardReadinessAttestation } from "../../../packages/db/dist/rewards/index.js";
import { reviewAthleteRewardReadiness } from "../dist/features/rewards/athlete-readiness-service.js";

import { readinessFixture as fixture, readinessId as id } from "./fixtures/reward-readiness.mjs";
test("operator readiness review re-verifies historical wallet proof and preserves the reviewed version, not current values",async()=>{
  const f=await fixture();f.context.profileFingerprintSha256="b".repeat(64);
  const r=await reviewAthleteRewardReadiness(f.identity,f.input,{...f.config,rpc:f.rpc});
  assert.equal(r.reviewId,id(14));assert.equal(f.calls[1].args.p_expected_profile_fingerprint,"a".repeat(64));
  assert.equal(f.calls[1].args.p_expected_revision,0);
  assert.deepEqual(f.calls.map(c=>c.name),["service_read_reward_athlete_review_context","service_record_reward_athlete_review"]);
  assert.doesNotMatch(JSON.stringify(f.calls[1].args),/signature|amount|nonce|privateKey/);
});
test("missing, tampered and cross-network proofs cannot become reviewed destinations",async()=>{
  for(const mutate of [f=>{f.context.challenge.proof=null;},f=>{f.context.challenge.proof.signature=`0x${"ff".repeat(65)}`;},
    f=>{f.context.challenge.proof.messageHash=`0x${"ab".repeat(32)}`;},f=>{f.config.chainId=10143;},f=>{f.config.origin="http://localhost:5173";}]){
    const f=await fixture();mutate(f);await assert.rejects(reviewAthleteRewardReadiness(f.identity,f.input,{...f.config,rpc:f.rpc}));assert.equal(f.calls.length,1);
  }
});
test("readiness evidence is strict operator attestation, not a browser boolean, partial checklist or provider claim",()=>{
  for(const value of [null,{approved:true},{schemaVersion:1},
    {schemaVersion:1,policy:"privy-mfa-ready",verifiedDateOfBirth:"1990-01-01",identityEvidenceRef:id(10),adultEvidenceRef:id(11),walletMfaEvidenceRef:id(12),walletRecoveryEvidenceRef:id(13)}])
    assert.throws(()=>decodeRewardReadinessAttestation(value));
});
test("readiness decoder rejects foreign, corrupt and contradictory reviewed contexts",async()=>{
  const f=await fixture();
  for(const patch of [{programmeId:id(90)},{operatorUserId:id(90)},{chainId:143},{dateOfBirth:"2001-02-29"},
    {reviewState:"approved"},{reviewState:"reviewed"},{reviewState:"revoked"},{reviewState:"profile_changed"},
    {reviewState:"request_withdrawn"},{reviewState:"reviewed",latestReview:{...f.review,revokedAt:"2026-09-08T09:00:02Z",revocationReason:"operator_correction"}},
    {latestReview:{...f.review,requestId:id(90)}}])
    await assert.rejects(readRewardAthleteReviewContext(f.identity,id(9),id(7),async()=>({data:{...f.context,...patch},error:null})));
  const ready=await readRewardAthleteReviewContext(f.identity,id(9),id(7),async()=>({data:{...f.context,latestReview:f.review,reviewState:"reviewed"},error:null}));
  assert.equal(ready.reviewState,"reviewed");
});
test("stored review response must match exact scope, evidence, retry key and revision",async()=>{
  const f=await fixture();
  for(const patch of [{requestId:id(90)},{programmeId:id(90)},{reviewedByUserId:id(90)},{revision:2},{idempotencyKey:"different-key"},
    {profileFingerprintSha256:"b".repeat(64)},{attestation:{...f.input.attestation,adultEvidenceRef:id(90)}},
    {revokedAt:"2026-09-08T08:00:00Z",revocationReason:"operator_correction"}])
    await assert.rejects(recordRewardAthleteReview(f.identity,f.input,async()=>({data:{...f.review,...patch},error:null})));
});
test("new-session review history and exact retries do not undo revocation",async()=>{
  const f=await fixture();f.review.reviewedSessionId=id(90);f.review.revokedAt="2026-09-08T09:00:02Z";f.review.revocationReason="operator_correction";
  assert.equal((await reviewAthleteRewardReadiness(f.identity,f.input,{...f.config,rpc:f.rpc})).revokedAt,f.review.revokedAt);
  assert.equal((await revokeRewardAthleteReview(f.identity,{programmeId:id(9),reviewId:id(14),reason:"operator_correction"},f.rpc)).reviewId,id(14));
  await assert.rejects(revokeRewardAthleteReview(f.identity,{programmeId:id(9),reviewId:id(14),reason:"operator_correction"},async()=>({data:{...f.review,revokedAt:null,revocationReason:null},error:null})));
});
test("review freezes operator identity and explicit attestation before async context reads",async()=>{
  const f=await fixture();const rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name==="service_read_reward_athlete_review_context"){
    f.identity.userId=id(90);f.input.attestation.adultEvidenceRef=id(90);f.input.expectedProfileFingerprintSha256="b".repeat(64);
  }return r;};
  // Preserve the stored response independently of the mutable caller fixture.
  f.review.attestation=structuredClone(f.input.attestation);
  assert.equal((await reviewAthleteRewardReadiness(f.identity,f.input,{...f.config,rpc})).attestation.adultEvidenceRef,id(11));
});
test("readiness storage errors expose bounded codes and never private SQL details",async()=>{
  const f=await fixture();
  for(const message of ["reward_account_session_required","reward_operator_permission_required","reward_readiness_revision_changed","reward_readiness_profile_changed","reward_readiness_hold"])
    await assert.rejects(recordRewardAthleteReview(f.identity,f.input,async()=>({data:null,error:{message}})),{code:message});
  await assert.rejects(recordRewardAthleteReview(f.identity,f.input,async()=>({data:null,error:{message:"private date of birth and evidence details"}})),{code:"reward_ledger_store_failed"});
});
