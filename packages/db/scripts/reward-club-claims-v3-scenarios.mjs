import assert from 'node:assert/strict';
import { concatHex } from 'viem';
import { decodeClubConsentReviewV3,combineClubOwnerSignaturesV3 } from '../../rewards-chain/dist/club-consent-v3.js';
import { readClubClaimV3,storeClubClaimProofV3,copyRewardLedgerDocument as copy } from '../dist/rewards/index.js';
import { prepareClubClaimV3,reviewClubClaimSigningV3,recordClubClaimProofV3 } from '../../../apps/api/dist/features/rewards/club-claims-v3-service.js';
import { revokeClubTreasuryReadinessV3,reviewClubReadinessV3 } from '../../../apps/api/dist/features/rewards/club-readiness-v3-service.js';
import { dispatchClubClaimsV3 } from '../../../apps/api/dist/routes/rewards/club-claims-v3.js';
import { literal as q } from './reward-integration-fixture.mjs';
import { clubPaymentsV3Scenarios } from './reward-club-payments-v3-scenarios.mjs';
const id=n=>`8fa00000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// Called only inside the parent's rollback SQL fixture and owned local chain.
// Synthetic owners are test evidence, never real representative consent.
export async function clubClaimsV3Scenarios({query,rpc,base,scope,owner,other,profileId,operatorIdentity,input,deps,runtime,sourceHoldSql}){
  const entitlementId=JSON.parse(await query(`select to_jsonb('0x'||encode(entitlement_id,'hex')) from app_private.reward_allocation_recipients_v3
    where approval_id=${q(scope.approvalId)} and beneficiary_kind='club' order by entitlement_id limit 1;`));
  const selected={...base,entitlementId,claimId:id(1)},operatorScope={...selected,role:'operator'},recipientScope={...selected,role:'recipient'};
  const prepare={...selected,reviewId:input.reviewId,sourceGuardHash:input.sourceGuardHash,identityFingerprint:input.identityFingerprint};
  const read=(who=operatorIdentity,s=operatorScope)=>readClubClaimV3(who,s,rpc);
  const denied=async(code,fn)=>{await query('savepoint club_claim_denied;');try{await assert.rejects(fn,code?{code}:undefined);}finally{await query('rollback to savepoint club_claim_denied;');}};
  const first=await prepareClubClaimV3(operatorIdentity,prepare,deps);
  assert.equal(first.recipientConsented,false);assert.equal(first.operatorApproved,false);
  assert.deepEqual(await prepareClubClaimV3(operatorIdentity,prepare,deps),first);
  await denied('reward_claim_already_prepared',()=>prepareClubClaimV3(operatorIdentity,{...prepare,claimId:id(2)},deps));
  await denied('reward_club_readiness_scope_required',()=>read(other,recipientScope));
  await denied('reward_recipient_consent_required',()=>reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps));
  const consent=await reviewClubClaimSigningV3(owner,recipientScope,deps);
  assert.equal(consent.status,'signature_required');assert.equal(consent.typedData.primaryType,'SafeMessage');
  assert.equal(consent.typedData.domain.verifyingContract.toLowerCase(),first.recipientAddress);
  const storedClaim=(await read()).intent;
  const signingSelection={chainId:31337,uploadId:base.uploadId,requestId:base.requestId,claimId:selected.claimId,entitlementId,
    campaignAddress:storedClaim.campaignAddress,recipientAddress:first.recipientAddress,amountWei:first.amountWei,pot:scope.slot===6?'league':'race'};
  const reviewed=decodeClubConsentReviewV3(consent,signingSelection);
  assert.equal(reviewed.binding.nonce,storedClaim.nonce.toString());
  assert.equal(reviewed.binding.allocationDigest,storedClaim.witness.allocationDigest);
  assert.doesNotMatch(JSON.stringify(consent),/owners|signatureBytes|privateKey|sessionId|identityFingerprint|sourceGuardHash/);
  const owners=[...runtime.chain.clubOwners].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0,2);
  const signatures=await Promise.all(owners.map(w=>w.signTypedData(reviewed.typedData)));
  const signature=await combineClubOwnerSignaturesV3(reviewed.typedData,owners.map((w,n)=>({signer:w.address,signature:signatures[n]})).reverse());
  assert.equal(signature,concatHex(signatures));
  await denied(null,()=>recordClubClaimProofV3(owner,{...recipientScope,signature:signatures[0]},deps));
  const wrong=structuredClone(consent.typedData);wrong.message.message='0x'+'ab'.repeat(32);
  const wrongSignature=concatHex(await Promise.all(owners.map(w=>w.signTypedData(wrong))));
  await denied(null,()=>recordClubClaimProofV3(owner,{...recipientScope,signature:wrongSignature},deps));
  await query('savepoint club_late_session;');let changed=false;
  const lateReader={...runtime.reader,getChainId:async()=>{if(!changed){changed=true;await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(owner.sessionId)};`);}return 31337;}};
  await denied('reward_account_session_required',()=>recordClubClaimProofV3(owner,{...recipientScope,signature},{...deps,reader:lateReader}));
  await query('rollback to savepoint club_late_session;');assert.equal((await read()).proofs.length,0);
  const saved=await recordClubClaimProofV3(owner,{...recipientScope,signature},deps);
  assert.equal(saved.recipientConsented,true);assert.equal(saved.operatorApproved,false);
  assert.deepEqual(await recordClubClaimProofV3(owner,{...recipientScope,signature},deps),saved);
  const proof=(await read()).proofs[0],witness=copy(proof.witness);
  await denied('invalid_reward_claim_witness',()=>storeClubClaimProofV3(operatorIdentity,operatorScope,{proof:{...proof.proof,role:'operator',wrappedDigest:null,
    signer:runtime.operator.address.toLowerCase(),signature:'0x'+'ab'.repeat(65)},witness:{...witness,treasury:{...witness.treasury,initializerHash:'0x'+'ab'.repeat(32)}},observedAt:new Date().toISOString()},rpc));
  await query(`savepoint club_claim_source;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`}`);
  await denied('reward_claim_readiness_required',()=>reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps));
  assert.deepEqual(await prepareClubClaimV3(operatorIdentity,prepare,deps),saved);
  await query('rollback to savepoint club_claim_source;');
  await query(`savepoint club_claim_owner;update public.athlete_profiles set claimed_by_user_id=${q(other.userId)} where id=${q(profileId)};`);
  await denied('reward_club_readiness_scope_required',()=>reviewClubClaimSigningV3(owner,recipientScope,deps));
  await denied('reward_claim_readiness_required',()=>reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps));
  await query('rollback to savepoint club_claim_owner;');
  await query('savepoint club_claim_review;');
  await revokeClubTreasuryReadinessV3(operatorIdentity,{...base,reviewId:input.reviewId,reason:'operator_correction'},deps);
  await denied('reward_claim_readiness_required',()=>reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps));
  await reviewClubReadinessV3(operatorIdentity,{...input,reviewId:id(3),previousReviewId:input.reviewId},deps);
  await denied('reward_claim_readiness_required',()=>reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps));
  assert.deepEqual(await prepareClubClaimV3(operatorIdentity,prepare,deps),saved,'retry uses original review, not replacement');
  await query('rollback to savepoint club_claim_review;');
  const authorization=await reviewClubClaimSigningV3(operatorIdentity,operatorScope,deps);
  assert.equal(authorization.typedData.domain.version,'4');assert.notEqual(authorization.typedData.domain.verifyingContract.toLowerCase(),first.recipientAddress);
  const operatorSignature=await runtime.operator.signTypedData(authorization.typedData);
  const complete=await recordClubClaimProofV3(operatorIdentity,{...operatorScope,signature:operatorSignature},deps);
  assert.equal(complete.operatorApproved,true);assert.equal((await read()).proofs.length,2);
  assert.equal(await runtime.reader.getBalance({address:first.recipientAddress}),0n,'consent and approval send no funds');
  await query('savepoint club_history_session;');changed=false;
  await denied('reward_account_session_required',()=>reviewClubClaimSigningV3(owner,recipientScope,{...deps,reader:lateReader}));
  await query('rollback to savepoint club_history_session;');
  // Actual HTTP projection reloads and verifies both saved signatures.
  const headers={},res={setHeader:(k,v)=>headers[k]=v};
  assert.equal(await dispatchClubClaimsV3({method:'GET'},res,new URL(`http://127.0.0.1:3101/api/v1/club/rewards/uploads/${base.uploadId}/club-treasuries/${base.requestId}/awards/${entitlementId}/claims/${selected.claimId}/signing`),{
    config:()=>({chainId:31337}),requireIdentity:async()=>owner,rpc,clubClaimV3Reader:runtime.reader,
    applyPrivateSessionHeaders:r=>r.setHeader('Cache-Control','private, no-store'),sendSuccess:(r,b)=>{r.status=200;r.body=b;},
    sendError:(r,s,c)=>{r.status=s;r.body={code:c};},readJsonBody:async()=>{throw Error('unexpected body');}}),true);
  assert.equal(res.status,200);assert.equal(res.body.status,'already_recorded');assert.match(headers['Cache-Control'],/no-store/);
  assert.deepEqual(decodeClubConsentReviewV3(res.body,signingSelection),res.body);
  assert.doesNotMatch(JSON.stringify(res.body),/signature|typedData|EvidenceRef|session|privateKey|sourceGuardHash/);
  for(const role of ['anon','authenticated']){
    for(const name of ['reward_club_claims_v3','reward_club_claim_proofs_v3'])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${name}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
    for(const signature of ['service_read_reward_club_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text)',
      'service_prepare_reward_club_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,text,jsonb,timestamptz)',
      'service_record_reward_club_claim_proof_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz)'])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.${signature}','EXECUTE'));`)),false);
  }
  for(const name of ['reward_club_claims_v3','reward_club_claim_proofs_v3']){
    assert.equal(JSON.parse(await query(`select to_jsonb(relrowsecurity) from pg_class where oid='app_private.${name}'::regclass;`)),true);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('service_role','app_private.${name}','UPDATE,DELETE'));`)),false);
    await denied('reward_ledger_is_immutable',()=>query(`delete from app_private.${name};`));
  }
  await clubPaymentsV3Scenarios({query,rpc,scope:operatorScope,operator:operatorIdentity,owner,other,runtime,deps,sourceHoldSql,draftId:scope.draftId});
}
