import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { readReadinessV3, readAllocationUploadV3 } from "../dist/rewards/index.js";
import { prepareAthleteWalletProof, verifyAthleteWalletProof } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
import { submitAthleteRewardDestination, withdrawAthleteRewardDestination } from "../../../apps/api/dist/features/rewards/athlete-destination-service.js";
import { getAthleteReadinessV3, reviewAthleteReadinessV3, revokeAthleteReadinessV3 } from "../../../apps/api/dist/features/rewards/athlete-readiness-v3-service.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id=n=>`8f100000-0000-4000-8000-${String(n).padStart(12,"0")}`;

// Called only inside the parent's disposable rollback transaction, with already
// invented profile ownership. This is neither saved-demo nor genuine consent.
export async function athleteReadinessV3Scenarios({query,rpc,scope,operatorIdentity,athleteIdentity,otherIdentity,profileId}) {
  const deps={chainId:31337,origin:"http://127.0.0.1:5173",rpc};
  const signer=privateKeyToAccount(toHex(912345n,{size:32}));
  const challenge=await prepareAthleteWalletProof(athleteIdentity,{address:signer.address,idempotencyKey:"readiness-v3-wallet"},deps);
  const signature=await signer.signMessage({message:challenge.message});
  await verifyAthleteWalletProof(athleteIdentity,{challengeId:challenge.challengeId,signature},deps);
  const destination=await submitAthleteRewardDestination(athleteIdentity,{challengeId:challenge.challengeId,athleteProfileId:profileId,idempotencyKey:"readiness-v3-destination"},deps);
  const base={chainId:31337,uploadId:scope.uploadId,destinationId:destination.requestId};
  const read=(who=operatorIdentity,role="operator")=>readReadinessV3(who,{...base,role},rpc);
  const denied=async(code,fn)=>{await query("savepoint readiness_denied;");try{await assert.rejects(fn,{code});}finally{await query("rollback to savepoint readiness_denied;");}};
  const first=await read(),source=await readAllocationUploadV3(operatorIdentity,scope,rpc);
  assert.equal(source.current,true);assert.equal(first.source.current,true);assert.equal(first.state,"unreviewed");
  assert.equal(first.destination.userId,athleteIdentity.userId);assert.equal(first.source.operatorUserId,operatorIdentity.userId);
  assert.deepEqual((await read(athleteIdentity,"recipient")).source,first.source);
  await denied("reward_readiness_scope_required",()=>read(otherIdentity,"recipient"));
  await denied("reward_readiness_scope_required",()=>read(athleteIdentity,"operator"));
  await denied("reward_readiness_scope_required",()=>readReadinessV3(operatorIdentity,{...base,chainId:10143,role:"operator"},rpc));
  const input={...base,reviewId:id(1),previousReviewId:null,sourceGuardHash:first.source.sourceGuardHash,profileFingerprint:first.profileFingerprint,
    attestation:{schemaVersion:1,policy:"operator-observed-external-wallet-v1",verifiedDateOfBirth:"1990-01-01",
      identityEvidenceRef:id(11),adultEvidenceRef:id(12),walletMfaEvidenceRef:id(13),walletRecoveryEvidenceRef:id(14)}};
  // Validation-only policy probes inside this disposable rollback fixture.
  // The actual programme below remains local chain 31337, never relabelled.
  const privy={schemaVersion:2,policy:"operator-observed-privy-testnet-no-mfa-v1",chainId:10143,
    privyAppId:"cmtx921we00fu0cifaab7exez",verifiedDateOfBirth:"1990-01-01",identityEvidenceRef:id(11),adultEvidenceRef:id(12),
    walletProviderEvidenceRef:id(13),walletRecoveryEvidenceRef:id(14)};
  const validate=async(a,chain)=>query(`select app_private.require_reward_readiness_attestation_v3(${q(JSON.stringify(a))}::jsonb,${chain});`);
  await validate(privy,10143);await validate(input.attestation,31337);
  for(const [a,chain] of [[privy,31337],[privy,143],[{...privy,chainId:143},10143],[{...privy,privyAppId:"another-app"},10143],
    [{...privy,walletMfaEvidenceRef:id(13)},10143],[{...privy,walletProviderEvidenceRef:null},10143],
    [{...privy,walletRecoveryEvidenceRef:"00000000-0000-0000-0000-000000000000"},10143]]){
    await query("savepoint privy_policy_denied;");
    try { await assert.rejects(()=>validate(a,chain),/invalid_reward_readiness_review/); }
    finally { await query("rollback to savepoint privy_policy_denied;"); }
  }
  for(const field of ["identityEvidenceRef","adultEvidenceRef","walletRecoveryEvidenceRef","walletProviderEvidenceRef"]){
    const missing={...privy};delete missing[field];await query("savepoint privy_policy_missing;");
    try { await assert.rejects(()=>validate(missing,10143),/invalid_reward_readiness_review/); }
    finally { await query("rollback to savepoint privy_policy_missing;"); }
  }
  await denied("invalid_reward_readiness_review",()=>reviewAthleteReadinessV3(operatorIdentity,{...input,attestation:privy},deps));
  // Bypass the TypeScript guard in the test only, proving SQL independently
  // rejects the exception on the fixture's genuine 31337 upload.
  await query("savepoint privy_record_denied;");
  try { await assert.rejects(()=>query(`select public.service_record_reward_readiness_v3(${q(operatorIdentity.userId)},${q(operatorIdentity.sessionId)},31337,
    ${q(base.uploadId)},${q(base.destinationId)},${q(id(90))},null,${q(input.sourceGuardHash)},${q(input.profileFingerprint)},${q(JSON.stringify(privy))}::jsonb);`),/invalid_reward_readiness_review/); }
  finally { await query("rollback to savepoint privy_record_denied;"); }
  await denied("reward_readiness_profile_changed",()=>reviewAthleteReadinessV3(operatorIdentity,{...input,profileFingerprint:"0".repeat(64)},deps));
  await denied("invalid_reward_readiness_review",()=>reviewAthleteReadinessV3(operatorIdentity,{...input,attestation:{...input.attestation,verifiedDateOfBirth:"1991-01-01"}},deps));
  const saved=await reviewAthleteReadinessV3(operatorIdentity,input,deps);
  assert.deepEqual(await reviewAthleteReadinessV3(operatorIdentity,input,deps),saved);
  assert.equal((await read()).state,"reviewed");assert.equal((await read(athleteIdentity,"recipient")).state,"reviewed");
  const visible=await getAthleteReadinessV3(athleteIdentity,{...base,role:"recipient"},deps);
  assert.equal(visible.reviewId,saved.reviewId);assert.equal(visible.state,"reviewed");
  assert.doesNotMatch(JSON.stringify(visible),/dateOfBirth|1990|signature|EvidenceRef|sessionId|challenge|privateKey/);
  await denied("reward_readiness_revision_changed",()=>reviewAthleteReadinessV3(operatorIdentity,{...input,reviewId:id(2)},deps));
  await query(`savepoint profile_drift;update public.athlete_profiles set display_name='Changed synthetic profile' where id=${q(profileId)};`);
  assert.equal((await read()).state,"profile_changed");assert.equal((await read(athleteIdentity,"recipient")).state,"profile_changed");
  await query("rollback to savepoint profile_drift;");
  await query(`savepoint source_drift;update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`);
  assert.equal((await read()).state,"source_hold");assert.equal((await readAllocationUploadV3(operatorIdentity,scope,rpc)).current,false);
  await query("rollback to savepoint source_drift;");
  await query(`savepoint ownership_drift;update public.athlete_profiles set claimed_by_user_id=${q(otherIdentity.userId)} where id=${q(profileId)};`);
  assert.equal((await read()).state,"identity_hold");await denied("reward_readiness_scope_required",()=>read(athleteIdentity,"recipient"));
  await query("rollback to savepoint ownership_drift;");
  await query(`savepoint age_drift;update public.athlete_profiles set date_of_birth=current_date-interval '12 years',birth_year=extract(year from current_date-interval '12 years') where id=${q(profileId)};`);
  assert.equal((await read()).state,"age_hold");await query("rollback to savepoint age_drift;");
  await query(`savepoint session_drift;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(athleteIdentity.sessionId)};`);
  await denied("reward_account_session_required",()=>read(athleteIdentity,"recipient"));await query("rollback to savepoint session_drift;");
  const revoke={...base,reviewId:saved.reviewId,reason:"wallet_security_changed"};
  const revoked=await revokeAthleteReadinessV3(operatorIdentity,revoke,deps);
  assert.equal((await read()).state,"revoked");assert.deepEqual(await revokeAthleteReadinessV3(operatorIdentity,revoke,deps),revoked);
  assert.equal((await reviewAthleteReadinessV3(operatorIdentity,input,deps)).revokedAt,revoked.revokedAt,"old retry cannot renew revoked readiness");
  const next=await reviewAthleteReadinessV3(operatorIdentity,{...input,reviewId:id(2),previousReviewId:id(1)},deps);
  assert.equal((await read()).review.id,next.reviewId);assert.equal((await read()).state,"reviewed");
  // Revoking an older review cannot silently revoke the newer independent review.
  await revokeAthleteReadinessV3(operatorIdentity,revoke,deps);assert.equal((await read()).state,"reviewed");
  await withdrawAthleteRewardDestination(athleteIdentity,destination.requestId,rpc);
  assert.equal((await read()).state,"request_withdrawn");
  for(const role of ["anon","authenticated"]){
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','app_private.require_reward_readiness_attestation_v3(jsonb,integer)','EXECUTE'));`)),false);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_read_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,text)','EXECUTE'));`)),false);
    for(const table of ["reward_athlete_readiness_v3","reward_athlete_readiness_revocations_v3"])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
  }
  await denied("reward_ledger_is_immutable",async()=>{await query(`update app_private.reward_athlete_readiness_v3 set profile_fingerprint=repeat('0',64) where id=${q(id(2))};`);});
}
