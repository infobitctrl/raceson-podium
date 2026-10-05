import { workflowHttpFixtureV3, athleteWorkflowTargetV3 } from "../../../apps/api/test/fixtures/reward-workflow-v3.mjs";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { readReadinessV3,readClaimV3,listOwnClaimsV3 } from "../dist/rewards/index.js";
import { prepareAthleteWalletProof,verifyAthleteWalletProof } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
import { submitAthleteRewardDestination } from "../../../apps/api/dist/features/rewards/athlete-destination-service.js";
import { reviewAthleteReadinessV3,revokeAthleteReadinessV3 } from "../../../apps/api/dist/features/rewards/athlete-readiness-v3-service.js";
import { prepareAthleteClaimV3,preparedClaimV3,reviewAthleteClaimSigningV3,recordAthleteClaimProofV3 } from "../../../apps/api/dist/features/rewards/athlete-claims-v3-service.js";
import { dispatchAthleteClaimsV3 } from "../../../apps/api/dist/routes/rewards/athlete-claims-v3.js";
import { decodeAthleteConsentReviewV3,decodeAthleteConsentRecordV3,decodeOwnAthleteClaimsV3,
  athleteConsentSigningJsonV3,verifyAthleteConsentSignatureV3 } from "../../rewards-chain/dist/athlete-consent-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
import { athletePaymentsV3Scenarios } from "./reward-athlete-payments-v3-scenarios.mjs";
const id=n=>`8f200000-0000-4000-8000-${String(n).padStart(12,"0")}`;

