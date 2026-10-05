import assert from "node:assert/strict";
import test from "node:test";
import { readinessFixture, readinessId as id } from "./fixtures/reward-readiness.mjs";
import { decodeReadinessContextV3, decodeReadinessReviewV3, readReadinessV3, recordReadinessV3 } from "../../../packages/db/dist/rewards/index.js";
import { getAthleteReadinessV3, reviewAthleteReadinessV3 } from "../dist/features/rewards/athlete-readiness-v3-service.js";
import { dispatchAthleteReadinessV3 } from "../dist/routes/rewards/athlete-readiness-v3.js";
import { decodeRewardReadinessAttestationV3, decodeRewardReadinessAttestation } from "../../../packages/db/dist/rewards/index.js";

async function fixture(chainId=31337) {
  const old=await readinessFixture(chainId);
  const source={draftId:id(20),chainId,uploadId:id(21),approvalId:id(22),slot:1,operatorUserId:old.identity.userId,
    operatorAddress:`0x${"a".repeat(40)}`,current:true,sourceGuardHash:"d".repeat(64)};
  const scope={chainId,uploadId:source.uploadId,destinationId:old.context.destination.requestId,role:"operator"};
  const context={schema:"raceson-athlete-readiness-private-v3",actorUserId:old.identity.userId,role:"operator",source,
    destination:old.context.destination,challenge:old.context.challenge,profileFingerprint:"a".repeat(64),dateOfBirth:"1990-01-01",birthYear:1990,state:"unreviewed",review:null};
  const review={id:id(23),uploadId:scope.uploadId,destinationId:scope.destinationId,previousReviewId:null,sourceGuardHash:source.sourceGuardHash,
    profileFingerprint:context.profileFingerprint,attestation:structuredClone(old.input.attestation),reviewedByUserId:old.identity.userId,
    reviewedSessionId:old.identity.sessionId,reviewedAt:"2026-09-08T09:00:01Z",revocation:null};
  const input={...scope,reviewId:review.id,previousReviewId:null,sourceGuardHash:source.sourceGuardHash,
    profileFingerprint:context.profileFingerprint,attestation:structuredClone(review.attestation)};
  const calls=[],rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});
    return{data:structuredClone(name==="service_read_reward_readiness_v3"?context:review),error:null};};
  return{identity:old.identity,config:old.config,scope,context,review,input,calls,rpc};
}
test("V3 readiness binds the actual actor, upload, destination, exact source and wallet proof",async()=>{
  const f=await fixture();assert.equal((await readReadinessV3(f.identity,f.scope,f.rpc)).state,"unreviewed");
  assert.deepEqual(f.calls[0],{name:"service_read_reward_readiness_v3",args:{p_actor_user_id:f.identity.userId,p_actor_session_id:f.identity.sessionId,
    p_chain_id:31337,p_upload_id:id(21),p_destination_id:id(7),p_role:"operator"}});
  for(const change of [c=>c.actorUserId=id(90),c=>c.role="recipient",c=>c.source.uploadId=id(90),c=>c.source.chainId=143,
    c=>c.source.operatorUserId=id(90),c=>c.source.slot=7,c=>c.destination.requestId=id(90),c=>c.challenge.proof.proofId=id(90),
    c=>c.challenge.address=`0x${"b".repeat(40)}`,c=>c.dateOfBirth="2001-02-29",c=>c.privateKey="secret",
    c=>c.state="reviewed",c=>c.state="revoked",c=>c.state="source_hold",c=>c.state="profile_changed",c=>c.state="request_withdrawn"]){
    const c=structuredClone(f.context);change(c);assert.throws(()=>decodeReadinessContextV3(c,f.identity,f.scope));
  }
  f.context.state="reviewed";f.context.review=f.review;assert.equal(decodeReadinessContextV3(f.context,f.identity,f.scope).state,"reviewed");
  f.context.state="unreviewed";assert.throws(()=>decodeReadinessContextV3(f.context,f.identity,f.scope));
});
test("V3 recipient uses their own current session and status never leaks private evidence",async()=>{
  const f=await fixture(),identity={userId:id(4),sessionId:id(90)};
  f.context.actorUserId=identity.userId;f.context.role="recipient";
  const result=await getAthleteReadinessV3(identity,{...f.scope,role:"recipient"},{...f.config,rpc:f.rpc});
  assert.equal(result.schema,"raceson-athlete-readiness-v3");assert.equal(result.state,"unreviewed");
  assert.equal(f.calls[0].args.p_actor_session_id,identity.sessionId);assert.equal(f.calls[0].args.p_actor_user_id,identity.userId);
  assert.doesNotMatch(JSON.stringify(result),/dateOfBirth|1990|signature|EvidenceRef|sessionId|challenge|privateKey|attestation/);
});
test("V3 readiness cannot turn a corrupt, missing or cross-origin proof into approval",async()=>{
  for(const change of [f=>f.context.challenge.proof=null,f=>f.context.challenge.proof.signature=`0x${"ff".repeat(65)}`,
    f=>f.context.challenge.proof.messageHash=`0x${"ab".repeat(32)}`,f=>f.config.chainId=10143,f=>f.config.origin="http://localhost:5173"]){
    const f=await fixture();change(f);await assert.rejects(reviewAthleteReadinessV3(f.identity,f.input,{...f.config,rpc:f.rpc}));
    assert.equal(f.calls.length,1);
  }
});
test("V3 operator review preserves inspected versions and freezes caller input across async work",async()=>{
  const f=await fixture();f.context.profileFingerprint="b".repeat(64);
  const rpc=async(name,args)=>{const result=await f.rpc(name,args);if(name==="service_read_reward_readiness_v3"){
    f.identity.userId=id(90);f.input.profileFingerprint="c".repeat(64);f.input.attestation.adultEvidenceRef=id(90);
  }return result;};
  const r=await reviewAthleteReadinessV3(f.identity,f.input,{...f.config,rpc});
  assert.equal(r.reviewId,id(23));assert.equal(f.calls[1].args.p_profile_fingerprint,"a".repeat(64));
  assert.equal(f.calls[1].args.p_actor_user_id,id(1));assert.equal(f.calls[1].args.p_attestation.adultEvidenceRef,id(11));
  assert.doesNotMatch(JSON.stringify(r),/attestation|signature|session|Fingerprint/);
});
test("V3 stored review is scope checked and exact retries remain historical and revoked",async()=>{
  const f=await fixture();
  for(const change of [r=>r.id=id(90),r=>r.uploadId=id(90),r=>r.destinationId=id(90),r=>r.previousReviewId=id(90),r=>r.reviewedByUserId=id(90),
    r=>r.sourceGuardHash="b".repeat(64),r=>r.profileFingerprint="b".repeat(64),r=>r.attestation.adultEvidenceRef=id(90)]){
    const r=structuredClone(f.review);change(r);await assert.rejects(recordReadinessV3(f.identity,f.input,async()=>({data:r,error:null})));
  }
  assert.throws(()=>decodeReadinessReviewV3({...f.review,previousReviewId:f.review.id}));
  f.review.reviewedSessionId=id(90);f.review.revocation={reason:"wallet_security_changed",revokedAt:"2026-09-08T09:00:02Z",revokedByUserId:id(1)};
  assert.equal((await reviewAthleteReadinessV3(f.identity,f.input,{...f.config,rpc:f.rpc})).revokedAt,f.review.revocation.revokedAt);
});

async function request(path,options={}) {
  const f=await fixture(options.chainId);if(options.body?.attestation?.schemaVersion===2)f.review.attestation=options.body.attestation;
  let authenticated=0,readBodies=0;const headers={},res={setHeader:(k,v)=>headers[k]=v};
  const routed=await dispatchAthleteReadinessV3({method:options.method??"GET"},res,new URL(path,"http://127.0.0.1:3101"),{
    config:()=>options.disabled?null:f.config,requireIdentity:async()=>{authenticated++;if(options.authError)throw Error(options.authError);return f.identity;},
    readJsonBody:async()=>{readBodies++;return options.body;},applyPrivateSessionHeaders:r=>r.setHeader("Cache-Control","private, no-store"),
    sendSuccess:(r,data)=>{r.status=200;r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={code};},
    rpc:options.error?async()=>{f.calls.push({error:true});return{data:null,error:{message:options.error}};}:f.rpc,
  });return{...res,headers,routed,authenticated,readBodies,calls:f.calls};
}
const path=`/api/v1/organizer/rewards/uploads/${id(21)}/destinations/${id(7)}/readiness-v3`;
test("V3 readiness HTTP is private, gated, strict and never accepts browser identity or signing capability",async()=>{
  const r=await request(path);assert.equal(r.status,200);assert.match(r.headers["Cache-Control"],/no-store/);
  const disabled=await request(path,{disabled:true});assert.equal(disabled.routed,false);assert.equal(disabled.authenticated,0);
  assert.equal((await request(path,{authError:"Unauthorized"})).status,401);
  assert.equal((await request(path,{authError:"Untrusted browser origin"})).status,403);
  for(const query of ["?chainId=143","?actor="+id(90),"?role=operator"]){const bad=await request(path+query);assert.equal(bad.status,400);assert.equal(bad.calls.length,0);}
  assert.equal((await request(path,{method:"DELETE"})).routed,false);
  assert.equal((await request(path.replace("organizer","athlete"),{method:"POST"})).routed,false);
  const f=await fixture(),{reviewId,previousReviewId,sourceGuardHash,profileFingerprint,attestation}=f.input;
  const body={reviewId,previousReviewId,sourceGuardHash,profileFingerprint,attestation};
  assert.equal((await request(path,{method:"POST",body})).status,200);
  for(const extra of [{userId:id(90)},{chainId:143},{signature:"0x"},{attestation:{...attestation,verified:true}}]){
    const bad=await request(path,{method:"POST",body:{...body,...extra}});assert.equal(bad.status,400);assert.equal(bad.calls.length,0);
  }
  for(const [error,status] of [["reward_account_session_required",401],["reward_readiness_scope_required",404],["reward_readiness_hold",409],
    ["reward_readiness_profile_changed",409],["reward_ledger_idempotency_conflict",409],["secret SQL evidence",503]]){
    const fail=await request(path,{error});assert.equal(fail.status,status);assert.doesNotMatch(JSON.stringify(fail),/secret SQL evidence/);
  }
});