// Only the parent's rollback-only SQL fixture and disposable active Anvil child.
// No genuine profile, saved-demo identity, wallet or public-chain consent.
export async function athleteClaimsV3Scenarios({query,rpc,scope,identity:operator,runtime,finalFixture=false,sourceHoldSql}) {
  const athlete={userId:id(1),sessionId:id(2)},other={userId:id(3),sessionId:id(4)};
  await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (${q(athlete.userId)},'claim-v3@example.invalid','authenticated','authenticated','{}','{}',now(),now()),
    (${q(other.userId)},'claim-other-v3@example.invalid','authenticated','authenticated','{}','{}',now(),now());
    update public.user_profiles set status='active' where user_id in (${q(athlete.userId)},${q(other.userId)});
    insert into auth.sessions(id,user_id,not_after) values (${q(athlete.sessionId)},${q(athlete.userId)},clock_timestamp()+interval '1 hour'),
    (${q(other.sessionId)},${q(other.userId)},clock_timestamp()+interval '1 hour');`);
  const row=JSON.parse(await query(`select jsonb_build_object('profileId',source_beneficiary_id,'entitlementId','0x'||encode(entitlement_id,'hex'))
    from app_private.reward_allocation_recipients_v3 where approval_id=${q(scope.approvalId)} and beneficiary_kind='athlete' order by entitlement_id limit 1;`));
  const existing=JSON.parse(await query(`select to_jsonb(exists(select 1 from public.athlete_profiles where id=${q(row.profileId)}));`));
  if(existing){
    assert.equal(finalFixture,true,'Only the explicit owned finale fixture may reuse a synthetic profile');
    await query(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${q(athlete.userId)},date_of_birth='1990-01-01',birth_year=1990 where id=${q(row.profileId)};`);
  }else await query(`insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,status,is_claimed,claimed_by_user_id,date_of_birth,birth_year)
    values(${q(row.profileId)},'synthetic-claim-v3','Synthetic','Claim','Synthetic claim','active',true,${q(athlete.userId)},'1990-01-01',1990);`);
  const deps={chainId:31337,origin:"http://127.0.0.1:3101",rpc,reader:runtime.reader};
  const signer=privateKeyToAccount(toHex(912346n,{size:32}));
  const challenge=await prepareAthleteWalletProof(athlete,{address:signer.address,idempotencyKey:"claim-v3-wallet"},deps);
  await verifyAthleteWalletProof(athlete,{challengeId:challenge.challengeId,signature:await signer.signMessage({message:challenge.message})},deps);
  const destination=await submitAthleteRewardDestination(athlete,{challengeId:challenge.challengeId,athleteProfileId:row.profileId,idempotencyKey:"claim-v3-destination"},deps);
  const base={chainId:31337,uploadId:scope.uploadId,destinationId:destination.requestId,role:"operator"};
  const ready=await readReadinessV3(operator,base,rpc);
  const review={...base,reviewId:id(5),previousReviewId:null,sourceGuardHash:ready.source.sourceGuardHash,profileFingerprint:ready.profileFingerprint,
    attestation:{schemaVersion:1,policy:"operator-observed-external-wallet-v1",verifiedDateOfBirth:"1990-01-01",
      identityEvidenceRef:id(10),adultEvidenceRef:id(11),walletMfaEvidenceRef:id(12),walletRecoveryEvidenceRef:id(13)}};
  await reviewAthleteReadinessV3(operator,review,deps);
  const request={...base,entitlementId:row.entitlementId,claimId:id(6)},recipient={...request,role:"recipient"};
  const http=async(who,role,action,body)=>{
    const response={headers:{}},url=new URL(`http://127.0.0.1:3101/api/v1/${role}/rewards/uploads/${base.uploadId}/destinations/${base.destinationId}/awards/${row.entitlementId}/claims/${request.claimId}/${action}`);
    assert.equal(await dispatchAthleteClaimsV3({method:action==="signing"?"GET":"POST"},response,url,{
      config:()=>deps,requireIdentity:async()=>who,readJsonBody:async()=>body,rpc,claimV3Reader:runtime.reader,
      applyPrivateSessionHeaders:r=>{r.headers["Cache-Control"]="private, no-store";},sendSuccess:(r,data)=>{r.status=200;r.body=data;},
      sendError:(r,status,code)=>{r.status=status;r.body={code};},
    }),true);assert.match(response.headers["Cache-Control"],/no-store/);return response;
  };
  const denied=async(code,fn)=>{await query("savepoint claim_denied;");try{await assert.rejects(fn,{code});}finally{await query("rollback to savepoint claim_denied;");}};
  const prepare={...request,reviewId:review.reviewId,sourceGuardHash:review.sourceGuardHash,profileFingerprint:review.profileFingerprint};
  const created=await prepareAthleteClaimV3(operator,prepare,deps);assert.equal(created.claimId,id(6));assert.equal(created.recipientConsented,false);
  assert.deepEqual((await listOwnClaimsV3(athlete,31337,null,rpc)).items,[created]);
  assert.deepEqual(decodeOwnAthleteClaimsV3(await listOwnClaimsV3(athlete,31337,null,rpc),31337).items,[created]);
  assert.equal((await listOwnClaimsV3(other,31337,null,rpc)).items.length,0);
  assert.equal((await listOwnClaimsV3(athlete,10143,null,rpc)).items.length,0);
  assert.equal((await listOwnClaimsV3(athlete,31337,created.claimId,rpc)).items.length,0);
  assert.deepEqual(await prepareAthleteClaimV3(operator,prepare,deps),created);
  await denied("reward_claim_already_prepared",()=>prepareAthleteClaimV3(operator,{...prepare,claimId:id(7)},deps));
  await denied("reward_readiness_scope_required",()=>readClaimV3(other,recipient,rpc));
  await denied("reward_claim_scope_required",()=>readClaimV3(athlete,{...recipient,claimId:id(8)},rpc));
  const current=await readClaimV3(athlete,recipient,rpc),prepared=preparedClaimV3(current,row.entitlementId);
  assert.equal(prepared.messages.consent.domain.version,"4");assert.equal(prepared.expectation.deployment.context.chainId,31337);
  const signingResponse=await http(athlete,"athlete","signing");assert.equal(signingResponse.status,200);
  const signing=signingResponse.body;assert.equal(signing.status,"signature_required");
  assert.equal(signing.typedData.domain.version,"4");assert.doesNotMatch(JSON.stringify(signing),/"signature":|dateOfBirth|EvidenceRef|sessionId|snapshotSalt/);
  await denied("reward_recipient_consent_required",()=>reviewAthleteClaimSigningV3(operator,request,deps));
  const wrong=await signer.signTypedData({...prepared.messages.consent,domain:{...prepared.messages.consent.domain,version:"3"}});
  await denied("reward_claim_signature_mismatch",()=>recordAthleteClaimProofV3(athlete,{...recipient,signature:wrong},deps));
  const selected={chainId:31337,uploadId:base.uploadId,destinationId:base.destinationId,claimId:request.claimId,entitlementId:row.entitlementId,
    campaignAddress:prepared.expectation.deployment.context.verifyingContract.toLowerCase(),recipientAddress:signer.address.toLowerCase(),
    amountWei:prepared.claim.amount.toString(),pot:prepared.claim.pot};
  const browserReview=decodeAthleteConsentReviewV3(signing,selected);
  const consent=await signer.signTypedData(JSON.parse(athleteConsentSigningJsonV3(browserReview)));
  assert.equal(await verifyAthleteConsentSignatureV3(browserReview,consent),consent);
  if(sourceHoldSql){
    await query('savepoint final_source_io;');let drifted=false;
    const reader={...runtime.reader,getBlock:async args=>{
      if(!drifted){drifted=true;await query(sourceHoldSql);}return runtime.reader.getBlock(args);
    }};
    await denied('reward_claim_readiness_required',()=>recordAthleteClaimProofV3(athlete,{...recipient,signature:consent},{...deps,reader}));
    assert.equal(drifted,true);await query('rollback to savepoint final_source_io;');
  }
  await query(`savepoint held_source;update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`);
  await denied("reward_claim_readiness_required",()=>recordAthleteClaimProofV3(athlete,{...recipient,signature:consent},deps));
  await query("rollback to savepoint held_source;");
  const httpConsent=await http(athlete,"athlete","proof",{signature:consent});assert.equal(httpConsent.status,200);
  const recorded=httpConsent.body;
  assert.deepEqual(decodeAthleteConsentRecordV3(recorded,selected),recorded);
  assert.equal(recorded.recipientConsented,true);assert.equal(recorded.operatorApproved,false);
  assert.deepEqual(await recordAthleteClaimProofV3(athlete,{...recipient,signature:consent},deps),recorded);
  assert.equal((await reviewAthleteClaimSigningV3(athlete,recipient,deps)).status,"already_recorded");
  const operatorReview=await reviewAthleteClaimSigningV3(operator,request,deps);assert.equal(operatorReview.status,"signature_required");
  const approval=await runtime.operator.signTypedData(prepared.messages.authorization);
  const approvalFlow=workflowHttpFixtureV3({identity:operator,rpc,reader:runtime.reader,loadApprovalSigner:async()=>runtime.operator});
  try {
    const target=athleteWorkflowTargetV3({...request,paymentId:id(7001),attemptId:id(7002)});
    const inspected=await approvalFlow.http('inspect-approval',{target});assert.equal(inspected.status,200,inspected.code);
    assert.equal(inspected.data.recorded,false);
    const result=await approvalFlow.http('approve',{target,planHash:inspected.data.plan.planHash});
    assert.equal(result.status,200,result.code);assert.equal(result.data.recorded,true);
    assert.deepEqual((await approvalFlow.http('approve',{target,planHash:inspected.data.plan.planHash})).data,result.data);
  } finally {approvalFlow.close();}
  const httpApproval=await http(operator,"organizer","proof",{signature:approval});assert.equal(httpApproval.status,200);
  const approved=httpApproval.body;assert.equal(approved.operatorApproved,true);
  assert.equal((await readClaimV3(athlete,recipient,rpc)).proofs.length,2);
  // Expire the session immediately after the first SQL read. Each asynchronous
  // historical branch must reauthorize before returning private claim metadata.
  for(const [who,run] of [
    [operator,d=>prepareAthleteClaimV3(operator,prepare,d)],
    [athlete,d=>reviewAthleteClaimSigningV3(athlete,recipient,d)],
    [athlete,d=>recordAthleteClaimProofV3(athlete,{...recipient,signature:consent},d)],
    [operator,d=>recordAthleteClaimProofV3(operator,{...request,signature:approval},d)],
  ]){
    await query('savepoint late_claim_session;');let expired=false;
    const lateRpc=async(name,args)=>{const result=await rpc(name,args);
      if(name==='service_read_reward_claim_v3' && !expired && !result.error){expired=true;
        await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(who.sessionId)};`);}
      return result;};
    await denied('reward_account_session_required',()=>run({...deps,rpc:lateRpc}));assert.equal(expired,true);
    await query('rollback to savepoint late_claim_session;');
  }
  // Actual API/SQL consent -> durable job -> exactly one disposable-chain payout.
  await athletePaymentsV3Scenarios({query,rpc,scope:request,draftId:scope.draftId,operator,athlete,other,runtime,deps,sourceHoldSql});
  await revokeAthleteReadinessV3(operator,{...base,reviewId:id(5),reason:"wallet_security_changed"},deps);
  // Historical retries cannot clear the hold or create a replacement window.
  assert.deepEqual(await recordAthleteClaimProofV3(operator,{...request,signature:approval},deps),approved);
  await denied("reward_claim_readiness_required",()=>prepareAthleteClaimV3(operator,{...prepare,claimId:id(7)},deps));
  await query(`savepoint ownership_changed;update public.athlete_profiles set claimed_by_user_id=${q(other.userId)} where id=${q(row.profileId)};`);
  assert.equal((await listOwnClaimsV3(athlete,31337,null,rpc)).items.length,0);
  await denied("reward_readiness_scope_required",()=>readClaimV3(athlete,recipient,rpc));await query("rollback to savepoint ownership_changed;");
  await query(`savepoint expired_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(athlete.sessionId)};`);
  await denied("reward_account_session_required",()=>readClaimV3(athlete,recipient,rpc));await query("rollback to savepoint expired_session;");
  for(const role of ["anon","authenticated"]){
    for(const table of ["reward_athlete_claims_v3","reward_athlete_claim_proofs_v3"])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_read_reward_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text)','EXECUTE'));`)),false);
  }
  await denied("reward_ledger_is_immutable",()=>query(`update app_private.reward_athlete_claims_v3 set expires_at=expires_at-1 where id=${q(id(6))};`));
}