const privyAttestation=()=>({schemaVersion:2,policy:"operator-observed-privy-testnet-no-mfa-v1",chainId:10143,
  privyAppId:"cmtx921we00fu0cifaab7exez",verifiedDateOfBirth:"1990-01-01",identityEvidenceRef:id(10),adultEvidenceRef:id(11),
  walletProviderEvidenceRef:id(12),walletRecoveryEvidenceRef:id(13)});
test("synthetic Privy policy is exact-pilot-only, has no invented DOB, and preserves recipient proof checks", async () => {
  const a={schemaVersion:3,policy:"operator-observed-privy-synthetic-test-v1",chainId:10143,
    privyAppId:"cmtx921we00fu0cifaab7exez",draftId:"9a000000-0000-4000-8000-000000000052",
    athleteProfileId:"9a000000-0000-4000-8000-000000001060",syntheticIdentityEvidenceRef:id(10),
    walletProviderEvidenceRef:id(12),walletRecoveryEvidenceRef:id(13)};
  assert.deepEqual(decodeRewardReadinessAttestationV3(a),a);
  const second={...a,policy:"operator-observed-privy-synthetic-test-v2",athleteProfileId:"9a000000-0000-4000-8000-000000001061"};
  assert.deepEqual(decodeRewardReadinessAttestationV3(second),second);
  for(const invalid of [{...a,athleteProfileId:second.athleteProfileId},{...second,athleteProfileId:a.athleteProfileId},
    {...second,athleteProfileId:"9a000000-0000-4000-8000-000000001062"},{...second,chainId:31337},
    {...second,draftId:id(4)},{...second,verifiedDateOfBirth:"1990-01-01"}])
    assert.throws(()=>decodeRewardReadinessAttestationV3(invalid));
  assert.throws(()=>decodeRewardReadinessAttestation(a));
  for(const patch of [{chainId:143},{chainId:31337},{draftId:id(1)},{athleteProfileId:id(2)},
    {verifiedDateOfBirth:"1990-01-01"},{adultEvidenceRef:id(3)},{walletRecoveryEvidenceRef:null}])
    assert.throws(()=>decodeRewardReadinessAttestationV3({...a,...patch}));
  const f=await fixture(10143);
  f.context.source.draftId=a.draftId; f.context.destination.athleteProfileId=a.athleteProfileId;
  f.context.dateOfBirth=null;f.context.birthYear=null;f.context.state="reviewed";
  f.review.attestation=a;f.context.review=f.review;
  assert.equal(decodeReadinessContextV3(f.context,f.identity,f.scope).state,"reviewed");
  for(const change of [c=>c.source.draftId=id(90),c=>c.destination.athleteProfileId=id(90),
    c=>c.dateOfBirth="1990-01-01",c=>c.birthYear=1990,c=>c.challenge.proof=null,
    c=>c.source.current=false,c=>c.destination.status="withdrawn"]){
    const c=structuredClone(f.context);change(c);assert.throws(()=>decodeReadinessContextV3(c,f.identity,f.scope));
  }
});
test("Privy no-MFA attestation is strict, visibly named, and rejected by the original V1 decoder",async()=>{
  const a=privyAttestation();assert.deepEqual(decodeRewardReadinessAttestationV3(a),a);
  assert.throws(()=>decodeRewardReadinessAttestation(a));
  const old=(await fixture()).input.attestation;
  assert.deepEqual(decodeRewardReadinessAttestationV3(old),old);
  const missingMfa={...old};delete missingMfa.walletMfaEvidenceRef;
  assert.throws(()=>decodeRewardReadinessAttestationV3(missingMfa));
  for(const patch of [{schemaVersion:1},{chainId:143},{chainId:31337},{chainId:"10143"},{privyAppId:"another-app"},
    {verifiedDateOfBirth:"2001-02-29"},{walletRecoveryEvidenceRef:null},{walletProviderEvidenceRef:"00000000-0000-0000-0000-000000000000"},
    {walletMfaEvidenceRef:id(12)},{mfaVerified:true}])assert.throws(()=>decodeRewardReadinessAttestationV3({...a,...patch}));
  for(const key of ["identityEvidenceRef","adultEvidenceRef","walletRecoveryEvidenceRef","walletProviderEvidenceRef"]){
    const missing={...a};delete missing[key];assert.throws(()=>decodeRewardReadinessAttestationV3(missing));
  }
});
test("Privy no-MFA review round-trips only in 10143 context and its public status does not expose evidence",async()=>{
  const f=await fixture(10143);f.input.attestation=privyAttestation();f.review.attestation=privyAttestation();
  const saved=await reviewAthleteReadinessV3(f.identity,f.input,{...f.config,rpc:f.rpc});
  assert.equal(saved.reviewId,f.review.id);assert.deepEqual(f.calls[1].args.p_attestation,privyAttestation());
  f.context.review=f.review;f.context.state="reviewed";
  const visible=await getAthleteReadinessV3(f.identity,f.scope,{...f.config,rpc:f.rpc});
  assert.equal(visible.walletSecurityPolicy,privyAttestation().policy);
  assert.doesNotMatch(JSON.stringify(visible),/EvidenceRef|privyAppId|1990|signature|sessionId/);
  for(const chainId of [31337,143]){
    let calls=0;await assert.rejects(reviewAthleteReadinessV3(f.identity,f.input,{...f.config,chainId,rpc:async()=>{calls++;}}));assert.equal(calls,0);
  }
  const local=await fixture();local.context.review={...local.review,attestation:privyAttestation()};local.context.state="reviewed";
  assert.throws(()=>decodeReadinessContextV3(local.context,local.identity,local.scope));
});
test("V3 HTTP accepts the explicit testnet policy but rejects wrong configured chain and incomplete evidence",async()=>{
  const f=await fixture(10143),{reviewId,previousReviewId,sourceGuardHash,profileFingerprint}=f.input;
  const body={reviewId,previousReviewId,sourceGuardHash,profileFingerprint,attestation:privyAttestation()};
  assert.equal((await request(path,{method:"POST",body,chainId:10143})).status,200);
  const local=await request(path,{method:"POST",body,chainId:31337});assert.equal(local.status,400);assert.equal(local.calls.length,0);
  for(const patch of [{chainId:143},{walletMfaEvidenceRef:id(12)},{walletProviderEvidenceRef:null},{walletRecoveryEvidenceRef:null}]){
    const bad=await request(path,{method:"POST",chainId:10143,body:{...body,attestation:{...body.attestation,...patch}}});
    assert.equal(bad.status,400);assert.equal(bad.calls.length,0);
  }
});
